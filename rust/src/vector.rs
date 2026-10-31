//! SVG to pixels through resvg: the shell's icons and its rounded, bordered
//! and shadowed boxes are SVG, rasterised once per size.
use crate::canvas::{Canvas, Color};
use resvg::{tiny_skia, usvg};

/// Premultiplied to straight alpha, rounded as a browser reads back.
pub fn unpremultiply(pixels: &mut [u8]) {
    for p in pixels.chunks_exact_mut(4) {
        let a = p[3] as u32;
        if a > 0 && a < 255 {
            let half = a / 2;
            p[0] = ((p[0] as u32 * 255 + half) / a) as u8;
            p[1] = ((p[1] as u32 * 255 + half) / a) as u8;
            p[2] = ((p[2] as u32 * 255 + half) / a) as u8;
        }
    }
}

/// The SVG drawn into a new straight-alpha canvas of width × height, its
/// own size stretched to it; transparent when it cannot be read.
pub fn rasterise(markup: &str, width: usize, height: usize) -> Canvas {
    let (width, height) = (width.max(1), height.max(1));
    let Ok(tree) = usvg::Tree::from_str(markup, &usvg::Options::default()) else {
        return Canvas::new(width, height, Color::TRANSPARENT);
    };
    let Some(mut pixmap) = tiny_skia::Pixmap::new(width as u32, height as u32) else {
        return Canvas::new(width, height, Color::TRANSPARENT);
    };
    let size = tree.size();
    let transform = tiny_skia::Transform::from_scale(width as f32 / size.width(), height as f32 / size.height());
    resvg::render(&tree, transform, &mut pixmap.as_mut());
    let mut canvas = Canvas::from_pixels(width, height, pixmap.take());
    unpremultiply(&mut canvas.pixels);
    canvas
}
