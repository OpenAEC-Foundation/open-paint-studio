#!/usr/bin/env python3
"""Shows the same states in the Tauri build and in the Rust edition and
counts the pixels that agree: within 8 levels in every channel of the Tauri
build's screenshot, at 1440 x 940.

Each target starts fresh (its own empty data directories) on an X display
without a window manager (Xvfb); the mouse clicks with XTEST at the click
regions of the measured interface (src/skin_data.rs), the same for both.
Screenshots go to rust/target/compare/TARGET/NAME.png, the table to
rust/target/compare/report.md.

    DISPLAY=:93 python3 rust/tools/compare_tauri.py [TAURI_BINARY]

With RUN=rust in the environment only the Rust edition is shot again.
"""
import ctypes, os, re, subprocess, sys, tempfile, time
from pathlib import Path
from PIL import Image, ImageChops, ImageGrab

here = Path(__file__).resolve().parent
rust = here.parent
root = rust.parent
out = rust / "target" / "compare"
display = os.environ.get("DISPLAY", ":93")
tauri = sys.argv[1] if len(sys.argv) > 1 else str(root / "src-tauri" / "target" / "release" / "openaec-paint-studio")
targets = {"tauri": [tauri], "rust": [str(rust / "target" / "release" / "open-paint-studio")]}

X = ctypes.CDLL("libX11.so.6"); T = ctypes.CDLL("libXtst.so.6")
X.XOpenDisplay.restype = ctypes.c_void_p
X.XFlush.argtypes = [ctypes.c_void_p]
T.XTestFakeMotionEvent.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_ulong]
T.XTestFakeButtonEvent.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_int, ctypes.c_ulong]
d = X.XOpenDisplay(display.encode())

def move(x, y): T.XTestFakeMotionEvent(d, -1, int(x), int(y), 0); X.XFlush(d); time.sleep(0.05)
def click(x, y):
    move(x, y)
    for down in (1, 0):
        T.XTestFakeButtonEvent(d, 1, down, 0); X.XFlush(d); time.sleep(0.06)
def park(): move(1590, 990)

# Click regions: (action, tab, opened) -> centre.
hits = {}
pattern = re.compile(r'kind: K::Hit, tab: (-?\d+), opened: (-?\d+),.*?r: \[([-\d.]+), ([-\d.]+), ([-\d.]+), ([-\d.]+)\].*action: "([^"]*)"')
for line in (rust / "src" / "skin_data.rs").read_text().splitlines():
    m = pattern.search(line)
    if m:
        x, y, w, h = (float(v) for v in m.group(3, 4, 5, 6))
        hits.setdefault((m.group(7), int(m.group(1)), int(m.group(2))), (x + w / 2, y + h / 2))
def at(action):
    return next(v for k, v in hits.items() if k[0] == action)

# The states: the four ribbon tabs, each of the five menus, the file panel.
STATES = [("Start", ["tab:Start"]), ("Afbeelding", ["tab:Afbeelding"]), ("Beeld", ["tab:Beeld"]),
          ("Automatisering", ["tab:Automatisering"])]
STATES += [(f"menu {i}", ["tab:Start", f"toggle:{i}"]) for i in range(5)]
STATES += [("file panel", ["tab:Start", "file"])]
# Three brush strokes on the canvas: the drawing and the history list.
STATES += [("three strokes", ["tab:Start", "drag:300,350:600,550", "drag:700,400:900,650", "drag:400,700:800,750"])]

def settle(previous=None, limit=6.0):
    """Waits until the screen stops changing; returns the screenshot."""
    start, last, stable = time.time(), None, None
    while time.time() - start < limit:
        shot = ImageGrab.grab(xdisplay=display).crop((0, 0, 1440, 940))
        data = shot.tobytes()
        if data == last and data != previous:
            if stable and time.time() - stable >= 0.6:
                return shot
        else:
            stable = time.time()
        last = data
        time.sleep(0.1)
    return shot

def run(target):
    (out / target).mkdir(parents=True, exist_ok=True)
    for name, steps in STATES:
        data = tempfile.mkdtemp(prefix=f"ops-{target}-")
        env = dict(os.environ, DISPLAY=display, XDG_SESSION_TYPE="x11", GDK_BACKEND="x11", HOME=data,
                   XDG_DATA_HOME=f"{data}/data", XDG_CONFIG_HOME=f"{data}/config", XDG_CACHE_HOME=f"{data}/cache")
        env.pop("WAYLAND_DISPLAY", None)
        park()
        app = subprocess.Popen(targets[target], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        shot = settle(limit=15.0)
        for step in steps:
            if step.startswith("drag:"):
                (x0, y0), (x1, y1) = (map(int, p.split(",")) for p in step[5:].split(":"))
                move(x0, y0); T.XTestFakeButtonEvent(d, 1, 1, 0); X.XFlush(d); time.sleep(0.05)
                for i in range(1, 21):
                    move(x0 + (x1 - x0) * i / 20, y0 + (y1 - y0) * i / 20)
                T.XTestFakeButtonEvent(d, 1, 0, 0); X.XFlush(d); time.sleep(0.3)
                park()
                shot = settle(shot.tobytes())
            elif step != "tab:Start":
                click(*at(step)); park()
                shot = settle(shot.tobytes())
        shot.save(out / target / f"{re.sub(r'[^a-z0-9]+', '-', name.lower())}.png")
        app.terminate(); app.wait()
        time.sleep(0.3)

def agreement(a, b, level=8):
    diff = ImageChops.difference(a.convert("RGB"), b.convert("RGB"))
    bands = [band.point(lambda v: 255 if v > level else 0) for band in diff.split()]
    off = ImageChops.lighter(ImageChops.lighter(bands[0], bands[1]), bands[2])
    return 100.0 * (1 - off.histogram()[255] / (a.width * a.height))

if __name__ == "__main__":
    for target in os.environ.get("RUN", "tauri,rust").split(","):
        run(target)
    rows = []
    for name, _ in STATES:
        slug = re.sub(r"[^a-z0-9]+", "-", name.lower())
        a, b = Image.open(out / "tauri" / f"{slug}.png"), Image.open(out / "rust" / f"{slug}.png")
        rows.append((name, agreement(a, b)))
    lines = ["| " + " | ".join(n for n, _ in rows) + " |", "|" + "---|" * len(rows), "| " + " | ".join(f"{v:.1f} %" for _, v in rows) + " |"]
    (out / "report.md").write_text("\n".join(lines) + "\n")
    print("\n".join(lines))
