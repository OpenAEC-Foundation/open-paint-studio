//! Opens every image in the folders given and prints one line each: the size
//! read, or the message. The DynLex edition's bench/open_images.dl.
//!
//!     cargo run --release --example open_images FOLDER...
fn main() {
    for folder in std::env::args().skip(1) {
        let mut paths: Vec<_> = std::fs::read_dir(&folder).unwrap().filter_map(|e| e.ok()).map(|e| e.path()).filter(|p| p.is_file()).collect();
        paths.sort();
        for path in paths {
            let name = path.to_string_lossy().to_string();
            match open_paint_studio::files::open(&name) {
                Ok(image) => println!("ok {} x {} {name}", image.width, image.height),
                Err(message) => println!("failed {name}: {message}"),
            }
        }
    }
}
