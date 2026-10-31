//! Opens one image through the editor's file layer and times what a user
//! waits for: decoding, the first full frame of the window (shell and canvas,
//! fitted) and redraws of the canvas at ten zoom levels. The same steps as
//! the DynLex edition's bench/large.dl. Prints one line of key=value pairs.
//!
//!     cargo run --release --example large IMAGE
use open_paint_studio::app::App;
use open_paint_studio::canvas::{Canvas, Color};
use open_paint_studio::shell::Shell;
use std::time::Instant;

fn main() {
    let path = std::env::args().nth(1).expect("IMAGE");
    let mut shell = Shell::new();
    let mut frame = Canvas::new(1440, 940, Color::WHITE);
    // The interface's SVGs are rasterised on the first frame: not part of opening.
    let warm = App::new(1200, 800);
    shell.draw(&warm, &mut frame, (0, 0), true);

    let began = Instant::now();
    let opened = open_paint_studio::files::open(&path);
    let decoded = began.elapsed();
    let image = match opened {
        Ok(image) => image,
        Err(message) => {
            println!("error={message}");
            std::process::exit(1);
        }
    };
    let mut app = App::new(1200, 800);
    app.base = image.clone();
    app.image = image;
    let began = Instant::now();
    shell.fit(&mut app, 1440, 940);
    shell.draw(&app, &mut frame, (0, 0), true);
    let first = began.elapsed();
    let began = Instant::now();
    for step in 1..=10 {
        app.zoom = step as f64 / 10.0;
        shell.draw(&app, &mut frame, (step, step), true);
    }
    let frames = began.elapsed() / 10;
    // Read the results, so nothing is optimised away.
    let checksum: u64 = frame.pixels.iter().step_by(4099).map(|&v| v as u64).sum();
    println!(
        "width={} height={} decode_ms={} first_frame_ms={} zoom_frame_ms={} checksum={checksum}",
        app.image.width,
        app.image.height,
        decoded.as_millis(),
        first.as_millis(),
        frames.as_millis()
    );
}
