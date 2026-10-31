//! Open Paint Studio, the native Rust edition of OpenAEC Paint Studio: the
//! browser editor's interface measured in WebKitGTK and redrawn on the
//! processor, with its own raster engine. The executable is src/main.rs.
pub mod app;
pub mod canvas;
pub mod files;
pub mod history;
pub mod shell;
pub mod skin;
pub mod skin_data;
pub mod typeset;
pub mod vector;
pub mod window;
