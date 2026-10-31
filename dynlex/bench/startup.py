#!/usr/bin/env python3
"""Starts an editor on an X display and reports how long until its window is
drawn (the title bar's colour at a fixed point and no change for 1 s), the
memory of its whole process tree (PSS, so shared libraries count once
proportionally) and its idle CPU over five seconds.

    DISPLAY=:97 python3 dynlex/bench/startup.py COMMAND [ARGS...]
"""
import os, subprocess, sys, time
from PIL import ImageGrab

def tree(root):
    pids, changed = {root}, True
    while changed:
        changed = False
        for pid in os.listdir("/proc"):
            if pid.isdigit() and int(pid) not in pids:
                try:
                    ppid = int(open(f"/proc/{pid}/stat").read().rsplit(")", 1)[1].split()[1])
                except Exception:
                    continue
                if ppid in pids:
                    pids.add(int(pid)); changed = True
    return pids

def pss(pids):
    total = 0
    for pid in pids:
        try:
            for line in open(f"/proc/{pid}/smaps_rollup"):
                if line.startswith("Pss:"):
                    total += int(line.split()[1])
        except Exception:
            pass
    return total

def cpu(pids):
    ticks = 0
    for pid in pids:
        try:
            f = open(f"/proc/{pid}/stat").read().rsplit(")", 1)[1].split()
            ticks += int(f[11]) + int(f[12])
        except Exception:
            pass
    return ticks * 10

env = dict(os.environ, XDG_SESSION_TYPE="x11", GDK_BACKEND="x11", VK_ICD_FILENAMES="/usr/share/vulkan/icd.d/lvp_icd.json")
env.pop("WAYLAND_DISPLAY", None)
start = time.time()
app = subprocess.Popen(sys.argv[1:], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
drawn, last, stable_since = None, None, None
while time.time() - start < 30:
    shot = ImageGrab.grab(xdisplay=os.environ.get("DISPLAY", ":97")).crop((0, 0, 1440, 940)).resize((360, 235))
    title = shot.getpixel((180, 5))
    data = shot.tobytes()
    if drawn is None and abs(title[0] - 54) < 6 and abs(title[2] - 62) < 6:
        drawn = time.time() - start
    if drawn is not None:
        if data == last:
            if stable_since and time.time() - stable_since >= 1.0:
                break
        else:
            stable_since = time.time()
    last = data
    time.sleep(0.05)
settled = (stable_since or time.time()) - start
pids = tree(app.pid)
memory = pss(pids)
before = cpu(pids); time.sleep(5); after = cpu(tree(app.pid))
print(f"first_title_s={drawn:.2f} settled_s={settled:.2f} processes={len(pids)} pss_mb={memory / 1024:.0f} idle_cpu_pct={(after - before) / 50:.1f}")
app.terminate(); app.wait()
