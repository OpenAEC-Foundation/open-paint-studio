//! SVG to pixels through the system's librsvg and cairo, as the DynLex
//! edition does: the shell's icons and its rounded, bordered and shadowed
//! boxes are SVG, rasterised once per size.
use crate::canvas::{Canvas, Color};
use std::ffi::{c_int, c_void};

#[repr(C)]
struct Rectangle {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

extern "C" {
    fn cairo_image_surface_create(format: c_int, width: c_int, height: c_int) -> *mut c_void;
    fn cairo_create(surface: *mut c_void) -> *mut c_void;
    fn cairo_surface_flush(surface: *mut c_void);
    fn cairo_image_surface_get_data(surface: *mut c_void) -> *const u8;
    fn cairo_image_surface_get_stride(surface: *mut c_void) -> c_int;
    fn cairo_destroy(context: *mut c_void);
    fn cairo_surface_destroy(surface: *mut c_void);
    fn rsvg_handle_new_from_data(data: *const u8, length: usize, error: *mut *mut c_void) -> *mut c_void;
    fn rsvg_handle_render_document(handle: *mut c_void, context: *mut c_void, viewport: *const Rectangle, error: *mut *mut c_void) -> c_int;
    fn g_object_unref(object: *mut c_void);
}

/// The SVG drawn into a new straight-alpha canvas of width × height, its
/// viewport the whole canvas; transparent when it cannot be read.
pub fn rasterise(markup: &str, width: usize, height: usize) -> Canvas {
    let (width, height) = (width.max(1), height.max(1));
    let mut canvas = Canvas::new(width, height, Color::TRANSPARENT);
    unsafe {
        // CAIRO_FORMAT_ARGB32: premultiplied, native-endian B, G, R, A.
        let surface = cairo_image_surface_create(0, width as c_int, height as c_int);
        let context = cairo_create(surface);
        let mut error = std::ptr::null_mut();
        let handle = rsvg_handle_new_from_data(markup.as_ptr(), markup.len(), &mut error);
        if !handle.is_null() {
            let viewport = Rectangle { x: 0.0, y: 0.0, width: width as f64, height: height as f64 };
            rsvg_handle_render_document(handle, context, &viewport, &mut error);
            g_object_unref(handle);
        }
        cairo_surface_flush(surface);
        let data = cairo_image_surface_get_data(surface);
        let stride = cairo_image_surface_get_stride(surface) as usize;
        for row in 0..height {
            let from = std::slice::from_raw_parts(data.add(row * stride), width * 4);
            let to = &mut canvas.pixels[row * width * 4..(row + 1) * width * 4];
            for (t, f) in to.chunks_exact_mut(4).zip(from.chunks_exact(4)) {
                let a = f[3] as u32;
                if a > 0 {
                    let half = a / 2;
                    t.copy_from_slice(&[((f[2] as u32 * 255 + half) / a) as u8, ((f[1] as u32 * 255 + half) / a) as u8, ((f[0] as u32 * 255 + half) / a) as u8, a as u8]);
                }
            }
        }
        cairo_destroy(context);
        cairo_surface_destroy(surface);
    }
    canvas
}
