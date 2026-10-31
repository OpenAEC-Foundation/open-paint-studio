#!/usr/bin/env python3
"""Shows the browser editor in a plain 1440 x 940 WebKitGTK window, the web
edition for run_ui_test.py: no browser chrome, a fresh profile each run.

    python3 dynlex/tests/ui/web_window.py URL
"""
import sys
import gi
gi.require_version("Gtk", "3.0"); gi.require_version("WebKit2", "4.1")
from gi.repository import Gtk, WebKit2

view = WebKit2.WebView(web_context=WebKit2.WebContext.new_ephemeral())
window = Gtk.Window(title="Open Paint Studio (web)")
window.set_decorated(False)
window.set_default_size(1440, 940)
window.move(0, 0)
window.add(view)
window.connect("destroy", Gtk.main_quit)
window.show_all()
view.load_uri(sys.argv[1] if len(sys.argv) > 1 else "http://localhost:4173/")
Gtk.main()
