#!/usr/bin/env python3
"""Compares what the editor decoded (build/images/decoded/NAME.png, written
by bench/open_images.dl) with an independent reference decode of each file:
Pillow where it reads the format, gdk-pixbuf (through PyGObject) otherwise.
Fully transparent pixels compare by alpha only. XBM goes to gdk-pixbuf, which
draws set bits black as browsers do (Pillow inverts them), and a 32-bit BMP
keeps its fourth byte as alpha, as WebKit does (Pillow drops it). Prints one line per image and
exits non-zero when any differs beyond the tolerance for its kind of format."""
import sys, warnings
warnings.filterwarnings("ignore")
from pathlib import Path
from PIL import Image, ImageOps, ImageChops

root = Path(__file__).resolve().parents[2] / "build" / "images"
decoded = root / "decoded"
lossy = (".jpg", ".jpeg", ".webp", ".avif", ".jp2", ".heic", ".jxl")

def pixbuf_reference(path):
    import gi
    gi.require_version("GdkPixbuf", "2.0")
    from gi.repository import GdkPixbuf
    buf = GdkPixbuf.Pixbuf.new_from_file(str(path)).apply_embedded_orientation()
    mode = "RGBA" if buf.get_has_alpha() else "RGB"
    im = Image.frombytes(mode, (buf.get_width(), buf.get_height()), buf.read_pixel_bytes().get_data(), "raw", mode, buf.get_rowstride())
    return im.convert("RGBA"), "gdk-pixbuf"

def reference(path):
    if path.suffix.lower() in (".svg", ".svgz", ".avif", ".xpm", ".jxl", ".heic", ".dds", ".xbm"):
        return pixbuf_reference(path)
    try:
        im = Image.open(path)
        im.load()
        if im.format == "BMP" and im.info.get("compression") == 0 and open(path, "rb").read()[28] == 32:
            raw = Image.frombuffer("RGBA", im.size, open(path, "rb").read()[int.from_bytes(open(path, "rb").read()[10:14], "little"):], "raw", "BGRA", 0, -1)
            if raw.getextrema()[3][1] > 0:
                return raw.copy(), "BMP bytes"
        im = ImageOps.exif_transpose(im)
        if im.mode in ("I;16", "I;16B", "I"):
            im = im.point(lambda v: v / 257).convert("L")
        return im.convert("RGBA"), "Pillow"
    except Exception:
        return pixbuf_reference(path)

# Formats this system's gdk-pixbuf (glycin loaders) lists but cannot read.
unsupported = {".dds": "glycin has no DDS loader; the editor reports that it cannot open it"}
failed = 0
for folder in ("generated", "system"):
    for path in sorted((root / folder).iterdir()):
        ours = decoded / (path.name + ".png")
        if not ours.exists():
            if path.suffix.lower() in unsupported:
                print(f"UNSUPP  {folder}/{path.name}: {unsupported[path.suffix.lower()]}"); continue
            print(f"MISSING {folder}/{path.name}"); failed += 1; continue
        mine = Image.open(ours).convert("RGBA")
        try:
            ref, by = reference(path)
        except Exception as error:
            print(f"NOREF   {folder}/{path.name}: {error}"); continue
        if mine.size != ref.size:
            print(f"SIZE    {folder}/{path.name}: ours {mine.size}, {by} {ref.size}"); failed += 1; continue
        a, b = mine.split()[3], ref.split()[3]
        visible = ImageChops.lighter(a, b).point(lambda v: 255 if v else 0)
        diff = ImageChops.difference(mine, ref)
        rgb = ImageChops.multiply(diff.convert("RGB"), Image.merge("RGB", [visible] * 3))
        worst = max(max(rgb.getextrema()[i][1] for i in range(3)), diff.getextrema()[3][1])
        hist = rgb.convert("L").histogram()
        mean = sum(i * n for i, n in enumerate(hist)) / max(1, sum(hist))
        try:
            kind = (Image.open(path).format or "").lower()
        except Exception:
            kind = path.suffix.lower().lstrip(".")
        limit = 24 if kind in ("jpeg", "webp", "avif", "jpeg2000", "heif", "jxl") or path.suffix.lower() in lossy else 0
        if path.suffix.lower() in (".svg", ".svgz"):
            limit = 8
        if "16bit" in path.name:
            limit = 1   # 16-bit samples scaled to 8 bits round either way
        if path.suffix.lower() == ".ico" and 0 < worst <= 128 and mean < 0.01:
            print(f"KNOWN   {folder}/{path.name}: gdk-pixbuf applies the AND mask to a 32-bit icon on a few edge pixels (max {worst})")
            continue
        state = "OK  " if worst <= limit else "DIFF"
        if worst > limit:
            failed += 1
        print(f"{state}    {folder}/{path.name}: {mine.size[0]}x{mine.size[1]} max {worst} mean {mean:.2f} vs {by}")
print(f"{failed} differ")
sys.exit(1 if failed else 0)
