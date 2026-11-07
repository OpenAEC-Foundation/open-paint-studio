#!/usr/bin/env python3
"""Measures the browser editor in WebKitGTK, the engine of the desktop build.

Loads the built web editor (dist/, served at URL) in a WebKitGTK view with
the desktop title bar (a stub for the Tauri bridge), in a fresh window at each
size, runs measure.js and writes measurements/SIZE-STATE.json. Needs a display
(Xvfb).

    python3 -m http.server 4173 --directory dist &
    DISPLAY=:97 python3 dynlex/tools/shell/measure_webkit.py http://localhost:4173/
"""
import json, sys
from pathlib import Path
import gi
gi.require_version("Gtk", "3.0"); gi.require_version("WebKit2", "4.1")
from gi.repository import Gtk, WebKit2, GLib

here = Path(__file__).resolve().parent
out = here / "measurements"
url = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:4173/"
sizes = [(1440, 940, True), (1200, 940, False), (1440, 800, False)]
stub = "window.__TAURI_INTERNALS__ = { invoke: async () => null, transformCallback: () => 0, convertFileSrc: s => s, metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } } };"

# Full hinting, as the native shell's FreeType text has it: whole-pixel glyph
# advances. WebKitGTK takes hinting from the GTK settings, which a bare Xvfb
# does not provide, so without this the text widths depend on the display.
settings = Gtk.Settings.get_default()
for name, value in (("gtk-xft-antialias", 1), ("gtk-xft-hinting", 1), ("gtk-xft-hintstyle", "hintfull")):
    settings.set_property(name, value)

# Each size gets a window of its own, opened at that size, with a fresh page:
# a bare Xvfb has no window manager, and GTK does not reliably carry out a
# resize of a window or view there.
state = {"step": 0, "tries": 0, "window": None, "view": None}

def run(script, done):
    state["view"].evaluate_javascript(script, -1, None, None, None, lambda v, r: done(v.evaluate_javascript_finish(r).to_string()))

def poll():
    run("window.__result === undefined ? '' : window.__result", collect)
    return False

def collect(text):
    if not text:
        GLib.timeout_add(300, poll); return
    for name, dump in json.loads(text).items():
        (out / f"{name}.json").write_text(json.dumps(dump, separators=(",", ":")))
        print("measured", name, flush=True)
    state["window"].destroy()
    state["step"] += 1
    GLib.idle_add(next_size)

def measure():
    # Measure only once the page has the size, or the states would be
    # written under the wrong one.
    w, h, history = sizes[state["step"]]
    def check(size):
        if size != f"{w}x{h}":
            state["tries"] += 1
            if state["tries"] > 20:
                print(f"the page is {size} instead of {w}x{h}", file=sys.stderr, flush=True)
                Gtk.main_quit(); return
            GLib.timeout_add(300, measure); return
        state["tries"] = 0
        run(f"delete window.__result; window.__measureAll({str(history).lower()}).then(r => window.__result = JSON.stringify(r)); 'started'", lambda _: GLib.timeout_add(500, poll))
    run("innerWidth + 'x' + innerHeight", check)
    return False

def next_size():
    if state["step"] >= len(sizes):
        Gtk.main_quit(); return False
    w, h, _ = sizes[state["step"]]
    manager = WebKit2.UserContentManager()
    for source in (stub, (here / "measure.js").read_text()):
        manager.add_script(WebKit2.UserScript.new(source, WebKit2.UserContentInjectedFrames.TOP_FRAME, WebKit2.UserScriptInjectionTime.START, None, None))
    view = WebKit2.WebView(user_content_manager=manager, web_context=WebKit2.WebContext.new_ephemeral())
    window = Gtk.Window(); window.add(view); window.set_default_size(w, h)
    state["window"], state["view"], started = window, view, [False]
    def loaded(v, event):
        # Once: a second load event would start a second, overlapping round.
        if event == WebKit2.LoadEvent.FINISHED and not started[0]:
            started[0] = True
            GLib.timeout_add(1500, measure)
    view.connect("load-changed", loaded)
    window.show_all()
    view.load_uri(url + "?desktop")
    return False

GLib.idle_add(next_size)
GLib.timeout_add(180000, Gtk.main_quit)
Gtk.main()
if state["step"] < len(sizes):
    sys.exit(f"measured {state['step']} of {len(sizes)} sizes")
