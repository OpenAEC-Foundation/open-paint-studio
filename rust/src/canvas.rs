//! The raster canvas: straight-alpha RGBA, eight bits a channel, rows top to
//! bottom, as the browser editor's 2D canvas holds it. Every drawing
//! operation, image command and colour correction works on this type.

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Color {
    pub r: u8,
    pub g: u8,
    pub b: u8,
    pub a: u8,
}

impl Color {
    pub const TRANSPARENT: Color = Color { r: 0, g: 0, b: 0, a: 0 };
    pub const WHITE: Color = Color { r: 255, g: 255, b: 255, a: 255 };

    pub const fn rgb(r: u8, g: u8, b: u8) -> Color {
        Color { r, g, b, a: 255 }
    }

    /// Six hexadecimal digits, "d97706", with or without a leading "#".
    pub fn hex(text: &str) -> Color {
        let digits = text.trim_start_matches('#');
        let value = u32::from_str_radix(digits.get(..6).unwrap_or("000000"), 16).unwrap_or(0);
        Color::rgb((value >> 16) as u8, (value >> 8) as u8, value as u8)
    }

    pub fn to_hex(self) -> String {
        format!("#{:02x}{:02x}{:02x}", self.r, self.g, self.b)
    }

    /// Source-over compositing of self, scaled by opacity (0..255), on base.
    pub fn over(self, base: Color, opacity: i32) -> Color {
        let source = self.a as i32 * opacity / 255;
        if source <= 0 {
            return base;
        }
        let kept = base.a as i32 * (255 - source) / 255;
        let alpha = source + kept;
        if alpha <= 0 {
            return Color::TRANSPARENT;
        }
        Color {
            r: ((self.r as i32 * source + base.r as i32 * kept) / alpha) as u8,
            g: ((self.g as i32 * source + base.g as i32 * kept) / alpha) as u8,
            b: ((self.b as i32 * source + base.b as i32 * kept) / alpha) as u8,
            a: alpha as u8,
        }
    }
}

/// Canvases hold up to 32768 pixels a side and 268 million pixels (1 GB).
pub const LARGEST_SIDE: usize = 32768;
pub const LARGEST_AREA: usize = 268_435_456;

#[derive(Clone)]
pub struct Canvas {
    pub width: usize,
    pub height: usize,
    pub pixels: Vec<u8>,
}

impl Canvas {
    /// A canvas of the size, every pixel the colour; clamped to the limits.
    pub fn new(width: usize, height: usize, color: Color) -> Canvas {
        let width = width.clamp(1, LARGEST_SIDE);
        let mut height = height.clamp(1, LARGEST_SIDE);
        if width * height > LARGEST_AREA {
            height = LARGEST_AREA / width;
        }
        let mut canvas = Canvas { width, height, pixels: Vec::new() };
        canvas.pixels = [color.r, color.g, color.b, color.a].repeat(width * height);
        canvas
    }

    pub fn fits(width: usize, height: usize) -> bool {
        width >= 1 && height >= 1 && width <= LARGEST_SIDE && height <= LARGEST_SIDE && width * height <= LARGEST_AREA
    }

    pub fn from_pixels(width: usize, height: usize, pixels: Vec<u8>) -> Canvas {
        Canvas { width, height, pixels }
    }

    pub fn fill(&mut self, color: Color) {
        for pixel in self.pixels.chunks_exact_mut(4) {
            pixel.copy_from_slice(&[color.r, color.g, color.b, color.a]);
        }
    }

    /// Copies the pixels of source in; both have the same size.
    pub fn copy_from(&mut self, source: &Canvas) {
        if self.width == source.width && self.height == source.height {
            self.pixels.copy_from_slice(&source.pixels);
        }
    }

    pub fn contains(&self, x: i64, y: i64) -> bool {
        x >= 0 && y >= 0 && (x as usize) < self.width && (y as usize) < self.height
    }

    pub fn get(&self, x: i64, y: i64) -> Color {
        if !self.contains(x, y) {
            return Color::TRANSPARENT;
        }
        let o = (y as usize * self.width + x as usize) * 4;
        let p = &self.pixels[o..o + 4];
        Color { r: p[0], g: p[1], b: p[2], a: p[3] }
    }

    pub fn put(&mut self, x: i64, y: i64, color: Color) {
        if self.contains(x, y) {
            let o = (y as usize * self.width + x as usize) * 4;
            self.pixels[o..o + 4].copy_from_slice(&[color.r, color.g, color.b, color.a]);
        }
    }
}

/// One stroke paints every pixel once at the stroke's opacity, as a canvas
/// path with a global alpha does: each pixel is composited on the stroke's
/// starting image (base), so overlapping dabs never darken each other.
#[derive(Clone, Copy)]
pub struct Stroke {
    pub color: Color,
    pub opacity: i32,
    pub radius: f64,
    pub erasing: bool,
    amount: i32,
}

impl Stroke {
    pub fn new(color: Color, opacity: i32, size: i32, erasing: bool) -> Stroke {
        let opacity = opacity.clamp(0, 255);
        Stroke { color, opacity, radius: size.clamp(1, 200) as f64 / 2.0, erasing, amount: color.a as i32 * opacity / 255 }
    }

    /// Paints the pixel at the byte offset, composited on the same pixel of
    /// source. An opaque pixel below needs no division by the result's alpha.
    #[inline]
    fn blend(&self, offset: usize, target: &mut [u8], source: &[u8]) {
        let alpha = source[offset + 3] as i32;
        if self.erasing {
            target[offset] = source[offset];
            target[offset + 1] = source[offset + 1];
            target[offset + 2] = source[offset + 2];
            target[offset + 3] = (alpha * (255 - self.opacity) / 255) as u8;
            return;
        }
        let c = self.color;
        if alpha == 255 && self.amount == 255 {
            target[offset..offset + 4].copy_from_slice(&[c.r, c.g, c.b, 255]);
        } else if alpha == 255 {
            let kept = 255 - self.amount;
            target[offset] = ((c.r as i32 * self.amount + source[offset] as i32 * kept) / 255) as u8;
            target[offset + 1] = ((c.g as i32 * self.amount + source[offset + 1] as i32 * kept) / 255) as u8;
            target[offset + 2] = ((c.b as i32 * self.amount + source[offset + 2] as i32 * kept) / 255) as u8;
            target[offset + 3] = 255;
        } else {
            let below = Color { r: source[offset], g: source[offset + 1], b: source[offset + 2], a: alpha as u8 };
            let p = c.over(below, self.opacity);
            target[offset..offset + 4].copy_from_slice(&[p.r, p.g, p.b, p.a]);
        }
    }

    /// Paints columns left..=right of the row, already clipped.
    fn span(&self, row: usize, left: usize, right: usize, image: &mut Canvas, base: Option<&Canvas>) {
        let start = (row * image.width + left) * 4;
        let end = (row * image.width + right + 1) * 4;
        match base {
            Some(base) => {
                for o in (start..end).step_by(4) {
                    self.blend(o, &mut image.pixels, &base.pixels);
                }
            }
            None => {
                for o in (start..end).step_by(4) {
                    let mut before = [0u8; 4];
                    before.copy_from_slice(&image.pixels[o..o + 4]);
                    let mut source = [0u8; 4];
                    source.copy_from_slice(&before);
                    let mut out = before;
                    self.blend(0, &mut out, &source);
                    image.pixels[o..o + 4].copy_from_slice(&out);
                }
            }
        }
    }

    /// A round dab centred on (x, y).
    pub fn dab(&self, x: f64, y: f64, image: &mut Canvas, base: &Canvas) {
        let r = self.radius;
        let top = (y - r).floor() as i64;
        let bottom = (y + r).ceil() as i64;
        let limit = r * r + 0.25;
        let first = ((x - r).floor() as i64).max(0);
        let last = ((x + r).ceil() as i64).min(image.width as i64 - 1);
        for row in top.max(0)..=bottom.min(image.height as i64 - 1) {
            let dy = row as f64 + 0.5 - y;
            let room = limit - dy * dy;
            if room < 0.0 {
                continue;
            }
            let reach = room.sqrt();
            let mut low = ((x - 0.5 - reach).floor() as i64).max(first);
            let mut high = ((x - 0.5 + reach).ceil() as i64).min(last);
            let outside = |c: i64| {
                let dx = c as f64 + 0.5 - x;
                dx * dx + dy * dy > limit
            };
            while low <= high && outside(low) {
                low += 1;
            }
            while high >= low && outside(high) {
                high -= 1;
            }
            if low <= high {
                self.span(row as usize, low as usize, high as usize, image, Some(base));
            }
        }
    }

    /// Dabs along the segment, at most half the radius apart.
    pub fn line(&self, x1: f64, y1: f64, x2: f64, y2: f64, image: &mut Canvas, base: &Canvas) {
        let (dx, dy) = (x2 - x1, y2 - y1);
        let length = (dx * dx + dy * dy).sqrt();
        let spacing = (self.radius / 2.0).max(0.5);
        let steps = (length / spacing).ceil() as i64 + 1;
        for i in 0..steps {
            let f = if steps > 1 { i as f64 / (steps - 1) as f64 } else { 1.0 };
            self.dab(x1 + dx * f, y1 + dy * f, image, base);
        }
    }

    pub fn rectangle(&self, x1: i64, y1: i64, x2: i64, y2: i64, filled: bool, image: &mut Canvas, base: &Canvas) {
        let (left, right, top, bottom) = (x1.min(x2), x1.max(x2), y1.min(y2), y1.max(y2));
        if filled {
            let first = left.max(0);
            let last = right.min(image.width as i64 - 1);
            if first <= last {
                for row in top.max(0)..=bottom.min(image.height as i64 - 1) {
                    self.span(row as usize, first as usize, last as usize, image, Some(base));
                }
            }
            return;
        }
        let (l, r, t, b) = (left as f64, right as f64, top as f64, bottom as f64);
        self.line(l, t, r, t, image, base);
        self.line(r, t, r, b, image, base);
        self.line(r, b, l, b, image, base);
        self.line(l, b, l, t, image, base);
    }

    pub fn ellipse(&self, x1: i64, y1: i64, x2: i64, y2: i64, filled: bool, image: &mut Canvas, base: &Canvas) {
        let cx = (x1 + x2) as f64 / 2.0;
        let cy = (y1 + y2) as f64 / 2.0;
        let rx = (x2 - x1).abs().max(1) as f64 / 2.0;
        let ry = (y2 - y1).abs().max(1) as f64 / 2.0;
        if filled {
            let first = ((cx - rx).floor() as i64).max(0);
            let last = ((cx + rx).ceil() as i64).min(image.width as i64 - 1);
            for row in ((cy - ry).floor() as i64).max(0)..=((cy + ry).ceil() as i64).min(image.height as i64 - 1) {
                let ny = (row as f64 + 0.5 - cy) / ry;
                let room = 1.0 - ny * ny;
                if room < 0.0 {
                    continue;
                }
                let reach = room.sqrt() * rx;
                let mut low = ((cx - 0.5 - reach).floor() as i64).max(first);
                let mut high = ((cx - 0.5 + reach).ceil() as i64).min(last);
                let outside = |c: i64| {
                    let nx = (c as f64 + 0.5 - cx) / rx;
                    nx * nx + ny * ny > 1.0
                };
                while low <= high && outside(low) {
                    low += 1;
                }
                while high >= low && outside(high) {
                    high -= 1;
                }
                if low <= high {
                    self.span(row as usize, low as usize, high as usize, image, Some(base));
                }
            }
            return;
        }
        let segments = rx.max(ry) as i64 + 24;
        let (mut px, mut py) = (cx + rx, cy);
        for i in 1..=segments {
            let angle = i as f64 * std::f64::consts::TAU / segments as f64;
            let (qx, qy) = (cx + rx * angle.cos(), cy + ry * angle.sin());
            self.line(px, py, qx, qy, image, base);
            px = qx;
            py = qy;
        }
    }
}

fn matches(p: &[u8], target: Color, tolerance: i32) -> bool {
    (p[0] as i32 - target.r as i32).abs() <= tolerance
        && (p[1] as i32 - target.g as i32).abs() <= tolerance
        && (p[2] as i32 - target.b as i32).abs() <= tolerance
        && (p[3] as i32 - target.a as i32).abs() <= tolerance
}

/// Flood fill of the 4-connected region around (x, y) whose colour lies
/// within tolerance of the clicked colour, one scanline span at a time.
pub fn flood_fill(image: &mut Canvas, x: i64, y: i64, color: Color, opacity: i32, tolerance: i32) {
    if !image.contains(x, y) {
        return;
    }
    let target = image.get(x, y);
    if color.over(target, opacity) == target {
        return;
    }
    let stroke = Stroke::new(color, opacity, 1, false);
    let (width, height) = (image.width, image.height);
    let mut visited = vec![false; width * height];
    let mut pending = vec![y as usize * width + x as usize];
    let px = |image: &Canvas, i: usize| matches(&image.pixels[i * 4..i * 4 + 4], target, tolerance);
    while let Some(seed) = pending.pop() {
        let row = seed / width;
        let start = row * width;
        let mut left = seed % width;
        while left > 0 && !visited[start + left - 1] && px(image, start + left - 1) {
            left -= 1;
        }
        let mut right = left;
        let (mut above_open, mut below_open) = (false, false);
        while right < width && !visited[start + right] && px(image, start + right) {
            stroke.span(row, right, right, image, None);
            visited[start + right] = true;
            if row > 0 {
                let above = start - width + right;
                let m = !visited[above] && px(image, above);
                if m && !above_open {
                    pending.push(above);
                }
                above_open = m;
            }
            if row < height - 1 {
                let below = start + width + right;
                let m = !visited[below] && px(image, below);
                if m && !below_open {
                    pending.push(below);
                }
                below_open = m;
            }
            right += 1;
        }
    }
}

// --- Image commands. Each returns a new canvas. ---

pub fn cropped(image: &Canvas, x1: i64, y1: i64, x2: i64, y2: i64) -> Canvas {
    let left = x1.min(x2).clamp(0, image.width as i64 - 1) as usize;
    let top = y1.min(y2).clamp(0, image.height as i64 - 1) as usize;
    let right = x1.max(x2).clamp(left as i64 + 1, image.width as i64) as usize;
    let bottom = y1.max(y2).clamp(top as i64 + 1, image.height as i64) as usize;
    let w = right - left;
    let mut pixels = Vec::with_capacity(w * (bottom - top) * 4);
    for row in top..bottom {
        let o = (row * image.width + left) * 4;
        pixels.extend_from_slice(&image.pixels[o..o + w * 4]);
    }
    Canvas::from_pixels(w, bottom - top, pixels)
}

/// Copies patch into image with its top-left corner at (x, y).
pub fn paste(patch: &Canvas, image: &mut Canvas, x: usize, y: usize) {
    for row in 0..patch.height {
        let o = ((row + y) * image.width + x) * 4;
        image.pixels[o..o + patch.width * 4].copy_from_slice(&patch.pixels[row * patch.width * 4..(row + 1) * patch.width * 4]);
    }
}

fn between(low: u8, high: u8, fraction: f64) -> u8 {
    (low as f64 + (high as f64 - low as f64) * fraction).round() as u8
}

/// Bilinear resampling to the new size, as the browser's smoothed drawImage.
pub fn resized(image: &Canvas, width: usize, height: usize) -> Canvas {
    let mut result = Canvas::new(width, height, Color::TRANSPARENT);
    let sx_scale = image.width as f64 / result.width as f64;
    let sy_scale = image.height as f64 / result.height as f64;
    let columns: Vec<(usize, usize, f64)> = (0..result.width)
        .map(|c| {
            let sx = ((c as f64 + 0.5) * sx_scale - 0.5).clamp(0.0, (image.width - 1) as f64);
            let x0 = sx.floor() as usize;
            (x0 * 4, (x0 + 1).min(image.width - 1) * 4, sx - x0 as f64)
        })
        .collect();
    let stride = image.width * 4;
    let s = &image.pixels;
    for row in 0..result.height {
        let sy = ((row as f64 + 0.5) * sy_scale - 0.5).clamp(0.0, (image.height - 1) as f64);
        let y0 = sy.floor() as usize;
        let fy = sy - y0 as f64;
        let upper = y0 * stride;
        let lower = (y0 + 1).min(image.height - 1) * stride;
        let mut o = row * result.width * 4;
        for &(a, b, fx) in &columns {
            for ch in 0..4 {
                let u = between(s[upper + a + ch], s[upper + b + ch], fx);
                let l = between(s[lower + a + ch], s[lower + b + ch], fx);
                result.pixels[o + ch] = between(u, l, fy);
            }
            o += 4;
        }
    }
    result
}

/// Quarter turns.
pub fn turned(image: &Canvas, clockwise: bool) -> Canvas {
    let (w, h) = (image.width, image.height);
    let mut out = vec![0u8; w * h * 4];
    for row in 0..h {
        for col in 0..w {
            let to = if clockwise { col * h + (h - 1 - row) } else { (w - 1 - col) * h + row };
            let from = (row * w + col) * 4;
            out[to * 4..to * 4 + 4].copy_from_slice(&image.pixels[from..from + 4]);
        }
    }
    Canvas::from_pixels(h, w, out)
}

pub fn flipped(image: &Canvas, horizontal: bool) -> Canvas {
    let (w, h) = (image.width, image.height);
    let mut out = vec![0u8; w * h * 4];
    for row in 0..h {
        let from = &image.pixels[row * w * 4..(row + 1) * w * 4];
        if horizontal {
            for col in 0..w {
                let to = (row * w + w - 1 - col) * 4;
                out[to..to + 4].copy_from_slice(&from[col * 4..col * 4 + 4]);
            }
        } else {
            out[(h - 1 - row) * w * 4..(h - row) * w * 4].copy_from_slice(from);
        }
    }
    Canvas::from_pixels(w, h, out)
}

// --- Colour corrections, the same formulas as shared/adjustments.ts. ---

#[derive(Clone, Copy, PartialEq)]
pub enum Adjustment {
    Adjust,
    Grayscale,
    Invert,
    Sepia,
}

fn byte(v: f64) -> u8 {
    v.round().clamp(0.0, 255.0) as u8
}

/// brightness and contrast run from -100 to 100, saturation 0..200.
pub fn adjust(image: &mut Canvas, kind: Adjustment, brightness: i32, contrast: i32, saturation: i32) {
    let c = contrast.clamp(-100, 100) as f64 * 2.55;
    let factor = 259.0 * (c + 255.0) / (255.0 * (259.0 - c));
    let lift = brightness as f64 * 2.55;
    let amount = if kind == Adjustment::Grayscale { 0.0 } else { saturation as f64 / 100.0 };
    for p in image.pixels.chunks_exact_mut(4) {
        let (mut r, mut g, mut b) = (p[0] as f64, p[1] as f64, p[2] as f64);
        match kind {
            Adjustment::Invert => {
                r = 255.0 - r;
                g = 255.0 - g;
                b = 255.0 - b;
            }
            Adjustment::Sepia => {
                let (a, c, d) = (r, g, b);
                r = 0.393 * a + 0.769 * c + 0.189 * d;
                g = 0.349 * a + 0.686 * c + 0.168 * d;
                b = 0.272 * a + 0.534 * c + 0.131 * d;
            }
            _ => {
                let l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
                r = l + (r - l) * amount;
                g = l + (g - l) * amount;
                b = l + (b - l) * amount;
            }
        }
        p[0] = byte(factor * (r - 128.0) + 128.0 + lift);
        p[1] = byte(factor * (g - 128.0) + 128.0 + lift);
        p[2] = byte(factor * (b - 128.0) + 128.0 + lift);
    }
}
