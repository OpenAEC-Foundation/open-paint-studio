#!/usr/bin/env python3
"""Checks the list of files opened last on the File menu's Open page of Open
Paint Studio (dynlex/build/open-paint-studio) with real mouse and keyboard
input, on an X display (Xvfb :97) at 1440 x 940.

The editor starts with its own configuration folder holding a list of four
files, one of them with a name too long for its row and one that no longer
exists. The test opens the page, clicks rows and reads the list back from
openaec-paint-studio/recent in that folder; it also checks that Escape closes
the File page and that a file given on the command line joins the list.
Screenshots go to dynlex/build/ui-test/recent/.

    DISPLAY=:97 python3 dynlex/tests/ui/run_recent_test.py
"""
import os, shutil, subprocess, sys, tempfile, time
from pathlib import Path
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
import run_ui_test as ui

failures = []
def check(name, passed):
    print(f"{'ok    ' if passed else 'FAILED'} {name}", flush=True)
    if not passed:
        failures.append(name)

# Resolved: the editor keeps each file under its real path.
data = Path(tempfile.mkdtemp(prefix="ui-recent-")).resolve()
pictures = data / "pictures" / "a folder with a long name" / "and another one below it" / "and a third to pass the row"
pictures.mkdir(parents=True)
first, second = data / "pictures" / "łódź схема.png", data / "pictures" / "second.png"
long = pictures / "a file name that is much too long to fit the row it is shown in, with an ending.png"
missing = data / "pictures" / "missing.png"
Image.new("RGB", (320, 200), (210, 60, 50)).save(first)
Image.new("RGB", (200, 320), (40, 90, 200)).save(second)
Image.new("RGB", (240, 240), (60, 160, 90)).save(long)
listed = data / "config" / "openaec-paint-studio" / "recent"
listed.parent.mkdir(parents=True)
listed.write_text(f"2026-11-09 16:20 {first}\n2026-11-08 09:05 {long}\n2026-11-07 11:45 {missing}\n2026-11-06 08:00 {second}\n")
def paths(): return [line[17:] for line in listed.read_text().splitlines()]

shutil.rmtree(ui.out / "recent", ignore_errors=True); (ui.out / "recent").mkdir(parents=True)
shots = 0
def shot(name):
    global shots
    shots += 1
    return ui.shot("recent", shots, name)
def stop(app):
    app.terminate()
    try:
        app.wait(timeout=5)
    except subprocess.TimeoutExpired:
        app.kill()
def open_page():
    ui.press("file"); time.sleep(0.5); ui.press("page:Openen", -1, 20); ui.park(); time.sleep(0.6)
x, y = ui.at("recent", -1, 21)
def row(index): ui.click(x, y + 41 * index); ui.park(); time.sleep(1.0)

app = ui.start("native", data)
try:
    time.sleep(3); ui.park(); time.sleep(0.5)
    workspace = shot("workspace")
    open_page()
    page = shot("open page with four files")
    check("the Open page shows", ui.differ(page, workspace) > 1)

    # The fourth row: opens, comes first, the page closes.
    row(3)
    opened = shot("fourth file opened")
    check("a row opens its file and moves it to the top", paths() == [str(second), str(first), str(long), str(missing)])
    check("the page closes on opening", ui.differ(opened, page) > 1)

    # The file that is gone leaves the list.
    open_page(); shot("open page after opening")
    row(3)
    check("a file that is gone leaves the list", paths() == [str(second), str(first), str(long)])

    # Escape closes the File page.
    ui.key("Escape"); ui.park(); time.sleep(0.5)
    before = shot("before the file page")
    open_page()
    shown = shot("open page with three files")
    ui.key("Escape"); ui.park(); time.sleep(0.6)
    after = shot("after escape")
    check("Escape closes the File page", ui.differ(shown, before) > 1 and ui.differ(after, before) < 0.01)
finally:
    stop(app)

# A file given on the command line joins the list.
env = dict(os.environ, DISPLAY=ui.display, XDG_CONFIG_HOME=str(data / "config"))
env.pop("WAYLAND_DISPLAY", None)
app = subprocess.Popen([str(ui.root / "dynlex" / "build" / "open-paint-studio"), str(long)], env=env, cwd=ui.root, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    time.sleep(3); ui.park()
    check("a file from the command line comes first", paths() == [str(long), str(second), str(first)])
    open_page(); shot("open page after the command line")
finally:
    stop(app)

shutil.rmtree(data, ignore_errors=True)
print(f"{len(failures)} failed; screenshots in {ui.out / 'recent'}")
sys.exit(1 if failures else 0)
