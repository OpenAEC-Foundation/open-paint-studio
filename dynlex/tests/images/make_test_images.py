#!/usr/bin/env python3
"""Writes the image-format test set into dynlex/build/images.

Every variant is drawn from one 97 x 61 test card (gradients, transparency,
sharp edges) and written by Pillow, gdk-pixbuf or hand-built headers, so the
set covers bit depths, palettes, alpha, interlacing, compression and EXIF
orientation. Real files from /usr/share are copied into system/. Nothing
here is committed; run it again to rebuild the set.

    python3 dynlex/tests/images/make_test_images.py
"""
import gzip, os, shutil, struct, subprocess, sys
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[2] / "build" / "images"
out = root / "generated"
shutil.rmtree(root, ignore_errors=True)
out.mkdir(parents=True)

def card(size=(97, 61)):
    w, h = size
    im = Image.new("RGBA", size)
    px = im.load()
    for y in range(h):
        for x in range(w):
            a = 255 if x < w * 2 // 3 else int(255 * (h - 1 - y) / (h - 1))
            px[x, y] = (x * 255 // (w - 1), y * 255 // (h - 1), (x + y) * 255 // (w + h - 2), a)
    d = ImageDraw.Draw(im)
    d.rectangle([4, 4, 20, 20], fill=(220, 38, 38, 255))
    d.ellipse([26, 6, 50, 30], fill=(37, 99, 235, 255))
    d.line([0, h - 1, w // 2, 0], fill=(0, 0, 0, 255), width=2)
    return im

rgba = card()
rgb = Image.alpha_composite(Image.new("RGBA", rgba.size, (255, 255, 255, 255)), rgba).convert("RGB")
gray = rgb.convert("L")
made = []

def save(name, im, **kw):
    im.save(out / name, **kw)
    made.append(name)

# PNG: every colour type, 16 bits, interlaced, palette with transparency.
save("png-rgba.png", rgba)
save("png-rgb.png", rgb)
save("png-gray.png", gray)
save("png-gray-alpha.png", rgba.convert("LA"))
save("png-palette.png", rgb.quantize(64))
pal = rgba.convert("RGBA").quantize(32, method=Image.Quantize.FASTOCTREE)
save("png-palette-trns.png", pal, transparency=0)
save("png-interlaced.png", rgba, interlace=1)
save("png-16bit-gray.png", gray.convert("I;16"))
save("png-1bit.png", gray.convert("1"))
# BMP: 1, 4 (via palette), 8, 24 bits, RLE8 below, and 32 with alpha.
save("bmp-24.bmp", rgb)
save("bmp-8-palette.bmp", rgb.quantize(200))
save("bmp-1.bmp", gray.convert("1"))
save("bmp-32-alpha.bmp", rgba)
save("bmp-gray.bmp", gray)
# JPEG: baseline, progressive, grayscale, 4:4:4, CMYK, EXIF rotated.
save("jpeg-baseline.jpg", rgb, quality=92)
save("jpeg-progressive.jpg", rgb, quality=92, progressive=True)
save("jpeg-gray.jpg", gray, quality=92)
save("jpeg-444.jpg", rgb, quality=95, subsampling=0)
save("jpeg-cmyk.jpg", rgb.convert("CMYK"), quality=92)
exif = Image.Exif(); exif[0x0112] = 6   # Orientation: rotate 90 clockwise
save("jpeg-exif-rotated.jpg", rgb, quality=92, exif=exif)
save("jpeg-uppercase.JPG", rgb, quality=92)
# GIF: static, transparent, animated (first frame shows).
save("gif-static.gif", rgb.quantize(128))
save("gif-transparent.gif", pal, transparency=0)
frames = [rgb.quantize(64), rgb.rotate(180).quantize(64)]
frames[0].save(out / "gif-animated.gif", save_all=True, append_images=frames[1:], duration=200, loop=0); made.append("gif-animated.gif")
# TIFF: uncompressed, LZW, deflate, alpha, 16-bit, gray.
save("tiff-raw.tif", rgb)
save("tiff-lzw.tiff", rgb, compression="tiff_lzw")
save("tiff-deflate.tif", rgba, compression="tiff_adobe_deflate")
save("tiff-gray.tif", gray)
save("tiff-16bit.tif", gray.convert("I;16"))
# WebP: lossy, lossless, alpha.
save("webp-lossy.webp", rgb, quality=90)
save("webp-lossless.webp", rgba, lossless=True)
save("webp-alpha-lossy.webp", rgba, quality=90)
# PNM: every kind, ASCII and binary, 16-bit.
save("pnm-p6.ppm", rgb)
save("pnm-p5.pgm", gray)
save("pnm-p4.pbm", gray.convert("1"))
def ascii_pnm(name, magic, im, maxval=255):
    w, h = im.size
    data = list(im.get_flattened_data()) if hasattr(im, "get_flattened_data") else list(im.getdata())
    body = " ".join(str(v) for p in data for v in (p if isinstance(p, tuple) else (p,)))
    (out / name).write_text(f"{magic}\n# test card\n{w} {h}\n" + ("" if magic == "P1" else f"{maxval}\n") + body + "\n")
    made.append(name)
ascii_pnm("pnm-p3.ppm", "P3", rgb)
ascii_pnm("pnm-p2.pgm", "P2", gray)
ascii_pnm("pnm-p1.pbm", "P1", gray.point(lambda v: 0 if v > 127 else 1))
w, h = rgb.size
(out / "pnm-p6-16bit.ppm").write_bytes(f"P6\n{w} {h}\n65535\n".encode() + b"".join(struct.pack(">HHH", r * 257, g * 257, b * 257) for r, g, b in (rgb.get_flattened_data() if hasattr(rgb, "get_flattened_data") else rgb.getdata()))); made.append("pnm-p6-16bit.ppm")
# Other raster formats Pillow writes.
save("tga-rgba.tga", rgba)
save("tga-rle.tga", rgb, compression="tga_rle")
save("ico-multi.ico", rgba.resize((64, 64)), sizes=[(16, 16), (32, 32), (64, 64)])
save("qoi-rgba.qoi", rgba)
save("jp2-rgb.jp2", rgb)
save("xbm-mono.xbm", gray.convert("1"))
save("dds-rgba.dds", rgba)
# Through gdk-pixbuf's savers: AVIF and JPEG XL.
try:
    import gi
    gi.require_version("GdkPixbuf", "2.0")
    from gi.repository import GdkPixbuf
    buf = GdkPixbuf.Pixbuf.new_from_file(str(out / "png-rgba.png"))
    for kind, name in (("avif", "avif-rgba.avif"), ("jxl", "jxl-rgba.jxl")):
        try:
            buf.savev(str(out / name), kind, [], []); made.append(name)
        except Exception as error:
            print("skip", name, error)
except Exception as error:
    print("skip gdk-pixbuf savers", error)
# Vector: SVG and gzipped SVGZ.
svg = f"""<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}"><rect width="{w}" height="{h}" fill="#f3f4f6"/><rect x="4" y="4" width="17" height="17" fill="#dc2626"/><circle cx="38" cy="18" r="12" fill="#2563eb"/><text x="8" y="52" font-size="14" fill="#111">SVG</text></svg>"""
(out / "svg-card.svg").write_text(svg); made.append("svg-card.svg")
(out / "svgz-card.svgz").write_bytes(gzip.compress(svg.encode())); made.append("svgz-card.svgz")
# XPM by hand: a 4-colour 8 x 6 image.
(out / "xpm-small.xpm").write_text('/* XPM */\nstatic char *card[] = {\n"8 6 4 1",\n"  c None",\n". c #DC2626",\n"+ c #2563EB",\n"@ c #000000",\n"..++..@@",\n"..++..@@",\n"++..++  ",\n"++..++  ",\n"@@  ..++",\n"@@  ..++"};\n'); made.append("xpm-small.xpm")
# Files that must fail cleanly.
bad = root / "broken"; bad.mkdir()
(bad / "empty.png").write_bytes(b"")
(bad / "truncated.png").write_bytes((out / "png-rgba.png").read_bytes()[:200])
(bad / "truncated.jpg").write_bytes((out / "jpeg-baseline.jpg").read_bytes()[:300])
(bad / "garbage.bmp").write_bytes(b"BM" + os.urandom(64))
(bad / "text.webp").write_text("not an image at all\n")
# Right content, wrong extension.
shutil.copy(out / "png-rgba.png", out / "misnamed-png.jpg"); made.append("misnamed-png.jpg")
shutil.copy(out / "jpeg-baseline.jpg", out / "misnamed-jpeg.png"); made.append("misnamed-jpeg.png")

# Real files from the system, at most three per extension.
system = root / "system"; system.mkdir()
seen = {}
for base in ("/usr/share/backgrounds", "/usr/share/pixmaps", "/usr/share/icons", "/usr/share/doc", "/usr/share/help", "/usr/share/gnome-shell", "/usr/share/themes", "/usr/share/plymouth", "/usr/share/wallpapers", "/usr/share/sounds", "/usr/share/games", "/usr/lib/firefox", "/usr/share"):
    for path in sorted(Path(base).rglob("*")) if os.path.isdir(base) else []:
        ext = path.suffix.lower().lstrip(".")
        if ext not in {"jpg", "jpeg", "png", "gif", "webp", "svg", "ico", "bmp", "xpm", "xbm", "tif", "tiff", "tga", "avif", "jxl"}:
            continue
        if seen.get(ext, 0) >= 3 or not path.is_file() or path.stat().st_size > 30_000_000:
            continue
        seen[ext] = seen.get(ext, 0) + 1
        shutil.copy(path, system / f"{ext}-{seen[ext]}-{path.name}")
    if all(seen.get(e, 0) >= 3 for e in ("jpg", "png", "gif", "svg")):
        pass
print(f"{len(made)} generated, {len(list(system.iterdir()))} from the system, {len(list(bad.iterdir()))} broken, in {root}")
