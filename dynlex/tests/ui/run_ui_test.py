#!/usr/bin/env python3
"""Drives the whole interface of all three editions with real mouse and
keyboard input (XTEST) and compares them step by step.

Targets, each started fresh with its own empty data directory on an X display
(Xvfb :97) at 1440 x 940:
  web     the built browser editor (dist/, served at http://localhost:4173/) in
          a WebKitGTK window, as a browser shows it
  tauri   the desktop build (src-tauri/target/release/openaec-paint-studio)
  native  Open Paint Studio (dynlex/build/open-paint-studio)

Every step clicks, drags or types, waits, and saves a screenshot to
dynlex/build/ui-test/TARGET/NN-name.png. The report (report.md there) lists
per step whether the screen changed and how many pixels differ from the
desktop build by more than 8 levels; steps where an edition reacts differently
are flagged.

Click positions come from the measured interface (paint/skin_data.dl), the
same for all three editions.

    DISPLAY=:97 python3 dynlex/tests/ui/run_ui_test.py [TARGET...]
"""
import ctypes, os, re, shutil, subprocess, sys, tempfile, time
from pathlib import Path
from PIL import Image, ImageChops, ImageGrab

root = Path(__file__).resolve().parents[3]
out = root / "dynlex" / "build" / "ui-test"
display = os.environ.get("DISPLAY", ":97")

# --- Input ---
X = ctypes.CDLL("libX11.so.6"); T = ctypes.CDLL("libXtst.so.6")
X.XOpenDisplay.restype = ctypes.c_void_p
X.XFlush.argtypes = [ctypes.c_void_p]
X.XKeysymToKeycode.argtypes = [ctypes.c_void_p, ctypes.c_ulong]
X.XStringToKeysym.restype = ctypes.c_ulong
T.XTestFakeMotionEvent.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_ulong]
T.XTestFakeButtonEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
T.XTestFakeKeyEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
d = X.XOpenDisplay(display.encode())

def flush(): X.XFlush(d)
def move(x, y): T.XTestFakeMotionEvent(d, -1, int(x), int(y), 0); flush(); time.sleep(0.04)
def button(down, b=1): T.XTestFakeButtonEvent(d, b, 1 if down else 0, 0); flush(); time.sleep(0.06)
def click(x, y): move(x, y); button(True); button(False)
def drag(points):
    move(*points[0]); button(True)
    for p in points[1:]:
        move(*p)
    button(False)
def line(a, b, n=14): return [(a[0] + (b[0] - a[0]) * i / n, a[1] + (b[1] - a[1]) * i / n) for i in range(n + 1)]
def keycode(name): return X.XKeysymToKeycode(d, X.XStringToKeysym(name.encode()))
def key(name, *mods):
    for m in mods: T.XTestFakeKeyEvent(d, keycode(m), 1, 0); flush(); time.sleep(0.03)
    T.XTestFakeKeyEvent(d, keycode(name), 1, 0); flush(); time.sleep(0.05)
    T.XTestFakeKeyEvent(d, keycode(name), 0, 0); flush(); time.sleep(0.05)
    for m in reversed(mods): T.XTestFakeKeyEvent(d, keycode(m), 0, 0); flush(); time.sleep(0.03)
def type_text(text):
    for ch in text:
        if ch.isupper(): key(ch.lower(), "Shift_L")
        elif ch == " ": key("space")
        else: key(ch)
# Keys go to the window under the pointer (Xvfb has no window manager), so
# the pointer rests on an empty stretch of the status bar between steps.
def park(): move(640, 926)

# --- Click positions from the measured interface ---
hits = {}
pattern = re.compile(r'add kind 4 when (-?\d+) (-?\d+) .*? at \(?(-?[\d.]+)\)? \(?(-?[\d.]+)\)? \(?(-?[\d.]+)\)? \(?(-?[\d.]+)\)? showing .* "([^"]*)" to skin')
for text in (root / "dynlex" / "paint" / "skin_data.dl").read_text().splitlines():
    m = pattern.search(text)
    if m:
        tab, opened = int(m.group(1)), int(m.group(2))
        x, y, w, h = (float(v) for v in m.group(3, 4, 5, 6))
        hits.setdefault((m.group(7), tab, opened), (x + w / 2, y + h / 2))
def at(action, tab=0, opened=-1):
    for key_ in ((action, tab, opened), (action, -1, opened), (action, 0, opened), (action, -1, -1)):
        if key_ in hits:
            return hits[key_]
    raise KeyError(action)
def press(action, tab=0, opened=-1): click(*at(action, tab, opened))
C = (602, 558)   # middle of the canvas at the fitted zoom
def on(dx, dy): return (C[0] + dx, C[1] + dy)

# --- The steps: (name, action, wait) ---
def menu(index, item):
    def run():
        press(f"toggle:{index}"); time.sleep(0.4); press(f"menu:{item}", 0, index)
    return run
steps = [
    ("start", lambda: None, 0.5),
    # Tools by button and by key.
    *[(f"tool button {t}", (lambda t=t: press(f"tool:{t}")), 0.4) for t in ("eraser", "fill", "picker", "line", "rectangle", "ellipse", "text", "select", "brush")],
    *[(f"key {k}", (lambda k=k: key(k)), 0.4) for k in ("e", "f", "i", "l", "r", "o", "t", "v", "b")],
    # Drawing with every tool.
    ("brush stroke", lambda: drag(line(on(-300, -150), on(-50, 50))), 0.8),
    ("line", lambda: (key("l"), drag(line(on(-300, 100), on(0, 180)))), 0.8),
    ("rectangle", lambda: (key("r"), drag(line(on(50, -180), on(250, -40)))), 0.8),
    ("ellipse", lambda: (key("o"), drag(line(on(50, 20), on(280, 200)))), 0.8),
    ("fill inside the ellipse", lambda: (key("f"), click(*on(165, 110))), 1.2),
    ("eraser stroke", lambda: (key("e"), drag(line(on(-280, -140), on(-120, -60)))), 0.8),
    ("picker on the stroke", lambda: (key("i"), click(*on(-80, 30))), 0.8),
    ("swatch red", lambda: (key("b"), press("color:#dc2626")), 0.5),
    ("red stroke", lambda: drag(line(on(-300, 200), on(250, 230))), 0.8),
    ("swatch white", lambda: press("color:#ffffff"), 0.5),
    ("swatch dark", lambda: press("color:#36363e"), 0.5),
    ("colour picker opens", lambda: press("toggle:1"), 0.6),
    ("picker: drag in the field", lambda: drag(line((at("drag:color.field", 0, 1)[0] + 40, at("drag:color.field", 0, 1)[1] - 40), (at("drag:color.field", 0, 1)[0] + 70, at("drag:color.field", 0, 1)[1] - 50), 4)), 0.6),
    ("picker: drag the hue", lambda: drag(line(at("drag:color.hue", 0, 1), (at("drag:color.hue", 0, 1)[0] - 60, at("drag:color.hue", 0, 1)[1]), 4)), 0.6),
    ("picker: escape closes", lambda: key("Escape"), 0.5),
    ("vector objects off", lambda: press("vector"), 0.8),
    ("vector objects on", lambda: press("vector"), 0.6),
    # Properties.
    ("size up", lambda: (move(*at("size")), click(at("size")[0] + 20, at("size")[1] - 6)), 0.5),
    ("size up again", lambda: click(at("size")[0] + 20, at("size")[1] - 6), 0.5),
    ("size down", lambda: click(at("size")[0] + 20, at("size")[1] + 6), 0.5),
    ("opacity to half", lambda: drag(line(at("opacity"), (at("opacity")[0] - 2, at("opacity")[1]), 3)), 0.6),
    ("opacity back to full", lambda: drag(line(at("opacity"), (at("opacity")[0] + 40, at("opacity")[1]), 3)), 0.6),
    # Undo and redo, by button and by key.
    ("undo button", lambda: press("cmd:Undo"), 0.8),
    ("redo button", lambda: press("cmd:Redo"), 0.8),
    ("ctrl+z", lambda: key("z", "Control_L"), 0.8),
    ("ctrl+y", lambda: key("y", "Control_L"), 0.8),
    ("ctrl+z twice", lambda: (key("z", "Control_L"), key("z", "Control_L")), 0.8),
    ("ctrl+shift+z", lambda: key("z", "Control_L", "Shift_L"), 0.8),
    # Text, and Escape in every situation.
    ("text: place and type", lambda: (key("t"), click(*on(-250, -200)), time.sleep(0.4), type_text("Test")), 0.8),
    ("text: ctrl+enter applies", lambda: key("Return", "Control_L"), 0.8),
    ("escape while typing", lambda: (key("t"), click(*on(0, -220)), time.sleep(0.4), type_text("Weg"), key("Escape")), 0.8),
    ("escape mid stroke", lambda: (key("b"), move(*on(-200, 120)), button(True), [move(*p) for p in line(on(-200, 120), on(100, 120), 8)], key("Escape"), button(False)), 0.8),
    ("escape closes a menu", lambda: (press("toggle:1"), time.sleep(0.4), key("Escape")), 0.6),
    ("escape closes the file panel", lambda: (press("file"), time.sleep(0.4), key("Escape")), 0.6),
    ("select tool, delete", lambda: (key("v"), click(*on(160, -100)), key("Delete")), 0.8),
    # The five menus.
    ("menu export open", lambda: press("toggle:0"), 0.5),
    ("menu export closes", lambda: press("toggle:0"), 0.4),
    ("rotate 90", menu(2, "90° draaien"), 1.2),
    ("rotate left", menu(2, "Links draaien"), 1.2),
    ("flip horizontal", menu(2, "Horizontaal spiegelen"), 1.2),
    ("flip vertical", menu(2, "Verticaal spiegelen"), 1.2),
    ("grayscale", menu(3, "Grijswaarden"), 1.2),
    ("invert", menu(3, "Kleuren omkeren"), 1.2),
    ("invert back", menu(3, "Kleuren omkeren"), 1.2),
    ("sepia", menu(3, "Sepia"), 1.2),
    ("undo sepia", lambda: key("z", "Control_L"), 1.0),
    ("view: grid", menu(5, "Raster"), 0.6),
    ("view: grid off", menu(5, "Raster"), 0.6),
    ("view: actual size", menu(5, "Ware grootte"), 0.6),
    ("view: zoom out", menu(5, "−"), 0.6),
    ("view: zoom in", menu(5, "+"), 0.6),
    ("view: properties panel", menu(5, "Eigenschappen"), 0.6),
    ("view: properties panel back", menu(5, "Eigenschappen"), 0.6),
    ("view: settings", menu(5, "Instellingen"), 0.6),
    ("escape closes settings", lambda: key("Escape"), 0.6),
    # Ribbon buttons.
    ("fit (ribbon)", lambda: press("cmd:Passend maken"), 0.6),
    ("resize dialog", lambda: press("cmd:Formaat wijzigen"), 0.8),
    ("escape closes resize", lambda: key("Escape"), 0.6),
    ("colour corrections", lambda: press("cmd:Kleurcorrecties"), 0.8),
    ("escape closes corrections", lambda: key("Escape"), 0.6),
    ("crop tool", lambda: press("cmd:Bijsnijden"), 0.5),
    ("crop drag", lambda: drag(line(on(-350, -230), on(300, 200))), 1.5),
    ("undo crop", lambda: key("z", "Control_L"), 1.2),
    ("focus mode", lambda: press("cmd:Focusmodus"), 0.8),
    ("escape after focus", lambda: key("Escape"), 0.6),
    ("focus mode off", lambda: click(1371, 59), 0.8),   # the top line's button, at the right in focus mode
    # The view and API commands on Start (small icon buttons).
    ("zoom out (icon)", lambda: press("cmd:Uitzoomen"), 0.6),
    ("zoom in (icon)", lambda: press("cmd:Inzoomen"), 0.6),
    ("actual size (icon)", lambda: press("cmd:Ware grootte"), 0.6),
    ("fit again", lambda: press("cmd:Passend maken"), 0.6),
    ("API dialog (icon)", lambda: press("cmd:API verbinden"), 0.8),
    ("API: type a token", lambda: (press("focus:api.token", -1, 34), type_text("geheim")), 0.6),
    ("escape closes API", lambda: key("Escape"), 0.6),
    # The File pages.
    ("file: New page", lambda: press("file"), 0.6),
    ("file: Open page", lambda: press("page:Openen", -1, 20), 0.5),
    ("file: Save page", lambda: press("page:Opslaan", -1, 21), 0.5),
    ("file: Export page", lambda: press("page:Exporteren", -1, 22), 0.5),
    ("file: Formats page", lambda: press("page:Formaten", -1, 23), 1.5),
    ("file: About page", lambda: press("page:Over", -1, 24), 0.5),
    ("file: return to workspace", lambda: press("file:Terug naar werkgebied", -1, 25), 0.6),
    ("file again, escape", lambda: (press("file"), time.sleep(0.4), key("Escape")), 0.6),
    # The dialogs, used.
    ("new canvas dialog", lambda: press("cmd:Nieuw canvas", -1), 0.8),
    ("new: preset 800 x 600", lambda: press("preset:800x600", -1, 30), 0.5),
    ("new: type a name", lambda: (press("focus:new.name", -1, 30), [key("BackSpace") for _ in range(8)], type_text("Schets")), 0.5),
    ("new: background transparent", lambda: press("select:new.background", -1, 30), 0.6),
    ("new: create", lambda: press("dialog:new:Canvas maken", -1, 30), 1.5),
    ("confirm replacing", lambda: (move(780, 480), key("Return")), 1.5),
    ("resize dialog (2)", lambda: press("cmd:Formaat wijzigen"), 0.8),
    ("resize: type width", lambda: (press("focus:resize.width", -1, 31), [key("BackSpace") for _ in range(4)], type_text("400")), 0.5),
    ("resize: apply", lambda: press("dialog:resize:Toepassen", -1, 31), 1.2),
    ("corrections dialog (2)", lambda: press("cmd:Kleurcorrecties"), 0.8),
    ("corrections: brightness", lambda: drag(line(at("drag:adjust.brightness", -1, 32), (at("drag:adjust.brightness", -1, 32)[0] + 60, at("drag:adjust.brightness", -1, 32)[1]), 4)), 0.6),
    ("corrections: apply", lambda: press("dialog:adjust:Toepassen", -1, 32), 1.2),
    ("settings dialog (2)", lambda: press("cmd:Settings", -1), 0.8),
    ("settings: close button", lambda: press("dialog:close", -1, 33), 0.6),
    # Status bar and shortcuts for the view.
    ("status: zoom in", lambda: press("cmd:Zoom in"), 0.6),
    ("status: zoom out", lambda: press("cmd:Zoom out"), 0.6),
    ("status: 100%", lambda: press("cmd:actual"), 0.6),
    ("status: fit", lambda: press("cmd:Passend maken", -1), 0.6),
    ("status: zoom slider", lambda: drag(line(at("zoomslider"), (at("zoomslider")[0] + 25, at("zoomslider")[1]), 4)), 0.6),
    ("key 0 fits", lambda: key("0"), 0.6),
    ("key + zooms in", lambda: key("equal"), 0.6),
    ("key - zooms out", lambda: key("minus"), 0.6),
    ("key g grid", lambda: key("g"), 0.6),
    ("key g grid off", lambda: key("g"), 0.6),
    ("wheel zoom", lambda: (move(*C), button(True, 4), button(False, 4)), 0.6),
    ("key 0 fits again", lambda: key("0"), 0.6),
    # Files and the title bar.
    ("file panel", lambda: press("file"), 0.6),
    ("file panel closes", lambda: key("Escape"), 0.5),
    ("open dialog", lambda: (press("cmd:Openen"), time.sleep(1.5)), 0.5),
    ("open dialog cancelled", lambda: (move(780, 480), key("Escape")), 0.8),   # the pointer on the dialog, which takes the key
    ("save dialog", lambda: (press("cmd:Save"), time.sleep(1.5)), 0.5),
    ("save dialog cancelled", lambda: (move(780, 480), key("Escape")), 0.8),
    ("new canvas (+)", lambda: press("cmd:Nieuw canvas"), 0.8),
    ("escape after new canvas", lambda: key("Escape"), 0.6),
    ("maximize", lambda: press("cmd:Maximize"), 1.0),
    ("restore", lambda: press("cmd:Maximize"), 1.0),
]

# --- Targets ---
def start(target, data):
    env = dict(os.environ, DISPLAY=display, XDG_SESSION_TYPE="x11", GDK_BACKEND="x11",
               XDG_DATA_HOME=f"{data}/data", XDG_CONFIG_HOME=f"{data}/config", XDG_CACHE_HOME=f"{data}/cache",
               VK_ICD_FILENAMES="/usr/share/vulkan/icd.d/lvp_icd.json",
               # File dialogs on the test display, not through the desktop's portal.
               GDK_DEBUG="no-portals", GTK_USE_PORTAL="0")
    env.pop("WAYLAND_DISPLAY", None)
    if target == "tauri":
        command = [str(root / "src-tauri" / "target" / "release" / "openaec-paint-studio")]
    elif target == "native":
        command = [str(root / "dynlex" / "build" / "open-paint-studio")]
    else:
        command = [sys.executable, str(Path(__file__).with_name("web_window.py")), "http://localhost:4173/"]
    return subprocess.Popen(command, env=env, cwd=root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

def shot(target, index, name):
    path = out / target / f"{index:02d}-{re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')}.png"
    ImageGrab.grab(xdisplay=display).crop((0, 0, 1440, 940)).save(path)
    return path

def run(target):
    shutil.rmtree(out / target, ignore_errors=True); (out / target).mkdir(parents=True)
    data = tempfile.mkdtemp(prefix=f"ui-{target}-")
    app = start(target, data)
    time.sleep(8 if target != "native" else 3)
    park(); time.sleep(0.5)
    paths = []
    for index, (name, action, wait) in enumerate(steps):
        action(); park(); time.sleep(wait)
        paths.append(shot(target, index, name))
        print(f"{target} {index:02d} {name}{'' if app.poll() is None else f'  (process ended: {app.returncode})'}", flush=True)
    app.terminate()
    try:
        app.wait(timeout=5)
    except subprocess.TimeoutExpired:
        app.kill()
    for leftover in ("zenity",):
        subprocess.run(["pkill", "-f", leftover], stderr=subprocess.DEVNULL)
    shutil.rmtree(data, ignore_errors=True)
    return paths

def differ(a, b, top=0):
    da = Image.open(a).convert("RGB").crop((0, top, 1440, 940)); db = Image.open(b).convert("RGB").crop((0, top, 1440, 940))
    h = ImageChops.difference(da, db).convert("L").histogram()
    return 100 * sum(h[9:]) / sum(h)

def report(targets):
    lines = ["# UI test: all three editions, step by step", "",
             "Changed: the step changed the screen. Off: pixels more than 8 levels from the desktop build after the step (the web edition without its title bar, which has no window buttons).", "",
             "| # | step | " + " | ".join(f"{t} changed" for t in targets) + " | " + " | ".join(f"{t} off" for t in targets if t != "tauri") + " | flag |",
             "|---|---|" + "---|" * (len(targets) + len([t for t in targets if t != "tauri"]) + 1)]
    flagged = 0
    for index, (name, _, _) in enumerate(steps):
        slug = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')
        cells, changes, offs = [], [], []
        for t in targets:
            now = out / t / f"{index:02d}-{slug}.png"
            if index == 0:
                changes.append(True); cells.append("—"); continue
            prev = sorted((out / t).glob(f"{index - 1:02d}-*.png"))[0]
            changed = differ(now, prev) > 0.01
            changes.append(changed); cells.append("yes" if changed else "no")
        for t in targets:
            if t == "tauri":
                continue
            off = differ(out / t / f"{index:02d}-{slug}.png", out / "tauri" / f"{index:02d}-{slug}.png", 42 if t == "web" else 0)
            offs.append(off); cells.append(f"{off:.1f} %")
        flag = (len(set(changes)) > 1) or any(o > 4.0 for o in offs)
        flagged += flag
        lines.append(f"| {index} | {name} | " + " | ".join(cells) + f" | {'**check**' if flag else ''} |")
    lines += ["", f"{flagged} of {len(steps)} steps flagged."]
    (out / "report.md").write_text("\n".join(lines) + "\n")
    print(f"{flagged} of {len(steps)} steps flagged; report in {out / 'report.md'}")

if __name__ == "__main__":
    targets = sys.argv[1:] or ["tauri", "web", "native"]
    for t in targets:
        run(t)
    if all((out / t).exists() for t in ("tauri", "web", "native")):
        report(["tauri", "web", "native"])
