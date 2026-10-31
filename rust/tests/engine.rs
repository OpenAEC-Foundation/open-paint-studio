//! Headless checks of the raster engine, the history and the file layer.
use open_paint_studio::canvas::{self, Canvas, Color, Stroke};
use open_paint_studio::history::{History, LIMIT};

#[test]
fn a_stroke_paints_once_at_its_opacity() {
    let base = Canvas::new(40, 40, Color::WHITE);
    let mut image = base.clone();
    let stroke = Stroke::new(Color::rgb(0, 0, 0), 128, 10, false);
    stroke.line(5.0, 20.0, 35.0, 20.0, &mut image, &base);
    stroke.line(5.0, 20.0, 35.0, 20.0, &mut image, &base);
    assert_eq!(image.get(20, 20), Color::rgb(127, 127, 127));
    assert_eq!(image.get(20, 2), Color::WHITE);
}

#[test]
fn flood_fill_stops_at_a_border() {
    let mut image = Canvas::new(20, 20, Color::WHITE);
    let base = image.clone();
    Stroke::new(Color::rgb(0, 0, 0), 255, 1, false).rectangle(5, 5, 14, 14, false, &mut image, &base);
    canvas::flood_fill(&mut image, 10, 10, Color::rgb(255, 0, 0), 255, 32);
    assert_eq!(image.get(10, 10), Color::rgb(255, 0, 0));
    assert_eq!(image.get(1, 1), Color::WHITE);
}

#[test]
fn quarter_turns_and_flips_return_the_image() {
    let mut image = Canvas::new(3, 2, Color::WHITE);
    image.put(0, 0, Color::rgb(1, 2, 3));
    let turned = canvas::turned(&canvas::turned(&image, true), false);
    assert_eq!(turned.pixels, image.pixels);
    assert_eq!(canvas::turned(&image, true).get(1, 0), Color::rgb(1, 2, 3));
    assert_eq!(canvas::flipped(&canvas::flipped(&image, true), true).pixels, image.pixels);
}

#[test]
fn history_keeps_forty_states_and_shrinks_them() {
    let mut history = History::default();
    let mut image = Canvas::new(100, 100, Color::WHITE);
    for step in 0..45u8 {
        history.remember(&image);
        image.put(step as i64, 50, Color::rgb(step, 0, 0));
        history.settle(&image);
    }
    let mut undone = 0;
    while history.can_undo() {
        image = history.undo(image);
        undone += 1;
    }
    assert_eq!(undone, LIMIT);
    assert_eq!(image.get(4, 50), Color::rgb(4, 0, 0));
    assert_eq!(image.get(5, 50), Color::WHITE);
    image = history.redo(image);
    assert_eq!(image.get(5, 50), Color::rgb(5, 0, 0));
}

#[test]
fn files_round_trip() {
    let folder = std::env::temp_dir().join(format!("ops-files-{}", std::process::id()));
    std::fs::create_dir_all(&folder).unwrap();
    let mut image = Canvas::new(7, 5, Color { r: 10, g: 20, b: 30, a: 128 });
    image.put(6, 4, Color::rgb(200, 100, 50));
    for ext in ["png", "tiff"] {
        let path = folder.join(format!("t.{ext}")).to_string_lossy().to_string();
        open_paint_studio::files::save(&image, &path).unwrap();
        let back = open_paint_studio::files::open(&path).unwrap();
        assert_eq!((back.width, back.height), (7, 5), "{ext}");
        assert_eq!(back.pixels, image.pixels, "{ext}");
    }
    for ext in ["bmp", "ppm", "webp", "ico"] {
        let path = folder.join(format!("t.{ext}")).to_string_lossy().to_string();
        open_paint_studio::files::save(&image, &path).unwrap();
        let back = open_paint_studio::files::open(&path).unwrap();
        assert_eq!((back.width, back.height), (7, 5), "{ext}");
        assert_eq!(back.get(6, 4), Color::rgb(200, 100, 50), "{ext}");
    }
    let path = folder.join("t.jpg").to_string_lossy().to_string();
    open_paint_studio::files::save(&image, &path).unwrap();
    assert_eq!(open_paint_studio::files::open(&path).unwrap().width, 7);
    assert!(open_paint_studio::files::open("/nonexistent.png").is_err());
    std::fs::remove_dir_all(folder).unwrap();
}
