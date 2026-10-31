#!/usr/bin/env python3
"""Starts an editor on an X display and reports, to the millisecond, how long
until its window exists and until its title bar is drawn (the title bar's
colour at a fixed point), by asking the X server directly through Xlib.

    DISPLAY=:98 python3 dynlex/bench/first_frame.py [-n RUNS] COMMAND [ARGS...]
"""
import ctypes, os, subprocess, sys, time

x11 = ctypes.CDLL("libX11.so.6")
x11.XOpenDisplay.restype = ctypes.c_void_p
x11.XOpenDisplay.argtypes = [ctypes.c_char_p]
x11.XDefaultRootWindow.restype = ctypes.c_ulong
x11.XDefaultRootWindow.argtypes = [ctypes.c_void_p]
x11.XQueryTree.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.c_ulong), ctypes.POINTER(ctypes.POINTER(ctypes.c_ulong)), ctypes.POINTER(ctypes.c_uint)]
x11.XFetchName.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.POINTER(ctypes.c_char_p)]
x11.XFree.argtypes = [ctypes.c_void_p]
x11.XGetImage.restype = ctypes.c_void_p
x11.XGetImage.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_int, ctypes.c_int, ctypes.c_uint, ctypes.c_uint, ctypes.c_ulong, ctypes.c_int]
x11.XGetPixel.restype = ctypes.c_ulong
x11.XGetPixel.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_int]
x11.XDestroyImage.argtypes = [ctypes.c_void_p]
x11.XSync.argtypes = [ctypes.c_void_p, ctypes.c_int]
x11.XSetErrorHandler.argtypes = [ctypes.c_void_p]
x11.XSetErrorHandler(ctypes.cast(ctypes.CFUNCTYPE(ctypes.c_int, ctypes.c_void_p, ctypes.c_void_p)(lambda d, e: 0), ctypes.c_void_p))

display = x11.XOpenDisplay(None)
root = x11.XDefaultRootWindow(display)

def find_window(title):
    r, p = ctypes.c_ulong(), ctypes.c_ulong()
    children, count = ctypes.POINTER(ctypes.c_ulong)(), ctypes.c_uint()
    if not x11.XQueryTree(display, root, ctypes.byref(r), ctypes.byref(p), ctypes.byref(children), ctypes.byref(count)):
        return None
    found = None
    for i in range(count.value):
        name = ctypes.c_char_p()
        if x11.XFetchName(display, children[i], ctypes.byref(name)) and name.value:
            if title in name.value.decode(errors="replace"):
                found = children[i]
            x11.XFree(name)
    if count.value:
        x11.XFree(children)
    return found

def title_pixel(window):
    image = x11.XGetImage(display, window, 720, 20, 1, 1, 0xFFFFFFFF, 2)
    if not image:
        return None
    pixel = x11.XGetPixel(image, 0, 0)
    x11.XDestroyImage(image)
    return ((pixel >> 16) & 255, (pixel >> 8) & 255, pixel & 255)

def one_run(command):
    env = dict(os.environ, XDG_SESSION_TYPE="x11", GDK_BACKEND="x11")
    env.pop("WAYLAND_DISPLAY", None)
    start = time.perf_counter()
    app = subprocess.Popen(command, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    window = None
    appeared = drawn = None
    while time.perf_counter() - start < 10:
        if window is None:
            window = find_window("Open Paint Studio")
            if window is not None:
                appeared = time.perf_counter() - start
        else:
            pixel = title_pixel(window)
            if pixel and abs(pixel[0] - 54) < 8 and abs(pixel[2] - 62) < 8:
                drawn = time.perf_counter() - start
                break
        time.sleep(0.001)
    app.terminate()
    try:
        app.wait(timeout=2)
    except subprocess.TimeoutExpired:
        app.kill()
    return appeared, drawn

args = sys.argv[1:]
runs = 5
if args and args[0] == "-n":
    runs = int(args[1]); args = args[2:]
results = [one_run(args) for _ in range(runs)]
time.sleep(0.2)
for appeared, drawn in results:
    print(f"window_s={appeared if appeared is None else round(appeared, 3)} drawn_s={drawn if drawn is None else round(drawn, 3)}")
drawn = sorted(d for _, d in results if d is not None)
if drawn:
    print(f"median_drawn_s={drawn[len(drawn) // 2]:.3f} best_s={drawn[0]:.3f}")
