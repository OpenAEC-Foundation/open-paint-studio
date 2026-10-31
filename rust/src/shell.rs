//! The native shell: draws the measured browser editor (skin_data.rs) into a
//! frame on the processor, the way the browser composites it: sRGB
//! blending, the same fonts, shaping and SVG icons. The canvas, its
//! decorations, the history rows, the menus and the controls change with the
//! document and are drawn here; clicks resolve to the skin's actions.
use crate::app::App;
use crate::canvas::{Canvas, Color};
use crate::skin::{Box, Entry, Kind, State};
use crate::skin_data::{ENTRIES, HISTORY_PITCH, SVGS};
use crate::typeset::{blend, Face};
use crate::vector::rasterise;

static INTER_400: &[u8] = include_bytes!("../assets/fonts/inter-latin-400-normal.woff2");
static INTER_500: &[u8] = include_bytes!("../assets/fonts/inter-latin-500-normal.woff2");
static INTER_600: &[u8] = include_bytes!("../assets/fonts/inter-latin-600-normal.woff2");
static GROTESK_700: &[u8] = include_bytes!("../assets/fonts/space-grotesk-latin-700-normal.woff2");

const SHADOW: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" width="288" height="288"><defs><filter id="a" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.5"/></filter><filter id="b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="16"/></filter></defs><rect x="44" y="54" width="200" height="200" fill="#000" fill-opacity="0.08" filter="url(#b)"/><rect x="44" y="46" width="200" height="200" fill="#000" fill-opacity="0.05" filter="url(#a)"/><rect x="43.5" y="43.5" width="201" height="201" fill="none" stroke="#000" stroke-opacity="0.07"/></svg>"##;
const SPIN: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><rect x="0.5" y="0.5" width="15" height="15" rx="3" fill="#ffffff" stroke="#d5d5d8"/><path d="M5.5 6.5 8 4 10.5 6.5M5.5 9.5 8 12 10.5 9.5" fill="none" stroke="#36363e" stroke-width="1.2"/></svg>"##;
const CHECK: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 13 13"><rect width="13" height="13" rx="3" fill="#d97706"/><path d="M3 6.6 5.4 9 10 4.3" fill="none" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>"##;
const THUMB: &str = r##"<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8.5" fill="#ffffff" stroke="#c8c8cc"/></svg>"##;

pub struct Shell {
    faces: Vec<Face>,
    /// One cached picture per entry, and one more for the canvas shadow.
    pictures: Vec<(String, Canvas)>,
    pub tab: i32,
    /// The open menu, 9 for the file panel, -1 for none.
    pub opened: i32,
    pub status: String,
    /// The slider being dragged: "opacity", "zoomslider" or "".
    pub dragging: String,
    base: Canvas,
    composed: Canvas,
    signature: String,
    pen: i32,
    /// Where each text entry's pen ended, for the texts that follow it.
    pens: Vec<i32>,
}

/// What the fields of the skin's texts are filled from.
struct View<'a> {
    app: &'a App,
    width: i32,
    height: i32,
    mouse: (i32, i32),
    step: usize,
}

/// Where the canvas sits: its corner, scale and the workspace around it.
#[derive(Clone, Copy)]
pub struct Stage {
    pub x: f64,
    pub y: f64,
    pub scale: f64,
    pub area_x: i32,
    pub area_y: i32,
    pub area_w: i32,
    pub area_h: i32,
}

fn empty() -> Canvas {
    Canvas::new(1, 1, Color::TRANSPARENT)
}

// --- Drawing primitives on the frame (an opaque canvas) ---

pub fn fill(frame: &mut Canvas, x: i32, y: i32, w: i32, h: i32, color: Color) {
    let left = x.max(0);
    let top = y.max(0);
    let right = (x + w).min(frame.width as i32);
    let bottom = (y + h).min(frame.height as i32);
    if left >= right || top >= bottom || color.a == 0 {
        return;
    }
    let width = frame.width;
    for row in top as usize..bottom as usize {
        let line = &mut frame.pixels[(row * width + left as usize) * 4..(row * width + right as usize) * 4];
        if color.a == 255 {
            for p in line.chunks_exact_mut(4) {
                p.copy_from_slice(&[color.r, color.g, color.b, 255]);
            }
        } else {
            for o in (0..line.len()).step_by(4) {
                blend(color, o, line, 255);
            }
        }
    }
}

/// Composites the part (sx, sy, sw × sh) of the patch at (x, y), repeated to
/// fill width × height (a one-pixel row or column then stretches), clipped.
#[allow(clippy::too_many_arguments)]
fn blit_part(patch: &Canvas, sx: i32, sy: i32, sw: i32, sh: i32, frame: &mut Canvas, x: i32, y: i32, width: i32, height: i32, clip: (i32, i32, i32, i32)) {
    let top = clip.1.max(0).max(y);
    let bottom = (clip.1 + clip.3).min(frame.height as i32).min(y + height);
    let left = clip.0.max(0).max(x);
    let right = (clip.0 + clip.2).min(frame.width as i32).min(x + width);
    for py in top..bottom {
        let row = sy + (py - y) % sh;
        for px in left..right {
            let column = sx + (px - x) % sw;
            let o = (row as usize * patch.width + column as usize) * 4;
            let p = &patch.pixels[o..o + 4];
            if p[3] > 0 {
                let color = Color { r: p[0], g: p[1], b: p[2], a: p[3] };
                blend(color, (py as usize * frame.width + px as usize) * 4, &mut frame.pixels, 255);
            }
        }
    }
}

pub fn blit(patch: &Canvas, frame: &mut Canvas, x: i32, y: i32) {
    let clip = (0, 0, frame.width as i32, frame.height as i32);
    blit_part(patch, 0, 0, patch.width as i32, patch.height as i32, frame, x, y, patch.width as i32, patch.height as i32, clip);
}

fn document_name(path: &str) -> String {
    if path.is_empty() {
        return "Untitled".into();
    }
    let file = path.rsplit('/').next().unwrap_or(path);
    match file.rfind('.') {
        Some(dot) => file[..dot].to_string(),
        None => file.to_string(),
    }
}

fn document_extension(path: &str) -> String {
    if path.is_empty() {
        return ".ifcx".into();
    }
    let file = path.rsplit('/').next().unwrap_or(path);
    file.rfind('.').map(|dot| file[dot..].to_string()).unwrap_or_default()
}

impl Shell {
    pub fn new() -> Shell {
        let library = freetype::Library::init().expect("FreeType");
        let mut faces: Vec<Face> = [INTER_400, INTER_500, INTER_600, GROTESK_700].iter().map(|data| Face::from_memory(&library, data).expect("interface font")).collect();
        // Monospace, and what fontconfig gives the browser for characters
        // Inter's subset lacks; Inter when the system has no DejaVu.
        for path in ["/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"] {
            let face = Face::from_file(&library, path).unwrap_or_else(|| Face::from_memory(&library, INTER_400).unwrap());
            faces.push(face);
        }
        Shell {
            faces,
            pictures: (0..=ENTRIES.len()).map(|_| (String::new(), empty())).collect(),
            tab: 0,
            opened: -1,
            status: "Concept opgeslagen op dit apparaat".into(),
            dragging: String::new(),
            base: empty(),
            composed: empty(),
            signature: String::new(),
            pen: 0,
            pens: vec![0; ENTRIES.len()],
        }
    }

    pub fn regular(&mut self) -> &mut Face {
        &mut self.faces[0]
    }

    /// The entry's SVG at the size, rasterised once and kept until the size
    /// or the markup changes.
    fn picture(&mut self, index: usize, markup: &str, w: i32, h: i32) -> &Canvas {
        let wanted = format!("{markup}@{w}x{h}");
        if self.pictures[index].0 != wanted {
            self.pictures[index] = (wanted, rasterise(markup, w.max(1) as usize, h.max(1) as usize));
        }
        &self.pictures[index].1
    }

    fn state<'a>(&self, app: &'a App, swatch: &'a str) -> State<'a> {
        State { tab: self.tab, opened: self.opened, filled: !app.steps.is_empty(), tool: app.tool.key(), swatch }
    }

    fn field(&self, name: &str, view: &View) -> String {
        let app = view.app;
        match name {
            "name" => document_name(&app.path),
            "ext" => document_extension(&app.path),
            "w" => app.image.width.to_string(),
            "h" => app.image.height.to_string(),
            "tool" => app.tool.name().to_string(),
            "status" => self.status.clone(),
            "mx" => view.mouse.0.to_string(),
            "my" => view.mouse.1.to_string(),
            "zoom" => ((app.zoom * 100.0).round() as i64).to_string(),
            "count" => app.steps.len().to_string(),
            "opacity" => app.opacity.to_string(),
            "step" => format!("{:02}", view.step),
            "stepname" => app.steps.get(view.step.wrapping_sub(1)).cloned().unwrap_or_default(),
            _ => name.to_string(),
        }
    }

    /// The entry's text with its {fields} filled in.
    fn label(&self, entry: &Entry, view: &View) -> String {
        let text = entry.text;
        if !text.contains('{') {
            return text.to_string();
        }
        let mut out = String::new();
        let mut rest = text;
        while let Some(open) = rest.find('{') {
            out.push_str(&rest[..open]);
            let close = rest[open..].find('}').map(|c| open + c).unwrap_or(rest.len());
            out.push_str(&self.field(&rest[open + 1..close], view));
            rest = rest.get(close + 1..).unwrap_or("");
        }
        out.push_str(rest);
        out
    }

    fn lettering(&mut self, entry: &Entry, b: Box, text: &str, frame: &mut Canvas) {
        let (size, spacing, color) = (entry.size, entry.spacing, entry.color());
        let face = &mut self.faces[entry.face];
        let ascent = face.ascent(size);
        let mut left = (b.left * 64.0).round() as i32;
        if entry.align == 3 {
            // Wrapped: greedy lines as wide as the element, one pitch apart.
            let mut baseline = b.top.round() as i32 + ascent;
            let limit = b.w * 64;
            let mut line = String::new();
            for word in text.split(' ') {
                let candidate = if line.is_empty() { word.to_string() } else { format!("{line} {word}") };
                if face.width(&candidate, size, spacing) > limit && !line.is_empty() {
                    let centered = (limit - face.width(&line, size, spacing)) / 2;
                    face.draw(&line, left + centered, baseline, size, spacing, color, frame);
                    baseline += entry.r[3].round() as i32;
                    line = word.to_string();
                } else {
                    line = candidate;
                }
            }
            if !line.is_empty() {
                let centered = (limit - face.width(&line, size, spacing)) / 2;
                face.draw(&line, left + centered, baseline, size, spacing, color, frame);
            }
            return;
        }
        let mut baseline = b.top.round() as i32 + ascent;
        if entry.align == 4 {
            // Follows the text drawn just before, the measured gap after it.
            left = self.pen + (entry.r[2] * 64.0).round() as i32;
            self.pen = left + face.draw(text, left, baseline, size, spacing, color, frame);
            return;
        }
        if entry.align != 0 {
            let advance = face.width(text, size, spacing);
            let room = b.w * 64;
            if entry.align == 1 {
                left = b.x * 64 + (room - advance) / 2;
                let line_height = ascent + face.descent(size);
                baseline = b.y + (b.h - line_height) / 2 + ascent;
            } else {
                left = b.x * 64 + room - advance;
            }
        }
        self.pen = left + face.draw(text, left, baseline, size, spacing, color, frame);
    }

    // --- Controls: the browser's native widgets as WebKitGTK draws them. ---

    fn control(&mut self, index: usize, entry: &Entry, b: Box, view: &View, frame: &mut Canvas) {
        let app = view.app;
        match entry.action {
            "number" => {
                let face = &mut self.faces[0];
                let baseline = b.y + (b.h - 12) / 2 + face.ascent(10);
                face.draw(&app.size.to_string(), (b.x + 6) * 64, baseline, 10, 0, Color::hex("36363e"), frame);
                let picture = self.picture(index, SPIN, 16, 16).clone();
                blit(&picture, frame, b.x + b.w - 22, b.y + 4);
            }
            "checkbox" => {
                let picture = self.picture(index, CHECK, 13, 13).clone();
                blit(&picture, frame, b.x, b.y);
            }
            "range" => {
                // The opacity slider (1..100) or the status bar's zoom (10..400).
                let (low, high, value, track) = if b.y > view.height - 40 {
                    (10.0, 400.0, app.zoom * 100.0, Color::hex("27272a"))
                } else {
                    (1.0, 100.0, app.opacity as f64, Color::hex("e4e4e7"))
                };
                let fraction = ((value - low) / (high - low)).clamp(0.0, 1.0);
                let thumb = 18;
                let center = b.x + thumb / 2 + (fraction * (b.w - thumb) as f64).round() as i32;
                let middle = b.y + b.h / 2;
                fill(frame, b.x, middle - 2, b.w, 4, track);
                fill(frame, b.x, middle - 2, center - b.x, 4, Color::hex("d97706"));
                let picture = self.picture(index, THUMB, 20, 20).clone();
                blit(&picture, frame, center - 10, middle - 10);
            }
            _ => {}
        }
    }

    // --- The canvas, as the browser editor lays it out ---

    /// The workspace: the measured canvas area of the current tab (the
    /// rectangle in the workspace colour).
    pub fn workspace(&self, app: &App, width: i32, height: i32) -> Box {
        let swatch = app.color.to_hex();
        let state = self.state(app, &swatch);
        for entry in ENTRIES {
            if entry.kind == Kind::Rect && entry.color[0] == 232 && entry.color[2] == 229 && entry.shows(&state) {
                return entry.place(width, height);
            }
        }
        Box { x: 0, y: 224, w: width - 236, h: height - 29 - 224, left: 0.0, top: 224.0 }
    }

    /// Where the canvas sits: centred in the scroll area below the 34-pixel
    /// top line and above the 26-pixel tip, padding 12/24/16, the size caption
    /// 12 pixels below it; the pan moves it from there.
    pub fn stage(&self, app: &App, width: i32, height: i32) -> Stage {
        let area = self.workspace(app, width, height);
        let (area_x, mut area_y, mut area_w, mut area_h) = (area.x, area.y, area.w, area.h);
        if app.focus {
            area_y = 42;
            area_w = width;
            area_h = height - 29 - 42;
        }
        let scale = app.zoom;
        let shown_w = app.image.width as f64 * scale;
        let shown_h = app.image.height as f64 * scale;
        let mut x = area_x as f64 + (area_w as f64 - shown_w) / 2.0 + app.pan_x;
        let scroll_top = (area_y + 34) as f64;
        let room = (area_h - 34 - 26 - 28) as f64;
        let content = shown_h + 23.0;
        let mut y = scroll_top + 12.0 + (room - content) / 2.0 + app.pan_y;
        if content > room {
            y = scroll_top + 12.0 + app.pan_y;
        }
        if shown_w > (area_w - 48) as f64 {
            x = (area_x + 24) as f64 + app.pan_x;
        }
        Stage { x: x.floor(), y: y.floor(), scale, area_x, area_y, area_w, area_h }
    }

    /// The browser editor's fit: whole percents, 10..400.
    pub fn fit(&self, app: &mut App, width: i32, height: i32) {
        let stage = self.stage(app, width, height);
        let across = (stage.area_w - 48) as f64 / app.image.width as f64;
        let down = (stage.area_h - 112) as f64 / app.image.height as f64;
        let percent = ((across.min(down) * 100.0).floor() as i64).clamp(10, 400);
        app.zoom = percent as f64 / 100.0;
        app.pan_x = 0.0;
        app.pan_y = 0.0;
    }

    /// Sets the zoom keeping the canvas point under (x, y) in place.
    pub fn zoom_to(&self, app: &mut App, level: i64, x: f64, y: f64, width: i32, height: i32) {
        let before = self.stage(app, width, height);
        let cx = (x - before.x) / before.scale;
        let cy = (y - before.y) / before.scale;
        app.zoom = level.clamp(10, 400) as f64 / 100.0;
        let after = self.stage(app, width, height);
        app.pan_x += x - (after.x + cx * after.scale);
        app.pan_y += y - (after.y + cy * after.scale);
    }

    fn draw_canvas(&mut self, app: &App, stage: Stage) {
        let image = &app.image;
        let (x, y) = (stage.x as i32, stage.y as i32);
        let w = (image.width as f64 * stage.scale).round() as i32;
        let h = (image.height as f64 * stage.scale).round() as i32;
        let clip = (stage.area_x, stage.area_y + 34, stage.area_w, stage.area_h - 34 - 26);
        // The artboard's shadow and outline: rasterised once around a
        // 200-pixel box, laid around the canvas in nine slices.
        let margin = 44;
        let shadow_slot = self.pictures.len() - 1;
        let patch = self.picture(shadow_slot, SHADOW, 288, 288).clone();
        let frame = &mut self.composed;
        let left_part = margin + 100.min(w / 2);
        let right_part = margin + 100.min(w - w / 2);
        let top_part = margin + 100.min(h / 2);
        let bottom_part = margin + 100.min(h - h / 2);
        let (ox, oy, ow, oh) = (x - margin, y - margin, w + margin * 2, h + margin * 2);
        let middle_w = ow - (left_part + right_part);
        let middle_h = oh - (top_part + bottom_part);
        blit_part(&patch, 0, 0, left_part, top_part, frame, ox, oy, left_part, top_part, clip);
        blit_part(&patch, 288 - right_part, 0, right_part, top_part, frame, ox + ow - right_part, oy, right_part, top_part, clip);
        blit_part(&patch, 0, 288 - bottom_part, left_part, bottom_part, frame, ox, oy + oh - bottom_part, left_part, bottom_part, clip);
        blit_part(&patch, 288 - right_part, 288 - bottom_part, right_part, bottom_part, frame, ox + ow - right_part, oy + oh - bottom_part, right_part, bottom_part, clip);
        if middle_w > 0 {
            blit_part(&patch, 144, 0, 1, top_part, frame, ox + left_part, oy, middle_w, top_part, clip);
            blit_part(&patch, 144, 288 - bottom_part, 1, bottom_part, frame, ox + left_part, oy + oh - bottom_part, middle_w, bottom_part, clip);
        }
        if middle_h > 0 {
            blit_part(&patch, 0, 144, left_part, 1, frame, ox, oy + top_part, left_part, middle_h, clip);
            blit_part(&patch, 288 - right_part, 144, right_part, 1, frame, ox + ow - right_part, oy + top_part, right_part, middle_h, clip);
        }
        // The image over the checkerboard, sampled bilinearly as the browser
        // smooths a scaled canvas; weights in 1/256, per column once.
        let left = x.max(clip.0.max(0));
        let top = y.max(clip.1.max(0));
        let right = (x + w).min((clip.0 + clip.2).min(frame.width as i32));
        let bottom = (y + h).min((clip.1 + clip.3).min(frame.height as i32));
        if right > left && bottom > top {
            let inverse = 1.0 / stage.scale;
            let last_x = image.width as i64 - 1;
            let last_y = image.height as i64 - 1;
            let columns: Vec<(usize, usize, u32)> = (left..right)
                .map(|column| {
                    let sx = ((column - x) as f64 + 0.5) * inverse - 0.5;
                    let fx = sx.floor();
                    ((fx as i64).clamp(0, last_x) as usize * 4, (fx as i64 + 1).clamp(0, last_x) as usize * 4, (((sx - fx) * 256.0).round() as i64).clamp(0, 256) as u32)
                })
                .collect();
            let stride = image.width * 4;
            let source = &image.pixels;
            let fw = frame.width;
            for row in top..bottom {
                let sy = ((row - y) as f64 + 0.5) * inverse - 0.5;
                let floor_y = sy.floor();
                let upper = (floor_y as i64).clamp(0, last_y) as usize * stride;
                let lower = (floor_y as i64 + 1).clamp(0, last_y) as usize * stride;
                let fy = (((sy - floor_y) * 256.0).round() as i64).clamp(0, 256) as u32;
                let gy = 256 - fy;
                let checker_row = ((row - y) / 8) & 1;
                let mut target = (row as usize * fw + left as usize) * 4;
                for (i, &(a, b, fx)) in columns.iter().enumerate() {
                    let column = left + i as i32;
                    let gx = 256 - fx;
                    let (w00, w01, w10, w11) = (gx * gy, fx * gy, gx * fy, fx * fy);
                    let mix = |ch: usize| ((source[upper + a + ch] as u32 * w00 + source[upper + b + ch] as u32 * w01 + source[lower + a + ch] as u32 * w10 + source[lower + b + ch] as u32 * w11 + 32768) >> 16) as u8;
                    let alpha = mix(3);
                    let out = &mut frame.pixels;
                    if alpha == 255 {
                        out[target] = mix(0);
                        out[target + 1] = mix(1);
                        out[target + 2] = mix(2);
                    } else {
                        let checker = if (((column - x) / 8) & 1) ^ checker_row == 1 { 238 } else { 255 };
                        out[target..target + 3].copy_from_slice(&[checker, checker, checker]);
                        out[target + 3] = 255;
                        if alpha > 0 {
                            blend(Color { r: mix(0), g: mix(1), b: mix(2), a: alpha }, target, out, 255);
                        }
                    }
                    out[target + 3] = 255;
                    target += 4;
                }
            }
        }
        // Grid, the corner handle and the caption.
        if app.grid && stage.scale >= 1.0 {
            let spacing = 20.0 * stage.scale;
            let ink = Color { r: 0, g: 0, b: 0, a: 34 };
            let mut line = 0.0;
            while line < w as f64 {
                fill(frame, x + line.floor() as i32, y, 1, h, ink);
                line += spacing;
            }
            line = 0.0;
            while line < h as f64 {
                fill(frame, x, y + line.floor() as i32, w, 1, ink);
                line += spacing;
            }
        }
        fill(frame, x + w - 3, y + h - 3, 6, 6, Color::hex("d97706"));
        fill(frame, x + w - 2, y + h - 2, 4, 4, Color::WHITE);
        let face = &mut self.faces[0];
        let caption = format!("{} × {}", image.width, image.height);
        let caption_width = face.width(&caption, 9, 32);
        let unit_width = face.width("PX", 8, 32);
        let total = caption_width + 3 * 64 + unit_width;
        let start = x * 64 + w * 64 / 2 - total / 2;
        let baseline = y + h + 12 + face.ascent(9);
        let muted = Color { r: 54, g: 54, b: 62, a: 166 };
        face.draw(&caption, start, baseline, 9, 32, muted, &mut self.composed);
        face.draw("PX", start + caption_width + 3 * 64, baseline, 8, 32, muted, &mut self.composed);
    }

    // --- The whole frame ---

    fn draw_entry(&mut self, index: usize, view: &View, frame: &mut Canvas, shift: i32) {
        let entry = &ENTRIES[index];
        let mut b = entry.place(view.width, view.height);
        b.y += shift;
        b.top += shift as f64;
        match entry.kind {
            Kind::Rect => fill(frame, b.x, b.y, b.w, b.h, entry.color()),
            Kind::Image => {
                let markup = SVGS[entry.image as usize];
                let picture = if markup.contains("{color}") {
                    let markup = markup.replace("{color}", &view.app.color.to_hex());
                    self.picture(index, &markup, b.w, b.h).clone()
                } else {
                    self.picture(index, markup, b.w, b.h).clone()
                };
                blit(&picture, frame, b.x, b.y);
            }
            Kind::Text => {
                if entry.align == 4 {
                    // Drawn in a later pass than the text it follows: start
                    // from where that one ended.
                    if let Some(before) = (0..index).rev().find(|&i| ENTRIES[i].kind == Kind::Text) {
                        self.pen = self.pens[before];
                    }
                }
                let text = self.label(entry, view);
                self.lettering(entry, b, &text, frame);
                self.pens[index] = self.pen;
            }
            Kind::Control => self.control(index, entry, b, view, frame),
            Kind::Hit => {}
        }
    }

    /// Everything the chrome shows except the mouse position.
    fn signature_of(&self, app: &App, width: usize, height: usize) -> String {
        format!(
            "{width}x{height}|{}|{}|{}|{}|{}|{}|{}x{}|{}|{}|{}|{}|{}|{}",
            self.tab,
            self.opened,
            app.tool.key(),
            app.color.to_hex(),
            app.steps.len(),
            app.path,
            app.image.width,
            app.image.height,
            (app.zoom * 1000.0).round() as i64,
            app.size,
            app.opacity,
            self.status,
            app.focus,
            app.grid
        )
    }

    /// Draws the shell and the canvas into frame (the window's size). The
    /// chrome is redrawn only when its signature changes and the canvas only
    /// when it changed or the chrome did; the mouse position and open menus
    /// go on top every frame.
    pub fn draw(&mut self, app: &App, frame: &mut Canvas, mouse: (i32, i32), canvas_changed: bool) {
        let (width, height) = (frame.width as i32, frame.height as i32);
        let mut view = View { app, width, height, mouse, step: 0 };
        let swatch = app.color.to_hex();
        let signature = self.signature_of(app, frame.width, frame.height);
        let resized = self.base.width != frame.width || self.base.height != frame.height;
        let mut rebuilt = false;
        if signature != self.signature || resized {
            if resized {
                self.base = Canvas::new(frame.width, frame.height, Color::WHITE);
                self.composed = Canvas::new(frame.width, frame.height, Color::WHITE);
            }
            let mut base = std::mem::replace(&mut self.base, empty());
            for (index, entry) in ENTRIES.iter().enumerate() {
                let state = self.state(app, &swatch);
                if entry.opened < 0 && !follows_mouse(entry) && entry.shows(&state) {
                    self.draw_entry(index, &view, &mut base, 0);
                }
            }
            // History rows: the latest highlighted, newest first.
            let steps = app.steps.len();
            for position in 0..steps {
                view.step = steps - position;
                let shift = (position as f64 * HISTORY_PITCH).round() as i32;
                let wanted = if position == 0 { 0 } else { 1 };
                for (index, entry) in ENTRIES.iter().enumerate() {
                    if entry.row == wanted {
                        self.draw_entry(index, &view, &mut base, shift);
                    }
                }
            }
            self.base = base;
            self.signature = signature;
            rebuilt = true;
        }
        if rebuilt || canvas_changed {
            self.composed.copy_from(&self.base);
            let stage = self.stage(app, width, height);
            self.draw_canvas(app, stage);
        }
        frame.copy_from(&self.composed);
        for (index, entry) in ENTRIES.iter().enumerate() {
            if follows_mouse(entry) && entry.shows(&self.state(app, &swatch)) {
                self.draw_entry(index, &view, frame, 0);
            }
        }
        for (index, entry) in ENTRIES.iter().enumerate() {
            if entry.opened >= 0 && entry.shows(&self.state(app, &swatch)) {
                self.draw_entry(index, &view, frame, 0);
            }
        }
    }

    /// The action of the topmost click region under (x, y), or "".
    pub fn action_at(&self, x: i32, y: i32, app: &App, width: i32, height: i32) -> &'static str {
        let swatch = app.color.to_hex();
        let state = self.state(app, &swatch);
        let mut found = "";
        for entry in ENTRIES {
            if entry.kind == Kind::Hit && entry.shows(&state) && entry.place(width, height).contains(x, y) {
                found = entry.action;
            }
        }
        found
    }

    /// The rectangle of the first click region with the action.
    pub fn hit_box(&self, action: &str, app: &App, width: i32, height: i32) -> Option<Box> {
        let swatch = app.color.to_hex();
        let state = self.state(app, &swatch);
        ENTRIES.iter().find(|e| e.kind == Kind::Hit && e.action == action && e.shows(&state)).map(|e| e.place(width, height))
    }
}

fn follows_mouse(entry: &Entry) -> bool {
    entry.kind == Kind::Text && entry.text.contains("{mx}")
}
