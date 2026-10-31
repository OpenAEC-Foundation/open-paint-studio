//! The editor's state and every command the ribbon, the keyboard and the
//! mouse can give. Nothing here draws; shell.rs draws this state.
use crate::canvas::{self, Adjustment, Canvas, Color, Stroke};
use crate::history::{History, LIMIT};
use crate::typeset::{render_text, Face};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Tool {
    Brush,
    Eraser,
    Fill,
    Picker,
    Line,
    Rectangle,
    Ellipse,
    Text,
    Crop,
    Select,
}

impl Tool {
    /// The key the skin's conditions use.
    pub fn key(self) -> &'static str {
        match self {
            Tool::Brush => "brush",
            Tool::Eraser => "eraser",
            Tool::Fill => "fill",
            Tool::Picker => "picker",
            Tool::Line => "line",
            Tool::Rectangle => "rectangle",
            Tool::Ellipse => "ellipse",
            Tool::Text => "text",
            Tool::Crop => "crop",
            Tool::Select => "select",
        }
    }

    pub fn from_key(key: &str) -> Tool {
        match key {
            "eraser" => Tool::Eraser,
            "fill" => Tool::Fill,
            "picker" => Tool::Picker,
            "line" => Tool::Line,
            "rectangle" => Tool::Rectangle,
            "ellipse" => Tool::Ellipse,
            "text" => Tool::Text,
            "crop" => Tool::Crop,
            "select" => Tool::Select,
            _ => Tool::Brush,
        }
    }

    /// The name the interface shows.
    pub fn name(self) -> &'static str {
        match self {
            Tool::Brush => "Penseel",
            Tool::Eraser => "Gum",
            Tool::Fill => "Vullen",
            Tool::Picker => "Pipet",
            Tool::Line => "Lijn",
            Tool::Rectangle => "Rechthoek",
            Tool::Ellipse => "Ellips",
            Tool::Text => "Tekst",
            Tool::Crop => "Bijsnijden",
            Tool::Select => "Selecteren",
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Command {
    Tool(Tool),
    New,
    Open,
    Save,
    SaveAs,
    Undo,
    Redo,
    RotateLeft,
    RotateRight,
    FlipHorizontal,
    FlipVertical,
    DoubleSize,
    Grayscale,
    Invert,
    Sepia,
    MoreContrast,
    ZoomIn,
    ZoomOut,
    Fit,
    ActualSize,
    Grid,
    Clear,
    Focus,
}

pub struct App {
    pub image: Canvas,
    pub base: Canvas,
    pub history: History,
    pub tool: Tool,
    pub color: Color,
    pub size: i32,
    pub text_size: i32,
    pub opacity: i32,
    pub filled: bool,
    pub zoom: f64,
    pub pan_x: f64,
    pub pan_y: f64,
    pub grid: bool,
    pub focus: bool,
    pub path: String,
    pub message: String,
    pub changed: bool,
    pub dragging: bool,
    start: (f64, f64),
    last: (f64, f64),
    pub typing: bool,
    typed: String,
    text_at: (i64, i64),
    pub steps: Vec<String>,
    undone: Vec<String>,
    /// Set when the canvas needs drawing again.
    pub redrawn: bool,
}

impl App {
    pub fn new(width: usize, height: usize) -> App {
        let image = Canvas::new(width, height, Color::WHITE);
        App {
            base: image.clone(),
            image,
            history: History::default(),
            tool: Tool::Brush,
            color: Color::hex("36363e"),
            size: 8,
            text_size: 32,
            opacity: 100,
            filled: false,
            zoom: 1.0,
            pan_x: 0.0,
            pan_y: 0.0,
            grid: false,
            focus: false,
            path: String::new(),
            message: String::new(),
            changed: false,
            dragging: false,
            start: (0.0, 0.0),
            last: (0.0, 0.0),
            typing: false,
            typed: String::new(),
            text_at: (0, 0),
            steps: Vec::new(),
            undone: Vec::new(),
            redrawn: true,
        }
    }

    fn note(&mut self, step: &str) {
        self.undone.clear();
        self.steps.push(step.to_string());
        if self.steps.len() > LIMIT {
            self.steps.remove(0);
        }
    }

    /// Every change goes through here: the current image becomes an undo state.
    fn begin(&mut self) {
        self.history.remember(&self.image);
        self.base.copy_from(&self.image);
    }

    fn refresh_base(&mut self) {
        if self.base.width == self.image.width && self.base.height == self.image.height {
            self.base.copy_from(&self.image);
        } else {
            self.base = self.image.clone();
        }
    }

    fn finish(&mut self, step: &str) {
        self.history.settle(&self.image);
        self.note(step);
        self.changed = true;
        self.redrawn = true;
    }

    pub fn replace_image(&mut self, image: Canvas, step: &str) {
        self.history.remember(&self.image);
        self.base = image.clone();
        self.image = image;
        self.finish(step);
    }

    fn stroke(&self) -> Stroke {
        Stroke::new(self.color, self.opacity * 255 / 100, self.size, self.tool == Tool::Eraser)
    }

    // --- Mouse on the canvas: x and y are canvas coordinates. ---

    pub fn press(&mut self, x: f64, y: f64, face: &mut Face) {
        let (column, row) = (x.floor() as i64, y.floor() as i64);
        if self.typing {
            self.commit_text(face);
        }
        match self.tool {
            Tool::Picker => {
                if self.image.contains(column, row) {
                    let p = self.image.get(column, row);
                    self.color = Color::rgb(p.r, p.g, p.b);
                }
                return;
            }
            Tool::Select => return,
            Tool::Fill => {
                self.begin();
                canvas::flood_fill(&mut self.image, column, row, self.color, self.opacity * 255 / 100, 32);
                self.finish("Vullen");
                return;
            }
            Tool::Text => {
                self.begin();
                self.typing = true;
                self.typed.clear();
                self.text_at = (column, row + self.text_size as i64);
                return;
            }
            Tool::Crop => {}
            _ => self.begin(),
        }
        self.dragging = true;
        self.start = (x, y);
        self.last = (x, y);
        if matches!(self.tool, Tool::Brush | Tool::Eraser) {
            self.stroke().dab(x, y, &mut self.image, &self.base);
            self.redrawn = true;
        }
    }

    pub fn drag(&mut self, x: f64, y: f64) {
        if !self.dragging {
            return;
        }
        let stroke = self.stroke();
        let (sx, sy) = self.start;
        let corners = (sx.floor() as i64, sy.floor() as i64, x.floor() as i64, y.floor() as i64);
        match self.tool {
            Tool::Brush | Tool::Eraser => stroke.line(self.last.0, self.last.1, x, y, &mut self.image, &self.base),
            Tool::Line => {
                self.image.copy_from(&self.base);
                stroke.line(sx, sy, x, y, &mut self.image, &self.base);
            }
            Tool::Rectangle => {
                self.image.copy_from(&self.base);
                stroke.rectangle(corners.0, corners.1, corners.2, corners.3, self.filled, &mut self.image, &self.base);
            }
            Tool::Ellipse => {
                self.image.copy_from(&self.base);
                stroke.ellipse(corners.0, corners.1, corners.2, corners.3, self.filled, &mut self.image, &self.base);
            }
            _ => {}
        }
        self.last = (x, y);
        self.redrawn = true;
    }

    pub fn release(&mut self) {
        if !self.dragging {
            return;
        }
        self.dragging = false;
        if self.tool == Tool::Crop {
            let (s, l) = (self.start, self.last);
            let (left, top) = (s.0.min(l.0).floor() as i64, s.1.min(l.1).floor() as i64);
            let (right, bottom) = (s.0.max(l.0).ceil() as i64, s.1.max(l.1).ceil() as i64);
            if right - left >= 2 && bottom - top >= 2 {
                let image = canvas::cropped(&self.image, left, top, right, bottom);
                self.replace_image(image, "Bijsnijden");
                self.tool = Tool::Brush;
            }
            return;
        }
        self.finish(self.tool.name());
    }

    /// Escape: whatever is under way stops and leaves nothing behind, and the
    /// select tool takes over.
    pub fn cancel(&mut self) {
        self.cancel_text();
        if self.dragging {
            self.dragging = false;
            if self.tool != Tool::Crop {
                self.image.copy_from(&self.base);
                self.history.forget();
            }
            self.redrawn = true;
        }
        self.tool = Tool::Select;
    }

    // --- The text tool ---

    fn redraw_text(&mut self, face: &mut Face) {
        self.image.copy_from(&self.base);
        let (x, y) = self.text_at;
        render_text(face, &self.typed, &mut self.image, &self.base, x, y, self.text_size, self.color, self.opacity * 255 / 100);
        self.redrawn = true;
    }

    pub fn type_text(&mut self, text: &str, face: &mut Face) {
        self.typed.push_str(text);
        self.redraw_text(face);
    }

    pub fn erase_letter(&mut self, face: &mut Face) {
        if self.typed.pop().is_some() {
            self.redraw_text(face);
        }
    }

    pub fn commit_text(&mut self, face: &mut Face) {
        if !self.typing {
            return;
        }
        self.typing = false;
        if self.typed.is_empty() {
            self.image.copy_from(&self.base);
            self.history.forget();
            self.redrawn = true;
            return;
        }
        self.redraw_text(face);
        self.finish("Tekst");
    }

    pub fn cancel_text(&mut self) {
        if self.typing {
            self.typing = false;
            self.image.copy_from(&self.base);
            self.history.forget();
            self.redrawn = true;
        }
    }

    // --- Files ---

    pub fn open(&mut self, path: &str) -> bool {
        match crate::files::open(path) {
            Ok(image) => {
                self.replace_image(image, "Openen");
                self.path = path.to_string();
                self.changed = false;
                self.message = format!("Geopend: {path}");
                true
            }
            Err(message) => {
                self.message = format!("Openen mislukt: {message}");
                false
            }
        }
    }

    pub fn save(&mut self, path: &str) -> bool {
        match crate::files::save(&self.image, path) {
            Ok(()) => {
                self.path = path.to_string();
                self.changed = false;
                self.message = format!("Opgeslagen: {path}");
                true
            }
            Err(message) => {
                self.message = format!("Opslaan mislukt: {message}");
                false
            }
        }
    }

    fn adjust(&mut self, kind: Adjustment, brightness: i32, contrast: i32, saturation: i32, step: &str) {
        self.begin();
        canvas::adjust(&mut self.image, kind, brightness, contrast, saturation);
        self.finish(step);
    }

    /// The commands that need no window.
    pub fn apply(&mut self, command: Command, face: &mut Face) {
        if command != Command::Undo {
            self.commit_text(face);
        }
        match command {
            Command::Tool(tool) => self.tool = tool,
            Command::New => {
                let image = Canvas::new(self.image.width, self.image.height, Color::WHITE);
                self.replace_image(image, "Nieuw canvas");
                self.path.clear();
                self.changed = false;
            }
            Command::Clear => {
                self.begin();
                self.image.fill(Color::WHITE);
                self.finish("Canvas wissen");
            }
            Command::Undo => {
                if self.typing {
                    self.cancel_text();
                } else if self.history.can_undo() {
                    if let Some(step) = self.steps.pop() {
                        self.undone.push(step);
                    }
                    let current = std::mem::replace(&mut self.image, Canvas::from_pixels(0, 0, Vec::new()));
                    self.image = self.history.undo(current);
                    self.refresh_base();
                    self.redrawn = true;
                }
            }
            Command::Redo => {
                if self.history.can_redo() {
                    if let Some(step) = self.undone.pop() {
                        self.steps.push(step);
                    }
                    let current = std::mem::replace(&mut self.image, Canvas::from_pixels(0, 0, Vec::new()));
                    self.image = self.history.redo(current);
                    self.refresh_base();
                    self.redrawn = true;
                }
            }
            Command::RotateLeft => self.replace_image(canvas::turned(&self.image, false), "Links draaien"),
            Command::RotateRight => self.replace_image(canvas::turned(&self.image, true), "90° draaien"),
            Command::FlipHorizontal => self.replace_image(canvas::flipped(&self.image, true), "Horizontaal spiegelen"),
            Command::FlipVertical => self.replace_image(canvas::flipped(&self.image, false), "Verticaal spiegelen"),
            Command::DoubleSize => {
                let (w, h) = ((self.image.width * 2).min(4096), (self.image.height * 2).min(4096));
                self.replace_image(canvas::resized(&self.image, w, h), "Formaat wijzigen");
            }
            Command::Grayscale => self.adjust(Adjustment::Grayscale, 0, 0, 100, "Grijswaarden"),
            Command::Invert => self.adjust(Adjustment::Invert, 0, 0, 100, "Kleuren omkeren"),
            Command::Sepia => self.adjust(Adjustment::Sepia, 0, 0, 100, "Sepia"),
            Command::MoreContrast => self.adjust(Adjustment::Adjust, 0, 10, 100, "Contrast"),
            Command::Grid => self.grid = !self.grid,
            Command::Focus => self.focus = !self.focus,
            // Files, zoom and fitting need the window: main.rs.
            Command::Open | Command::Save | Command::SaveAs | Command::ZoomIn | Command::ZoomOut | Command::Fit | Command::ActualSize => {}
        }
    }
}

/// The browser editor's commands by the name its buttons and menus carry.
pub fn command_of_action(action: &str) -> Option<Command> {
    let name = action.strip_prefix("menu:").or_else(|| action.strip_prefix("cmd:")).unwrap_or(action);
    Some(match name {
        "Save" | "IFCX opslaan" => Command::Save,
        "PNG" | "JPEG" | "WebP" | "PNG exporteren" => Command::SaveAs,
        "Undo" => Command::Undo,
        "Redo" => Command::Redo,
        "Openen" | "IFCX openen" => Command::Open,
        "Nieuw canvas" => Command::New,
        "90° draaien" => Command::RotateRight,
        "Links draaien" => Command::RotateLeft,
        "Horizontaal spiegelen" => Command::FlipHorizontal,
        "Verticaal spiegelen" => Command::FlipVertical,
        "Grijswaarden" => Command::Grayscale,
        "Kleuren omkeren" => Command::Invert,
        "Sepia" => Command::Sepia,
        "Canvas wissen" => Command::Clear,
        "Raster" => Command::Grid,
        "Ware grootte" | "actual" => Command::ActualSize,
        "Passend maken" => Command::Fit,
        "Focusmodus" => Command::Focus,
        "Bijsnijden" => Command::Tool(Tool::Crop),
        "Formaat wijzigen" => Command::DoubleSize,
        "Kleurcorrecties" => Command::MoreContrast,
        _ => return None,
    })
}

/// The browser editor's 30-colour palette, in its order.
pub const PALETTE: [&str; 30] = [
    "36363e", "ffffff", "a1a1aa", "d97706", "f59e0b", "ea580c", "dc2626", "e11d48", "9333ea", "4f46e5", "2563eb", "0891b2", "0d9488", "16a34a", "65a30d",
    "854d0e", "78716c", "e7e5e4", "fcd34d", "fed7aa", "fecaca", "fbcfe8", "e9d5ff", "c7d2fe", "bfdbfe", "a5f3fc", "99f6e4", "bbf7d0", "d9f99d", "d6d3d1",
];
