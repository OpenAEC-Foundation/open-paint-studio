// HarfBuzz comes from the system (part of every GNOME desktop); only its
// runtime library is needed, so it is linked by its soname.
fn main() {
    println!("cargo:rustc-link-lib=dylib:+verbatim=libharfbuzz.so.0");
}
