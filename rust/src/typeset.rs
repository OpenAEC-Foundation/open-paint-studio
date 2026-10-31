//! Text as the browser editor sets it: the same font files (Inter, Space
//! Grotesk), shaped by HarfBuzz so kerning and ligatures match, rasterised by
//! FreeType with full hinting and blended into a canvas in sRGB, the way the
//! desktop build's WebKitGTK composites. Glyph coverage is cached per size
//! and glyph.
use crate::canvas::{Canvas, Color};
use freetype::face::LoadFlag;
use std::collections::HashMap;
use std::os::raw::{c_char, c_int, c_uint, c_void};

// The few HarfBuzz calls needed, from the system's libharfbuzz (build.rs).
#[repr(C)]
struct GlyphInfo {
    codepoint: u32,
    mask: u32,
    cluster: u32,
    var1: u32,
    var2: u32,
}

#[repr(C)]
struct GlyphPosition {
    x_advance: i32,
    y_advance: i32,
    x_offset: i32,
    y_offset: i32,
    var: u32,
}

extern "C" {
    fn hb_ft_font_create_referenced(face: *mut c_void) -> *mut c_void;
    fn hb_ft_font_set_load_flags(font: *mut c_void, flags: c_int);
    fn hb_ft_font_changed(font: *mut c_void);
    fn hb_font_destroy(font: *mut c_void);
    fn hb_buffer_create() -> *mut c_void;
    fn hb_buffer_destroy(buffer: *mut c_void);
    fn hb_buffer_add_utf8(buffer: *mut c_void, text: *const c_char, length: c_int, offset: c_uint, item_length: c_int);
    fn hb_buffer_guess_segment_properties(buffer: *mut c_void);
    fn hb_shape(font: *mut c_void, buffer: *mut c_void, features: *const c_void, count: c_uint);
    fn hb_buffer_get_glyph_infos(buffer: *mut c_void, length: *mut c_uint) -> *mut GlyphInfo;
    fn hb_buffer_get_glyph_positions(buffer: *mut c_void, length: *mut c_uint) -> *mut GlyphPosition;
}

struct GlyphImage {
    left: i32,
    top: i32,
    width: usize,
    height: usize,
    coverage: Vec<u8>,
}

/// One glyph as shaped: id, advance and offsets in 1/64 pixel.
pub struct Placed {
    pub glyph: u32,
    pub advance: i32,
    pub dx: i32,
    pub dy: i32,
}

pub struct Face {
    face: freetype::Face,
    font: *mut c_void,
    size: u32,
    /// By size, glyph and quarter-pixel offset.
    glyphs: HashMap<(u32, u32, i32), GlyphImage>,
}

impl Drop for Face {
    fn drop(&mut self) {
        unsafe { hb_font_destroy(self.font) }
    }
}

impl Face {
    pub fn from_memory(library: &freetype::Library, data: &'static [u8]) -> Option<Face> {
        Self::make(library.new_memory_face(data.to_vec(), 0).ok()?)
    }

    pub fn from_file(library: &freetype::Library, path: &str) -> Option<Face> {
        Self::make(library.new_face(path, 0).ok()?)
    }

    fn make(mut face: freetype::Face) -> Option<Face> {
        face.set_pixel_sizes(0, 12).ok()?;
        let font = unsafe { hb_ft_font_create_referenced(face.raw_mut() as *mut _ as *mut c_void) };
        // Hinted advances, whole pixels, as the browser lays its text out.
        unsafe { hb_ft_font_set_load_flags(font, 0) };
        Some(Face { face, font, size: 12, glyphs: HashMap::new() })
    }

    fn use_size(&mut self, size: u32) {
        if self.size != size {
            let _ = self.face.set_pixel_sizes(0, size);
            unsafe { hb_ft_font_changed(self.font) };
            self.size = size;
        }
    }

    /// From the top of a line box to the baseline, in whole pixels, as the
    /// browser rounds the font's ascent.
    pub fn ascent(&self, size: i32) -> i32 {
        let units = self.face.raw().units_per_EM as i32;
        let rise = self.face.raw().ascender as i32;
        (rise * size * 2 + units) / (units * 2)
    }

    pub fn descent(&self, size: i32) -> i32 {
        let units = self.face.raw().units_per_EM as i32;
        let fall = -(self.face.raw().descender as i32);
        (fall * size * 2 + units) / (units * 2)
    }

    pub fn shape(&mut self, text: &str, size: i32) -> Vec<Placed> {
        self.use_size(size as u32);
        unsafe {
            let buffer = hb_buffer_create();
            hb_buffer_add_utf8(buffer, text.as_ptr() as *const c_char, text.len() as c_int, 0, text.len() as c_int);
            hb_buffer_guess_segment_properties(buffer);
            hb_shape(self.font, buffer, std::ptr::null(), 0);
            let mut count = 0;
            let infos = hb_buffer_get_glyph_infos(buffer, &mut count);
            let positions = hb_buffer_get_glyph_positions(buffer, &mut count);
            let out = (0..count as usize)
                .map(|i| {
                    let (info, pos) = (&*infos.add(i), &*positions.add(i));
                    Placed { glyph: info.codepoint, advance: pos.x_advance, dx: pos.x_offset, dy: pos.y_offset }
                })
                .collect();
            hb_buffer_destroy(buffer);
            out
        }
    }

    /// The advance of the text in 1/64 pixel, letter spacing (1/64 pixel per
    /// glyph) included.
    pub fn width(&mut self, text: &str, size: i32, spacing: i32) -> i32 {
        self.shape(text, size).iter().map(|p| p.advance + spacing).sum()
    }

    /// The glyph's coverage, hinted and then moved right by quarter / 4
    /// pixel, as Skia (WebKitGTK's renderer) positions glyphs.
    fn glyph(&mut self, glyph: u32, quarter: i32) -> &GlyphImage {
        let size = self.size;
        let face = &self.face;
        self.glyphs.entry((size, glyph, quarter)).or_insert_with(|| {
            // FreeType applies the transform after hinting.
            let mut identity = freetype::Matrix { xx: 0x10000, xy: 0, yx: 0, yy: 0x10000 };
            let mut shift = freetype::Vector { x: quarter as freetype::ffi::FT_Pos * 16, y: 0 };
            face.set_transform(&mut identity, &mut shift);
            // FT_LOAD_RENDER with the normal target: full hinting.
            let loaded = face.load_glyph(glyph, LoadFlag::RENDER);
            let mut none = freetype::Vector { x: 0, y: 0 };
            face.set_transform(&mut identity, &mut none);
            if loaded.is_err() {
                return GlyphImage { left: 0, top: 0, width: 0, height: 0, coverage: Vec::new() };
            }
            let slot = face.glyph();
            let bitmap = slot.bitmap();
            let (width, height, pitch) = (bitmap.width() as usize, bitmap.rows() as usize, bitmap.pitch() as usize);
            let buffer = bitmap.buffer();
            let mut coverage = Vec::with_capacity(width * height);
            for row in 0..height {
                coverage.extend_from_slice(&buffer[row * pitch..row * pitch + width]);
            }
            GlyphImage { left: slot.bitmap_left(), top: slot.bitmap_top(), width, height, coverage }
        })
    }

    /// Draws the text with its pen at x (1/64 pixel) on the baseline, clipped
    /// to the canvas; returns the advance in 1/64 pixel.
    pub fn draw(&mut self, text: &str, x: i32, baseline: i32, size: i32, spacing: i32, color: Color, image: &mut Canvas) -> i32 {
        let shaped = self.shape(text, size);
        let mut pen = x;
        for p in shaped {
            // Skia's subpixel positions: quarter pixels, rounded.
            let quarters = (pen + p.dx + 8).div_euclid(16);
            let g = self.glyph(p.glyph, quarters.rem_euclid(4));
            let left = quarters.div_euclid(4) + g.left;
            let top = baseline - (p.dy + 32).div_euclid(64) - g.top;
            for row in 0..g.height {
                let y = top + row as i32;
                if y < 0 || y >= image.height as i32 {
                    continue;
                }
                for col in 0..g.width {
                    let px = left + col as i32;
                    if px < 0 || px >= image.width as i32 {
                        continue;
                    }
                    let amount = g.coverage[row * g.width + col];
                    if amount > 0 {
                        blend(color, (y as usize * image.width + px as usize) * 4, &mut image.pixels, amount as i32);
                    }
                }
            }
            pen += p.advance + spacing;
        }
        pen - x
    }
}

/// Composites the colour (straight alpha) on the pixel at the byte offset
/// with coverage 0..255, in sRGB as the browser does.
#[inline]
pub fn blend(color: Color, offset: usize, pixels: &mut [u8], coverage: i32) {
    let amount = (coverage * color.a as i32 + 127) / 255;
    if amount <= 0 {
        return;
    }
    let kept = 255 - amount;
    let p = &mut pixels[offset..offset + 4];
    let under = p[3] as i32;
    if under == 255 {
        p[0] = ((color.r as i32 * amount + p[0] as i32 * kept + 127) / 255) as u8;
        p[1] = ((color.g as i32 * amount + p[1] as i32 * kept + 127) / 255) as u8;
        p[2] = ((color.b as i32 * amount + p[2] as i32 * kept + 127) / 255) as u8;
        return;
    }
    let weight = (under * kept + 127) / 255;
    let alpha = amount + weight;
    let half = alpha / 2;
    p[0] = ((color.r as i32 * amount + p[0] as i32 * weight + half) / alpha) as u8;
    p[1] = ((color.g as i32 * amount + p[1] as i32 * weight + half) / alpha) as u8;
    p[2] = ((color.b as i32 * amount + p[2] as i32 * weight + half) / alpha) as u8;
    p[3] = alpha as u8;
}

/// The text tool: FreeType coverage rendered into the canvas from base, each
/// pixel composited at coverage times opacity, so a live preview can be
/// redrawn on every keystroke. Returns the advance in pixels.
pub fn render_text(face: &mut Face, text: &str, image: &mut Canvas, base: &Canvas, x: i64, y: i64, size: i32, color: Color, opacity: i32) -> i64 {
    face.use_size(size as u32);
    let mut pen = x;
    for ch in text.chars() {
        if face.face.load_char(ch as usize, LoadFlag::RENDER).is_err() {
            continue;
        }
        let slot = face.face.glyph();
        let bitmap = slot.bitmap();
        let (columns, rows, pitch) = (bitmap.width() as i64, bitmap.rows() as i64, bitmap.pitch() as i64);
        let buffer = bitmap.buffer();
        let (left, top) = (pen + slot.bitmap_left() as i64, y - slot.bitmap_top() as i64);
        for row in 0..rows {
            for col in 0..columns {
                let amount = buffer[(row * pitch + col) as usize] as i32;
                if amount > 0 && image.contains(left + col, top + row) {
                    let under = base.get(left + col, top + row);
                    image.put(left + col, top + row, color.over(under, amount * opacity / 255));
                }
            }
        }
        pen += slot.advance().x as i64 / 64;
    }
    pen - x
}
