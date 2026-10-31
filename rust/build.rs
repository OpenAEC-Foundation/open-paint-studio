// The system libraries the editor calls, linked by their sonames (only the
// runtime libraries are needed): HarfBuzz for shaping, and gdk-pixbuf,
// librsvg and cairo for image files and SVG, as the DynLex edition uses them.
// All are part of every GNOME desktop.
//
// The window icon is decoded here, so starting the program needs no image
// decoder (gdk-pixbuf would start its sandboxed loader for it).
use std::io::Write;

fn main() {
    for library in ["libharfbuzz.so.0", "libgdk_pixbuf-2.0.so.0", "librsvg-2.so.2", "libcairo.so.2", "libgobject-2.0.so.0", "libglib-2.0.so.0"] {
        println!("cargo:rustc-link-lib=dylib:+verbatim={library}");
    }
    let source = "assets/icon/open-paint-studio-64.png";
    println!("cargo:rerun-if-changed={source}");
    let mut decoder = png::Decoder::new(std::io::BufReader::new(std::fs::File::open(source).unwrap()));
    decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::ALPHA);
    let mut reader = decoder.read_info().unwrap();
    let mut pixels = vec![0; reader.output_buffer_size().unwrap()];
    let info = reader.next_frame(&mut pixels).unwrap();
    assert_eq!(info.color_type, png::ColorType::Rgba);
    let out = std::path::Path::new(&std::env::var("OUT_DIR").unwrap()).join("icon.rgba");
    let mut file = std::fs::File::create(out).unwrap();
    file.write_all(&info.width.to_le_bytes()).unwrap();
    file.write_all(&info.height.to_le_bytes()).unwrap();
    file.write_all(&pixels[..info.buffer_size()]).unwrap();
}
