#!/usr/bin/env python3
"""Measures the browser editor in WebKitGTK, the engine of the desktop build.

Loads the built web editor (dist/, served at URL) in a WebKitGTK view with
the desktop title bar (a stub for the Tauri bridge), runs measure.js in each
window size and writes measurements/SIZE-STATE.json. Needs a display (Xvfb).

    python3 -m http.server 4173 --directory dist &
    DISPLAY=:97 python3 rust/tools/measure_webkit.py http://localhost:4173/
"""
import json, sys
from pathlib import Path
import gi
gi.require_version("Gtk", "3.0"); gi.require_version("WebKit2", "4.1")
from gi.repository import Gtk, WebKit2, GLib

here = Path(__file__).resolve().parent
out = here / "measurements"
out.mkdir(exist_ok=True)
url = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:4173/"
sizes = [(1440, 940, True), (1200, 940, False), (1440, 800, False)]
stub = "window.__TAURI_INTERNALS__ = { invoke: async () => null, transformCallback: () => 0, convertFileSrc: s => s, metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } } };"

manager = WebKit2.UserContentManager()
for source in (stub, (here / "measure.js").read_text()):
    manager.add_script(WebKit2.UserScript.new(source, WebKit2.UserContentInjectedFrames.TOP_FRAME, WebKit2.UserScriptInjectionTime.START, None, None))
context = WebKit2.WebContext.new_ephemeral()
view = WebKit2.WebView(user_content_manager=manager, web_context=context)
window = Gtk.Window(); window.add(view)
state = {"step": 0}

def run(script, done):
    view.evaluate_javascript(script, -1, None, None, None, lambda v, r: done(v.evaluate_javascript_finish(r).to_string()))

def poll():
    run("window.__result === undefined ? '' : window.__result", collect)
    return False

def collect(text):
    if not text:
        GLib.timeout_add(300, poll); return
    for name, dump in json.loads(text).items():
        (out / f"{name}.json").write_text(json.dumps(dump, separators=(",", ":")))
        print("measured", name, flush=True)
    state["step"] += 1
    GLib.idle_add(next_size)

def measure():
    w, h, history = sizes[state["step"]]
    run(f"delete window.__result; window.__measureAll({str(history).lower()}).then(r => window.__result = JSON.stringify(r)); 'started'", lambda _: GLib.timeout_add(500, poll))
    return False

def next_size():
    if state["step"] >= len(sizes):
        Gtk.main_quit(); return False
    w, h, _ = sizes[state["step"]]
    window.resize(w, h)
    GLib.timeout_add(1200, measure)
    return False

window.set_default_size(*sizes[0][:2])
window.show_all()
view.connect("load-changed", lambda v, e: e == WebKit2.LoadEvent.FINISHED and GLib.timeout_add(1500, next_size))
view.load_uri(url + "?desktop")
GLib.timeout_add(120000, Gtk.main_quit)
Gtk.main()
