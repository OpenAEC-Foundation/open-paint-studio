//! Undo and redo over the 40 most recent states, as the browser editor keeps
//! them. A whole snapshot is taken before every change; once the change is
//! done it shrinks to the rectangle the change touched, so a brush stroke
//! costs its own size instead of the whole canvas.
use crate::canvas::{cropped, paste, Canvas};

pub const LIMIT: usize = 40;

struct Snapshot {
    image: Canvas,
    x: usize,
    y: usize,
    whole: bool,
}

#[derive(Default)]
pub struct History {
    undo: Vec<Snapshot>,
    redo: Vec<Snapshot>,
}

impl History {
    /// Records image as the state to return to; a new change discards redo.
    pub fn remember(&mut self, image: &Canvas) {
        self.undo.push(Snapshot { image: image.clone(), x: 0, y: 0, whole: true });
        if self.undo.len() > LIMIT {
            self.undo.remove(0);
        }
        self.redo.clear();
    }

    /// Shrinks the latest whole snapshot to the rectangle in which it
    /// differs from image, when both have the same size.
    pub fn settle(&mut self, image: &Canvas) {
        let Some(entry) = self.undo.last_mut() else { return };
        let before = &entry.image;
        if !entry.whole || before.width != image.width || before.height != image.height {
            return;
        }
        let stride = image.width * 4;
        let differs = |row: usize| before.pixels[row * stride..(row + 1) * stride] != image.pixels[row * stride..(row + 1) * stride];
        let mut top = 0;
        while top < image.height && !differs(top) {
            top += 1;
        }
        let (mut left, mut right, mut bottom) = (0, 0, top);
        if top < image.height {
            bottom = image.height - 1;
            while !differs(bottom) {
                bottom -= 1;
            }
            let word = |p: &[u8], i: usize| u32::from_ne_bytes([p[i * 4], p[i * 4 + 1], p[i * 4 + 2], p[i * 4 + 3]]);
            let width = image.width;
            left = width;
            right = 0;
            for row in top..=bottom {
                let start = row * width;
                let mut c = 0;
                while c < left && word(&before.pixels, start + c) == word(&image.pixels, start + c) {
                    c += 1;
                }
                left = left.min(c);
                let mut c = width - 1;
                while c > right && word(&before.pixels, start + c) == word(&image.pixels, start + c) {
                    c -= 1;
                }
                right = right.max(c);
            }
            right = right.max(left);
        }
        let patch = cropped(before, left as i64, top as i64, right as i64 + 1, bottom as i64 + 1);
        *entry = Snapshot { image: patch, x: left, y: top, whole: false };
    }

    pub fn can_undo(&self) -> bool {
        !self.undo.is_empty()
    }

    pub fn can_redo(&self) -> bool {
        !self.redo.is_empty()
    }

    fn restore(current: Canvas, from: &mut Vec<Snapshot>, onto: &mut Vec<Snapshot>) -> Canvas {
        let Some(entry) = from.pop() else { return current };
        if entry.whole {
            onto.push(Snapshot { image: current, x: 0, y: 0, whole: true });
            return entry.image;
        }
        let mut current = current;
        let patch = entry.image;
        let back = cropped(&current, entry.x as i64, entry.y as i64, (entry.x + patch.width) as i64, (entry.y + patch.height) as i64);
        onto.push(Snapshot { image: back, x: entry.x, y: entry.y, whole: false });
        paste(&patch, &mut current, entry.x, entry.y);
        current
    }

    /// Each returns the canvas to show; the current state moves to the other stack.
    pub fn undo(&mut self, current: Canvas) -> Canvas {
        Self::restore(current, &mut self.undo, &mut self.redo)
    }

    pub fn redo(&mut self, current: Canvas) -> Canvas {
        Self::restore(current, &mut self.redo, &mut self.undo)
    }

    /// Drops the latest undo state, for a change that came to nothing.
    pub fn forget(&mut self) {
        self.undo.pop();
    }
}
