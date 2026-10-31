//! The window, through the X11 protocol itself (x11rb's pure-Rust
//! connection, no C libraries): XWayland on a Wayland desktop. The frame
//! goes to the window as an image; only rows that changed since the last
//! frame are sent. The window has no decorations: the shell draws the
//! browser editor's own title bar, and asks the window manager to move,
//! maximise or minimise the window.
use crate::canvas::Canvas;
use x11rb::connection::{Connection, RequestConnection};
use x11rb::protocol::xproto::{
    self, AtomEnum, ClientMessageEvent, ConfigureWindowAux, ConnectionExt, CreateGCAux, CreateWindowAux, EventMask, ImageFormat, PropMode, WindowClass,
};
use x11rb::protocol::Event as XEvent;
use x11rb::rust_connection::RustConnection;
use x11rb::wrapper::ConnectionExt as _;

pub enum Event {
    Close,
    Resize(u32, u32),
    Expose,
    Motion(f64, f64),
    /// Button 1 left, 2 middle, 3 right, 4 and 5 the wheel.
    Button { button: u8, down: bool, x: f64, y: f64, root: (i16, i16) },
    Key { keysym: u32, text: Option<String>, control: bool, shift: bool },
}

x11rb::atom_manager! {
    Atoms: AtomsCookie {
        WM_PROTOCOLS,
        WM_DELETE_WINDOW,
        WM_CHANGE_STATE,
        _NET_WM_NAME,
        _NET_WM_ICON,
        _NET_WM_PID,
        _NET_WM_STATE,
        _NET_WM_STATE_MAXIMIZED_VERT,
        _NET_WM_STATE_MAXIMIZED_HORZ,
        _NET_WM_MOVERESIZE,
        _MOTIF_WM_HINTS,
        UTF8_STRING,
    }
}

pub struct Window {
    conn: RustConnection,
    window: u32,
    root: u32,
    gc: u32,
    depth: u8,
    atoms: Atoms,
    pub width: u32,
    pub height: u32,
    min_keycode: u8,
    per_keycode: usize,
    keysyms: Vec<u32>,
    /// What the window shows now, BGRX, to send only the rows that change.
    shown: Vec<u8>,
    max_request: usize,
}

pub mod keys {
    pub const BACKSPACE: u32 = 0xff08;
    pub const RETURN: u32 = 0xff0d;
    pub const ESCAPE: u32 = 0xff1b;
    pub const DELETE: u32 = 0xffff;
    pub const KP_ENTER: u32 = 0xff8d;
    pub const KP_ADD: u32 = 0xffab;
    pub const KP_SUBTRACT: u32 = 0xffad;
}

/// The character a keysym types: Latin-1 directly, Unicode keysyms by offset.
fn keysym_text(keysym: u32) -> Option<String> {
    let c = match keysym {
        0x20..=0x7e | 0xa0..=0xff => char::from_u32(keysym),
        0x0100_0000..=0x0110_ffff => char::from_u32(keysym - 0x0100_0000),
        0xffaa..=0xffb9 => char::from_u32(keysym - 0xff80),
        _ => None,
    }?;
    Some(c.to_string())
}

impl Window {
    pub fn open(width: u32, height: u32, title: &str, icon: Option<(u32, u32, Vec<u8>)>) -> Result<Window, String> {
        let (conn, screen) = RustConnection::connect(None).map_err(|e| format!("No X display: {e}"))?;
        let screen = conn.setup().roots[screen].clone();
        let atoms = Atoms::new(&conn).map_err(|e| e.to_string())?.reply().map_err(|e| e.to_string())?;
        let window = conn.generate_id().map_err(|e| e.to_string())?;
        let events = EventMask::EXPOSURE
            | EventMask::STRUCTURE_NOTIFY
            | EventMask::KEY_PRESS
            | EventMask::BUTTON_PRESS
            | EventMask::BUTTON_RELEASE
            | EventMask::POINTER_MOTION;
        conn.create_window(
            screen.root_depth,
            window,
            screen.root,
            0,
            0,
            width as u16,
            height as u16,
            0,
            WindowClass::INPUT_OUTPUT,
            screen.root_visual,
            &CreateWindowAux::new().background_pixel(0xfafaf9).event_mask(events).bit_gravity(xproto::Gravity::NORTH_WEST),
        )
        .map_err(|e| e.to_string())?;
        let set = |property: u32, kind: u32, data: &[u8]| conn.change_property8(PropMode::REPLACE, window, property, kind, data).map(|_| ());
        set(AtomEnum::WM_NAME.into(), AtomEnum::STRING.into(), title.as_bytes()).map_err(|e| e.to_string())?;
        set(atoms._NET_WM_NAME, atoms.UTF8_STRING, title.as_bytes()).map_err(|e| e.to_string())?;
        // WM_CLASS: instance and class, matching the menu entry's StartupWMClass.
        set(AtomEnum::WM_CLASS.into(), AtomEnum::STRING.into(), b"open-paint-studio\0open-paint-studio\0").map_err(|e| e.to_string())?;
        conn.change_property32(PropMode::REPLACE, window, atoms.WM_PROTOCOLS, AtomEnum::ATOM, &[atoms.WM_DELETE_WINDOW]).map_err(|e| e.to_string())?;
        conn.change_property32(PropMode::REPLACE, window, atoms._NET_WM_PID, AtomEnum::CARDINAL, &[std::process::id()]).map_err(|e| e.to_string())?;
        // No decorations (the Motif hints every window manager reads).
        conn.change_property32(PropMode::REPLACE, window, atoms._MOTIF_WM_HINTS, atoms._MOTIF_WM_HINTS, &[2, 0, 0, 0, 0]).map_err(|e| e.to_string())?;
        if let Some((w, h, rgba)) = icon {
            let mut data = vec![w, h];
            data.extend(rgba.chunks_exact(4).map(|p| (p[3] as u32) << 24 | (p[0] as u32) << 16 | (p[1] as u32) << 8 | p[2] as u32));
            conn.change_property32(PropMode::REPLACE, window, atoms._NET_WM_ICON, AtomEnum::CARDINAL, &data).map_err(|e| e.to_string())?;
        }
        let gc = conn.generate_id().map_err(|e| e.to_string())?;
        conn.create_gc(gc, window, &CreateGCAux::new().graphics_exposures(0)).map_err(|e| e.to_string())?;
        conn.map_window(window).map_err(|e| e.to_string())?;
        conn.configure_window(window, &ConfigureWindowAux::new().x(0).y(0)).map_err(|e| e.to_string())?;
        let setup = conn.setup();
        let (min_keycode, max_keycode) = (setup.min_keycode, setup.max_keycode);
        let mapping = conn.get_keyboard_mapping(min_keycode, max_keycode - min_keycode + 1).map_err(|e| e.to_string())?.reply().map_err(|e| e.to_string())?;
        conn.flush().map_err(|e| e.to_string())?;
        let max_request = conn.maximum_request_bytes().min(4 << 20);
        Ok(Window {
            root: screen.root,
            depth: screen.root_depth,
            conn,
            window,
            gc,
            atoms,
            width,
            height,
            min_keycode,
            per_keycode: mapping.keysyms_per_keycode as usize,
            keysyms: mapping.keysyms,
            shown: Vec::new(),
            max_request,
        })
    }

    fn keysym(&self, keycode: u8, shift: bool) -> u32 {
        let start = (keycode.saturating_sub(self.min_keycode)) as usize * self.per_keycode;
        let syms = self.keysyms.get(start..start + self.per_keycode).unwrap_or(&[]);
        let plain = syms.first().copied().unwrap_or(0);
        let shifted = syms.get(1).copied().filter(|&s| s != 0);
        match (shift, shifted) {
            (true, Some(s)) => s,
            // A letter with only its lower case listed.
            (true, None) if (0x61..=0x7a).contains(&plain) => plain - 0x20,
            _ => plain,
        }
    }

    fn translate(&mut self, event: XEvent) -> Option<Event> {
        Some(match event {
            XEvent::Expose(e) if e.count == 0 => {
                self.shown.clear();
                Event::Expose
            }
            XEvent::ConfigureNotify(e) if (e.width as u32, e.height as u32) != (self.width, self.height) => {
                self.width = e.width as u32;
                self.height = e.height as u32;
                self.shown.clear();
                Event::Resize(self.width, self.height)
            }
            XEvent::MotionNotify(e) => Event::Motion(e.event_x as f64, e.event_y as f64),
            XEvent::ButtonPress(e) => Event::Button { button: e.detail, down: true, x: e.event_x as f64, y: e.event_y as f64, root: (e.root_x, e.root_y) },
            XEvent::ButtonRelease(e) => Event::Button { button: e.detail, down: false, x: e.event_x as f64, y: e.event_y as f64, root: (e.root_x, e.root_y) },
            XEvent::KeyPress(e) => {
                let state = u16::from(e.state);
                let (shift, control) = (state & 1 != 0, state & 4 != 0);
                let keysym = self.keysym(e.detail, shift);
                Event::Key { keysym, text: keysym_text(keysym), control, shift }
            }
            XEvent::ClientMessage(e) if e.data.as_data32()[0] == self.atoms.WM_DELETE_WINDOW => Event::Close,
            _ => return None,
        })
    }

    /// Waits for the next events and returns them all; motion is coalesced.
    pub fn events(&mut self) -> Vec<Event> {
        let mut out = Vec::new();
        let Ok(first) = self.conn.wait_for_event() else { return vec![Event::Close] };
        let mut pending = Some(first);
        while let Some(event) = pending.take() {
            if let Some(e) = self.translate(event) {
                if let (Event::Motion(..), Some(Event::Motion(..))) = (&e, out.last()) {
                    out.pop();
                }
                out.push(e);
            }
            pending = self.conn.poll_for_event().ok().flatten();
        }
        out
    }

    /// Sends the frame (RGBA, the window's size); only the changed rows.
    pub fn present(&mut self, frame: &Canvas) {
        let (w, h) = (frame.width, frame.height);
        let mut data = vec![0u8; w * h * 4];
        for (out, p) in data.chunks_exact_mut(4).zip(frame.pixels.chunks_exact(4)) {
            out.copy_from_slice(&[p[2], p[1], p[0], 255]);
        }
        let stride = w * 4;
        let whole = self.shown.len() != data.len();
        let rows_per_request = ((self.max_request - 64) / stride).max(1);
        let mut row = 0;
        while row < h {
            if !whole && data[row * stride..(row + 1) * stride] == self.shown[row * stride..(row + 1) * stride] {
                row += 1;
                continue;
            }
            let mut end = row + 1;
            while end < h && end - row < rows_per_request && (whole || data[end * stride..(end + 1) * stride] != self.shown[end * stride..(end + 1) * stride]) {
                end += 1;
            }
            let _ = self.conn.put_image(ImageFormat::Z_PIXMAP, self.window, self.gc, w as u16, (end - row) as u16, 0, row as i16, 0, self.depth, &data[row * stride..end * stride]);
            row = end;
        }
        self.shown = data;
        let _ = self.conn.flush();
    }

    pub fn set_title(&self, title: &str) {
        let _ = self.conn.change_property8(PropMode::REPLACE, self.window, self.atoms._NET_WM_NAME, self.atoms.UTF8_STRING, title.as_bytes());
        let _ = self.conn.change_property8(PropMode::REPLACE, self.window, AtomEnum::WM_NAME, AtomEnum::STRING, title.as_bytes());
        let _ = self.conn.flush();
    }

    fn tell_window_manager(&self, kind: u32, data: [u32; 5]) {
        let message = ClientMessageEvent::new(32, self.window, kind, data);
        let mask = EventMask::SUBSTRUCTURE_REDIRECT | EventMask::SUBSTRUCTURE_NOTIFY;
        let _ = self.conn.send_event(false, self.root, mask, message);
        let _ = self.conn.flush();
    }

    /// Hands the pointer to the window manager to move the window.
    pub fn begin_move(&self, root: (i16, i16)) {
        let _ = self.conn.ungrab_pointer(x11rb::CURRENT_TIME);
        self.tell_window_manager(self.atoms._NET_WM_MOVERESIZE, [root.0 as u32, root.1 as u32, 8, 1, 1]);
    }

    pub fn toggle_maximized(&self) {
        let (a, b) = (self.atoms._NET_WM_STATE_MAXIMIZED_VERT, self.atoms._NET_WM_STATE_MAXIMIZED_HORZ);
        self.tell_window_manager(self.atoms._NET_WM_STATE, [2, a, b, 1, 0]);
    }

    pub fn minimize(&self) {
        // IconicState
        self.tell_window_manager(self.atoms.WM_CHANGE_STATE, [3, 0, 0, 0, 0]);
    }
}
