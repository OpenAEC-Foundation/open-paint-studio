//! Opening and saving images: the `image` crate's decoders and encoders, and
//! SVG through resvg. Pixels arrive as straight-alpha RGBA at full size,
//! turned upright by their EXIF orientation.
use crate::canvas::{Canvas, LARGEST_AREA, LARGEST_SIDE};
use image::{DynamicImage, ImageDecoder, ImageFormat, ImageReader, Limits};
use std::path::Path;

fn extension(path: &str) -> String {
    Path::new(path).extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase()
}

/// The format a path saves as, judged by its extension.
pub fn save_format(path: &str) -> Option<ImageFormat> {
    match extension(path).as_str() {
        "png" => Some(ImageFormat::Png),
        "bmp" => Some(ImageFormat::Bmp),
        "ppm" | "pnm" => Some(ImageFormat::Pnm),
        "jpg" | "jpeg" => Some(ImageFormat::Jpeg),
        "webp" => Some(ImageFormat::WebP),
        "tif" | "tiff" => Some(ImageFormat::Tiff),
        "ico" => Some(ImageFormat::Ico),
        "tga" => Some(ImageFormat::Tga),
        "qoi" => Some(ImageFormat::Qoi),
        _ => None,
    }
}

fn limits() -> Limits {
    let mut limits = Limits::no_limits();
    limits.max_image_width = Some(LARGEST_SIDE as u32);
    limits.max_image_height = Some(LARGEST_SIDE as u32);
    limits
}

fn open_svg(path: &str) -> Result<Canvas, String> {
    use resvg::{tiny_skia, usvg};
    let data = std::fs::read(path).map_err(|e| e.to_string())?;
    let tree = usvg::Tree::from_data(&data, &usvg::Options::default()).map_err(|e| e.to_string())?;
    let size = tree.size().to_int_size();
    let mut pixmap = tiny_skia::Pixmap::new(size.width(), size.height()).ok_or("empty SVG")?;
    resvg::render(&tree, tiny_skia::Transform::default(), &mut pixmap.as_mut());
    let mut canvas = Canvas::from_pixels(size.width() as usize, size.height() as usize, pixmap.take());
    crate::vector::unpremultiply(&mut canvas.pixels);
    Ok(canvas)
}

/// The image at path, or a readable message.
pub fn open(path: &str) -> Result<Canvas, String> {
    if extension(path) == "svg" {
        return open_svg(path);
    }
    let mut reader = ImageReader::open(path).map_err(|e| e.to_string())?.with_guessed_format().map_err(|e| e.to_string())?;
    reader.limits(limits());
    if reader.format().is_none() {
        return Err("unknown image format".into());
    }
    let mut decoder = reader.into_decoder().map_err(|e| e.to_string())?;
    let (w, h) = decoder.dimensions();
    if (w as usize) * (h as usize) > LARGEST_AREA {
        return Err(format!("{w} × {h} is more than {LARGEST_AREA} pixels"));
    }
    let orientation = decoder.orientation().unwrap_or(image::metadata::Orientation::NoTransforms);
    let mut picture = DynamicImage::from_decoder(decoder).map_err(|e| e.to_string())?;
    picture.apply_orientation(orientation);
    let rgba = match picture {
        DynamicImage::ImageRgba8(rgba) => rgba,
        other => other.to_rgba8(),
    };
    let (w, h) = rgba.dimensions();
    Ok(Canvas::from_pixels(w as usize, h as usize, rgba.into_raw()))
}

/// Saves in the format the extension names; PNG when it names none.
pub fn save(image: &Canvas, path: &str) -> Result<(), String> {
    let format = save_format(path).unwrap_or(ImageFormat::Png);
    let rgba = image::RgbaImage::from_raw(image.width as u32, image.height as u32, image.pixels.clone()).ok_or("bad canvas")?;
    let picture = DynamicImage::ImageRgba8(rgba);
    let result = match format {
        // No alpha in these: composite on white first, as the browser's export does.
        ImageFormat::Jpeg | ImageFormat::Pnm => {
            let mut rgb = image::RgbImage::new(image.width as u32, image.height as u32);
            for (out, p) in rgb.pixels_mut().zip(image.pixels.chunks_exact(4)) {
                let a = p[3] as u32;
                let mix = |c: u8| ((c as u32 * a + 255 * (255 - a) + 127) / 255) as u8;
                *out = image::Rgb([mix(p[0]), mix(p[1]), mix(p[2])]);
            }
            DynamicImage::ImageRgb8(rgb).save_with_format(path, format)
        }
        ImageFormat::Ico if image.width > 256 || image.height > 256 => {
            picture.resize(256, 256, image::imageops::FilterType::Triangle).save_with_format(path, format)
        }
        _ => picture.save_with_format(path, format),
    };
    result.map_err(|e| e.to_string())
}
