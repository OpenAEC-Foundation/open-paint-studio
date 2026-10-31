//! Opening and saving images through the system's gdk-pixbuf, as the DynLex
//! edition does: JPEG, PNG, GIF, BMP, TIFF, ICO, PNM, TGA, QOI and whatever
//! loaders are installed (WebP, AVIF, HEIC, JPEG XL, SVG). Pixels arrive as
//! straight-alpha RGBA at full size, turned upright by their EXIF
//! orientation. PPM is written here.
use crate::canvas::Canvas;
use std::ffi::{c_char, c_int, c_void, CStr, CString};
use std::path::Path;

#[repr(C)]
struct GError {
    domain: u32,
    code: c_int,
    message: *const c_char,
}

extern "C" {
    fn gdk_pixbuf_new_from_file(path: *const c_char, error: *mut *mut GError) -> *mut c_void;
    fn gdk_pixbuf_apply_embedded_orientation(pixbuf: *mut c_void) -> *mut c_void;
    fn gdk_pixbuf_get_width(pixbuf: *const c_void) -> c_int;
    fn gdk_pixbuf_get_height(pixbuf: *const c_void) -> c_int;
    fn gdk_pixbuf_get_n_channels(pixbuf: *const c_void) -> c_int;
    fn gdk_pixbuf_get_rowstride(pixbuf: *const c_void) -> c_int;
    fn gdk_pixbuf_get_bits_per_sample(pixbuf: *const c_void) -> c_int;
    fn gdk_pixbuf_read_pixels(pixbuf: *const c_void) -> *const u8;
    fn gdk_pixbuf_new_from_data(
        data: *const u8,
        colorspace: c_int,
        alpha: c_int,
        bits: c_int,
        width: c_int,
        height: c_int,
        stride: c_int,
        destroy: *const c_void,
        destroy_data: *const c_void,
    ) -> *mut c_void;
    fn gdk_pixbuf_savev(pixbuf: *mut c_void, path: *const c_char, kind: *const c_char, keys: *const *const c_char, values: *const *const c_char, error: *mut *mut GError) -> c_int;
    fn g_object_unref(object: *mut c_void);
    fn g_error_free(error: *mut GError);
}

fn extension(path: &str) -> String {
    Path::new(path).extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase()
}

/// The gdk-pixbuf type a path saves as, judged by its extension; "ppm" is
/// written here.
pub fn save_format(path: &str) -> Option<&'static str> {
    Some(match extension(path).as_str() {
        "png" => "png",
        "jpg" | "jpeg" => "jpeg",
        "bmp" => "bmp",
        "tif" | "tiff" => "tiff",
        "ico" => "ico",
        "webp" => "webp",
        "avif" => "avif",
        "ppm" | "pnm" => "ppm",
        _ => return None,
    })
}

/// The message of the GError, freed with it; its first line only.
fn message(error: *mut GError, otherwise: &str) -> String {
    if error.is_null() {
        return otherwise.into();
    }
    let text = unsafe { CStr::from_ptr((*error).message).to_string_lossy().lines().next().unwrap_or("").to_string() };
    unsafe { g_error_free(error) };
    text
}

/// The pixbuf's pixels as a canvas; the pixbuf is released.
fn canvas_of(pixbuf: *mut c_void) -> Result<Canvas, String> {
    unsafe {
        // Photos carry their camera orientation in EXIF; show them upright.
        let upright = gdk_pixbuf_apply_embedded_orientation(pixbuf);
        g_object_unref(pixbuf);
        let (w, h) = (gdk_pixbuf_get_width(upright) as usize, gdk_pixbuf_get_height(upright) as usize);
        let channels = gdk_pixbuf_get_n_channels(upright) as usize;
        let stride = gdk_pixbuf_get_rowstride(upright) as usize;
        if gdk_pixbuf_get_bits_per_sample(upright) != 8 || !(channels == 3 || channels == 4) || !Canvas::fits(w, h) {
            g_object_unref(upright);
            return Err("the image is larger than 32768 pixels a side or 268 million pixels".into());
        }
        let source = gdk_pixbuf_read_pixels(upright);
        let mut pixels = vec![0u8; w * h * 4];
        for row in 0..h {
            let from = std::slice::from_raw_parts(source.add(row * stride), w * channels);
            let to = &mut pixels[row * w * 4..(row + 1) * w * 4];
            if channels == 4 {
                to.copy_from_slice(from);
            } else {
                for (t, f) in to.chunks_exact_mut(4).zip(from.chunks_exact(3)) {
                    t.copy_from_slice(&[f[0], f[1], f[2], 255]);
                }
            }
        }
        g_object_unref(upright);
        Ok(Canvas::from_pixels(w, h, pixels))
    }
}

/// The image at path, or a readable message.
pub fn open(path: &str) -> Result<Canvas, String> {
    let name = CString::new(path).map_err(|e| e.to_string())?;
    let mut error = std::ptr::null_mut();
    let pixbuf = unsafe { gdk_pixbuf_new_from_file(name.as_ptr(), &mut error) };
    if pixbuf.is_null() {
        return Err(message(error, "gdk-pixbuf could not read the file"));
    }
    canvas_of(pixbuf)
}

/// The image composited on white, as RGB: for formats without alpha.
fn flattened(image: &Canvas) -> Vec<u8> {
    image
        .pixels
        .chunks_exact(4)
        .flat_map(|p| {
            let a = p[3] as u32;
            let mix = |c: u8| ((c as u32 * a + 255 * (255 - a) + 127) / 255) as u8;
            [mix(p[0]), mix(p[1]), mix(p[2])]
        })
        .collect()
}

/// Saves in the format the extension names; PNG when it names none.
pub fn save(image: &Canvas, path: &str) -> Result<(), String> {
    let kind = save_format(path).unwrap_or("png");
    if kind == "ppm" {
        let mut data = format!("P6\n{} {}\n255\n", image.width, image.height).into_bytes();
        data.extend(flattened(image));
        return std::fs::write(path, data).map_err(|e| e.to_string());
    }
    let alpha = kind != "jpeg";
    let data = if alpha { image.pixels.clone() } else { flattened(image) };
    let channels = if alpha { 4 } else { 3 };
    let (name, kind_name) = (CString::new(path).map_err(|e| e.to_string())?, CString::new(kind).unwrap());
    unsafe {
        let pixbuf = gdk_pixbuf_new_from_data(data.as_ptr(), 0, alpha as c_int, 8, image.width as c_int, image.height as c_int, (image.width * channels) as c_int, std::ptr::null(), std::ptr::null());
        let mut error = std::ptr::null_mut();
        let saved = gdk_pixbuf_savev(pixbuf, name.as_ptr(), kind_name.as_ptr(), std::ptr::null(), std::ptr::null(), &mut error);
        g_object_unref(pixbuf);
        if saved == 0 {
            return Err(message(error, "gdk-pixbuf could not write the file"));
        }
    }
    Ok(())
}
