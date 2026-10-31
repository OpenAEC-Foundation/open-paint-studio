//! Open Paint Studio, the native Rust edition of OpenAEC Paint Studio.
//!
//!     open-paint-studio [IMAGE]
//!
//! Opens IMAGE or a new 1200 × 800 canvas. The window shows the browser
//! editor's interface, measured and redrawn by shell.rs. Mouse: left draws
//! with the current tool, middle drags to pan, the wheel zooms around the
//! cursor. Keys: B brush, E eraser, F fill, I picker, L line, R rectangle,
//! O ellipse, T text, C crop, G grid; Ctrl+Z / Ctrl+Y undo and redo, Ctrl+S
//! save, Ctrl+O open, Ctrl+N new canvas, + / - zoom, 0 fit, Delete clears,
//! Escape cancels.
use open_paint_studio::app::{command_of_action, App, Command, Tool};
use open_paint_studio::canvas::{Canvas, Color};
use open_paint_studio::shell::Shell;
use open_paint_studio::typeset::Face;
use open_paint_studio::window::{keys, Event, Window};
use std::process::Command as Process;
use std::time::Instant;

/// The 64-pixel icon as width, height (little-endian) and RGBA, from build.rs.
static ICON: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/icon.rgba"));

// --- Dialogs through zenity, as the DynLex edition; "" when cancelled. ---

fn zenity(arguments: &[&str]) -> String {
    Process::new("zenity")
        .args(arguments)
        .stderr(std::process::Stdio::null())
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim_end_matches(['\n', '\r']).to_string())
        .unwrap_or_default()
}

fn path_to_open() -> String {
    zenity(&[
        "--file-selection",
        "--title=Open image",
        "--file-filter=Images | *.png *.PNG *.jpg *.jpeg *.JPG *.gif *.bmp *.webp *.avif *.heic *.jxl *.tif *.tiff *.ico *.tga *.qoi *.ppm *.pnm *.svg",
        "--file-filter=All files | *",
    ])
}

fn path_to_save() -> String {
    let chosen = zenity(&[
        "--file-selection",
        "--save",
        "--confirm-overwrite",
        "--title=Save image",
        "--filename=painting.png",
        "--file-filter=PNG | *.png",
        "--file-filter=JPEG | *.jpg *.jpeg",
        "--file-filter=WebP | *.webp",
        "--file-filter=BMP | *.bmp",
        "--file-filter=TIFF | *.tif *.tiff",
        "--file-filter=PPM | *.ppm",
    ]);
    if !chosen.is_empty() && open_paint_studio::files::save_format(&chosen).is_none() {
        return chosen + ".png";
    }
    chosen
}

/// zenity answers rgb(r,g,b) or rgba(r,g,b,a); the current colour when cancelled.
fn color_chosen(current: Color) -> Color {
    let answer = zenity(&["--color-selection", "--title=Kleur"]);
    let values: Vec<u8> = answer.split(|c: char| !c.is_ascii_digit()).filter(|s| !s.is_empty()).map(|s| s.parse::<u32>().unwrap_or(0).min(255) as u8).collect();
    if values.len() < 3 {
        return current;
    }
    Color::rgb(values[0], values[1], values[2])
}

struct Editor {
    window: Window,
    app: App,
    shell: Shell,
    text_face: Face,
    frame: Canvas,
    mouse: (f64, f64),
    /// The canvas point the status bar shows: where the pointer last moved
    /// over the canvas, rounded, as the browser editor reports it.
    pointer: (i32, i32),
    left: bool,
    middle: bool,
    fitted: bool,
    canvas_changed: bool,
    last_area: (i32, i32),
    last_title_click: Option<Instant>,
    title: String,
    running: bool,
}

impl Editor {
    fn size(&self) -> (i32, i32) {
        (self.frame.width as i32, self.frame.height as i32)
    }

    fn center(&self) -> (f64, f64) {
        let (w, h) = self.size();
        let stage = self.shell.stage(&self.app, w, h);
        (stage.x + self.app.image.width as f64 * stage.scale / 2.0, stage.y + self.app.image.height as f64 * stage.scale / 2.0)
    }

    fn zoom_by(&mut self, step: i64, around: (f64, f64)) {
        let (w, h) = self.size();
        let level = (self.app.zoom * 100.0).round() as i64 + step;
        self.shell.zoom_to(&mut self.app, level, around.0, around.1, w, h);
        self.canvas_changed = true;
    }

    fn canvas_point(&self) -> (f64, f64) {
        let (w, h) = self.size();
        let stage = self.shell.stage(&self.app, w, h);
        ((self.mouse.0 - stage.x) / stage.scale, (self.mouse.1 - stage.y) / stage.scale)
    }

    fn inside_area(&self) -> bool {
        let (w, h) = self.size();
        let s = self.shell.stage(&self.app, w, h);
        let (mx, my) = self.mouse;
        mx >= s.area_x as f64 && mx < (s.area_x + s.area_w) as f64 && my >= (s.area_y + 34) as f64 && my < (s.area_y + s.area_h - 26) as f64
    }

    /// Commands, including those that need the window: files, zoom, fitting.
    fn run(&mut self, command: Command) {
        match command {
            Command::Open => {
                let chosen = path_to_open();
                if !chosen.is_empty() && self.app.open(&chosen) {
                    self.fitted = false;
                }
            }
            Command::Save if !self.app.path.is_empty() && open_paint_studio::files::save_format(&self.app.path).is_some() => {
                let path = self.app.path.clone();
                self.app.save(&path);
            }
            Command::Save | Command::SaveAs => {
                let chosen = path_to_save();
                if !chosen.is_empty() {
                    self.app.save(&chosen);
                }
            }
            Command::ZoomIn => self.zoom_by(10, self.center()),
            Command::ZoomOut => self.zoom_by(-10, self.center()),
            Command::Fit => self.fitted = false,
            Command::ActualSize => {
                let (w, h) = self.size();
                let c = self.center();
                self.shell.zoom_to(&mut self.app, 100, c.0, c.1, w, h);
                self.canvas_changed = true;
            }
            _ => {
                let before = (self.app.image.width, self.app.image.height, self.app.focus);
                self.app.apply(command, &mut self.text_face);
                if before != (self.app.image.width, self.app.image.height, self.app.focus) {
                    self.fitted = false;
                }
            }
        }
    }

    fn click(&mut self, root: (i16, i16)) {
        let (w, h) = self.size();
        let (mx, my) = self.mouse;
        let action = self.shell.action_at(mx as i32, my as i32, &self.app, w, h);
        if action.is_empty() && (0.0..42.0).contains(&my) {
            // The title bar moves the window; a double click maximises it.
            let now = Instant::now();
            if self.last_title_click.is_some_and(|t| now.duration_since(t).as_secs_f64() < 0.4) {
                self.window.toggle_maximized();
                self.last_title_click = None;
            } else {
                self.last_title_click = Some(now);
                self.left = false;
                self.window.begin_move(root);
            }
            return;
        }
        if action.is_empty() {
            if self.shell.opened >= 0 {
                self.shell.opened = -1;
            } else if self.inside_area() {
                self.app.message.clear();
                let (x, y) = self.canvas_point();
                self.app.press(x, y, &mut self.text_face);
            }
            return;
        }
        let mut closing = true;
        if let Some(name) = action.strip_prefix("tab:") {
            self.shell.tab = match name {
                "Afbeelding" => 1,
                "Beeld" => 2,
                "Automatisering" => 3,
                _ => 0,
            };
        } else if let Some(which) = action.strip_prefix("toggle:") {
            closing = false;
            let wanted = which.parse().unwrap_or(-1);
            self.shell.opened = if self.shell.opened == wanted { -1 } else { wanted };
        } else if action == "file" {
            closing = false;
            self.shell.opened = if self.shell.opened == 9 { -1 } else { 9 };
        } else if let Some(key) = action.strip_prefix("tool:") {
            self.app.apply(Command::Tool(Tool::from_key(key)), &mut self.text_face);
        } else if let Some(hex) = action.strip_prefix("color:") {
            self.app.color = Color::hex(hex);
        } else if action == "pick" {
            self.app.color = color_chosen(self.app.color);
        } else if action == "size" {
            // The spin buttons: the upper half steps up, the lower down.
            if let Some(b) = self.shell.hit_box(action, &self.app, w, h) {
                let step = if my < b.y as f64 + b.h as f64 / 2.0 { 1 } else { -1 };
                self.app.size = (self.app.size + step).clamp(1, 200);
            }
        } else if action == "opacity" || action == "zoomslider" {
            self.shell.dragging = action.to_string();
            self.slide();
        } else if action == "cmd:Close window" {
            self.running = false;
        } else if action == "cmd:Minimize" {
            self.window.minimize();
        } else if action == "cmd:Maximize" {
            self.window.toggle_maximized();
        } else if matches!(action, "cmd:Zoom in" | "cmd:+" | "menu:+") {
            self.zoom_by(if action.len() < 8 { 25 } else { 10 }, self.center());
        } else if matches!(action, "cmd:Zoom out" | "cmd:−" | "menu:−") {
            self.zoom_by(if action.len() < 8 { -25 } else { -10 }, self.center());
        } else if let Some(command) = command_of_action(action) {
            self.run(command);
        }
        if closing {
            self.shell.opened = -1;
        }
    }

    /// The sliders follow the mouse along their track.
    fn slide(&mut self) {
        let (w, h) = self.size();
        let dragging = self.shell.dragging.clone();
        let Some(b) = self.shell.hit_box(&dragging, &self.app, w, h) else { return };
        let fraction = ((self.mouse.0 - b.x as f64) / b.w as f64).clamp(0.0, 1.0);
        if dragging == "opacity" {
            self.app.opacity = 1 + (fraction * 99.0).round() as i32;
        } else {
            let c = self.center();
            self.shell.zoom_to(&mut self.app, 10 + (fraction * 390.0).round() as i64, c.0, c.1, w, h);
            self.canvas_changed = true;
        }
    }

    fn key(&mut self, keysym: u32, text: Option<String>, control: bool, shift: bool) {
        if keysym == keys::ESCAPE {
            self.app.cancel();
            self.shell.opened = -1;
            return;
        }
        let letter = text.as_deref().map(|t| t.to_lowercase()).unwrap_or_default();
        if self.app.typing {
            match keysym {
                keys::BACKSPACE => self.app.erase_letter(&mut self.text_face),
                keys::RETURN | keys::KP_ENTER => self.app.commit_text(&mut self.text_face),
                _ if control && letter == "z" => self.run(Command::Undo),
                _ if !control => {
                    if let Some(text) = text {
                        self.app.type_text(&text, &mut self.text_face);
                    }
                }
                _ => {}
            }
            return;
        }
        let command = match (letter.as_str(), control) {
            _ if keysym == keys::DELETE => Some(Command::Clear),
            _ if keysym == keys::KP_ADD => Some(Command::ZoomIn),
            _ if keysym == keys::KP_SUBTRACT => Some(Command::ZoomOut),
            ("z", true) => Some(if shift { Command::Redo } else { Command::Undo }),
            ("y", true) => Some(Command::Redo),
            ("s", true) => Some(if shift { Command::SaveAs } else { Command::Save }),
            ("o", true) => Some(Command::Open),
            ("n", true) => Some(Command::New),
            (_, true) => None,
            ("b", _) => Some(Command::Tool(Tool::Brush)),
            ("e", _) => Some(Command::Tool(Tool::Eraser)),
            ("f", _) => Some(Command::Tool(Tool::Fill)),
            ("i", _) => Some(Command::Tool(Tool::Picker)),
            ("l", _) => Some(Command::Tool(Tool::Line)),
            ("r", _) => Some(Command::Tool(Tool::Rectangle)),
            ("o", _) => Some(Command::Tool(Tool::Ellipse)),
            ("t", _) => Some(Command::Tool(Tool::Text)),
            ("c", _) => Some(Command::Tool(Tool::Crop)),
            ("g", _) => Some(Command::Grid),
            ("0", _) => Some(Command::Fit),
            ("=", _) | ("+", _) => Some(Command::ZoomIn),
            ("-", _) => Some(Command::ZoomOut),
            _ => None,
        };
        if let Some(command) = command {
            self.run(command);
        }
    }

    fn handle(&mut self, event: Event) {
        match event {
            Event::Close => self.running = false,
            Event::Expose => {}
            Event::Resize(w, h) => {
                self.frame = Canvas::new(w.max(1) as usize, h.max(1) as usize, Color::WHITE);
                self.canvas_changed = true;
            }
            Event::Motion(x, y) => {
                let previous = self.mouse;
                self.mouse = (x, y);
                let (cx, cy) = self.canvas_point();
                let over = cx >= 0.0 && cy >= 0.0 && cx < self.app.image.width as f64 && cy < self.app.image.height as f64 && self.inside_area();
                if over || (self.left && self.app.dragging) {
                    self.pointer = ((cx + 0.5).floor() as i32, (cy + 0.5).floor() as i32);
                }
                if self.left && self.app.dragging {
                    let (cx, cy) = self.canvas_point();
                    self.app.drag(cx, cy);
                }
                if self.left && !self.shell.dragging.is_empty() {
                    self.slide();
                }
                if self.middle {
                    self.app.pan_x += x - previous.0;
                    self.app.pan_y += y - previous.1;
                    self.canvas_changed = true;
                }
            }
            Event::Button { button, down, x, y, root } => {
                self.mouse = (x, y);
                match (button, down) {
                    (1, true) => {
                        self.left = true;
                        self.click(root);
                    }
                    (1, false) => {
                        self.left = false;
                        self.app.release();
                        self.shell.dragging.clear();
                    }
                    (2, _) => self.middle = down,
                    (4, true) => self.zoom_by(10, self.mouse),
                    (5, true) => self.zoom_by(-10, self.mouse),
                    _ => {}
                }
            }
            Event::Key { keysym, text, control, shift } => self.key(keysym, text, control, shift),
        }
    }

    fn present(&mut self) {
        let (w, h) = self.size();
        if !self.fitted {
            self.shell.fit(&mut self.app, w, h);
            self.fitted = true;
            self.canvas_changed = true;
        }
        // The browser editor refits whenever its workspace changes size.
        let area = self.shell.workspace(&self.app, w, h);
        if (area.w, area.h) != self.last_area {
            self.last_area = (area.w, area.h);
            self.shell.fit(&mut self.app, w, h);
            self.canvas_changed = true;
        }
        if self.app.redrawn {
            self.canvas_changed = true;
            self.app.redrawn = false;
        }
        self.shell.draw(&self.app, &mut self.frame, self.pointer, self.canvas_changed);
        self.canvas_changed = false;
        self.window.present(&self.frame);
        let mut title = String::from("Open Paint Studio");
        if !self.app.path.is_empty() {
            title = format!("{} — {title}", self.app.path);
        }
        if self.app.changed {
            title = format!("• {title}");
        }
        if title != self.title {
            self.window.set_title(&title);
            self.title = title;
        }
    }
}

fn main() {
    let mut app = App::new(1200, 800);
    if let Some(path) = std::env::args().nth(1) {
        app.open(&path);
        app.history = Default::default();
        app.steps.clear();
    }
    let shell = Shell::new();
    let library = freetype::Library::init().expect("FreeType");
    // The text tool's font: the system's DejaVu Sans, else Liberation Sans.
    let text_face = ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", "/usr/share/fonts/TTF/DejaVuSans.ttf", "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"]
        .iter()
        .find_map(|path| Face::from_file(&library, path))
        .expect("No usable font found (install DejaVu Sans).");
    let side = |at: usize| u32::from_le_bytes(ICON[at..at + 4].try_into().unwrap());
    let icon = Some((side(0), side(4), ICON[8..].to_vec()));
    let window = Window::open(1440, 940, "Open Paint Studio", icon).unwrap_or_else(|message| {
        eprintln!("{message}");
        std::process::exit(1)
    });
    let mut editor = Editor {
        window,
        app,
        shell,
        text_face,
        frame: Canvas::new(1440, 940, Color::WHITE),
        mouse: (0.0, 0.0),
        pointer: (0, 0),
        left: false,
        middle: false,
        fitted: false,
        canvas_changed: true,
        last_area: (0, 0),
        last_title_click: None,
        title: String::new(),
        running: true,
    };
    // Draw, then sleep until the next input; every batch of events draws once.
    editor.present();
    while editor.running {
        for event in editor.window.events() {
            editor.handle(event);
        }
        if editor.running {
            editor.present();
        }
    }
}
