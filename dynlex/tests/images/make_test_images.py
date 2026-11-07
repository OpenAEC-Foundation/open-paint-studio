#!/usr/bin/env python3
"""Writes the image-format test set into dynlex/build/images.

Every variant is drawn from one 97 x 61 test card (gradients, transparency,
sharp edges) and written by Pillow, gdk-pixbuf or hand-built headers, so the
set covers bit depths, palettes, alpha, interlacing, compression and EXIF
orientation. Real files from /usr/share are copied into system/. Nothing
here is committed; run it again to rebuild the set.

    python3 dynlex/tests/images/make_test_images.py
"""
import gzip, os, shutil, struct, subprocess, sys, zlib
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
# Pillow writes no Adam7 (it ignores interlace=1), so the passes are
# written here: eight-bit RGBA, filter type 0 rows.
def adam7_png(name, im):
    w, h = im.size
    data = im.tobytes()
    raw = bytearray()
    for x0, y0, dx, dy in ((0, 0, 8, 8), (4, 0, 8, 8), (0, 4, 4, 8), (2, 0, 4, 4), (0, 2, 2, 4), (1, 0, 2, 2), (0, 1, 1, 2)):
        if x0 >= w:
            continue
        for y in range(y0, h, dy):
            row = data[y * w * 4:(y + 1) * w * 4]
            raw.append(0)
            for x in range(x0, w, dx):
                raw += row[x * 4:x * 4 + 4]
    chunk = lambda kind, body: struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body))
    (out / name).write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 1))
                             + chunk(b"IDAT", zlib.compress(bytes(raw), 6)) + chunk(b"IEND", b""))
    made.append(name)
adam7_png("png-interlaced.png", rgba)
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
save("jp2-lossy.jp2", rgb, quality_mode="rates", quality_layers=[20], irreversible=True)
save("jp2-rgba-tiled.jp2", rgba, tile_size=(32, 32), progression="RPCL")
save("j2k-gray.j2k", gray)
save("xbm-mono.xbm", gray.convert("1"))
save("dds-rgba.dds", rgba)
save("dds-dxt1.dds", rgb, pixel_format="DXT1")
save("dds-dxt3.dds", rgba, pixel_format="DXT3")
save("dds-dxt5.dds", rgba, pixel_format="DXT5")
save("dds-bc3-dx10.dds", rgba, pixel_format="BC3")
# Blocks of random bits reach every block mode and BC7 partition; Pillow's
# decoder is the reference.
def dds_blocks(name, fourcc, block_bytes, dxgi=None, size=64):
    import os, random, struct
    random.seed(name)
    blocks = bytes(random.getrandbits(8) for _ in range((size // 4) ** 2 * block_bytes))
    header = b"DDS " + struct.pack("<7I", 124, 0x81007, size, size, len(blocks), 0, 1) + b"\0" * 44
    header += struct.pack("<2I", 32, 4) + fourcc + b"\0" * 20 + struct.pack("<4I", 0x1000, 0, 0, 0) + b"\0" * 4
    if dxgi is not None:
        header += struct.pack("<5I", dxgi, 3, 0, 1, 0)
    (out / name).write_bytes(header + blocks)
    made.append(name)
dds_blocks("dds-bc1-random.dds", b"DXT1", 8)
dds_blocks("dds-bc4-random.dds", b"ATI1", 8)
dds_blocks("dds-bc5-random.dds", b"ATI2", 16)
dds_blocks("dds-bc7-random.dds", b"DX10", 16, dxgi=98)
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
# AVIF through ffmpeg's AV1 encoder: lossless 4:4:4, 10-bit 4:2:0 and grey.
for name, args in (("avif-444-lossless.avif", ["-pix_fmt", "yuv444p", "-crf", "0"]),
                   ("avif-10bit.avif", ["-pix_fmt", "yuv420p10le", "-crf", "30"]),
                   ("avif-gray.avif", ["-pix_fmt", "gray", "-crf", "20"])):
    try:
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(out / "png-rgb.png"), "-c:v", "libaom-av1",
                        "-still-picture", "1", *args, str(out / name)], check=True)
        made.append(name)
    except Exception as error:
        print("skip", name, error)
# AVIF containers ffmpeg does not write: a 2 x 2 grid whose last tiles
# overhang, a quarter turn (irot), a mirror (imir) and a grid with both. The
# tiles are 4:4:4 AV1 from ffmpeg (OBU streams); the HEIF boxes are built
# here.
def heif_box(kind, body):
    return struct.pack(">I", 8 + len(body)) + kind + body
def heif_full(kind, version, flags, body):
    return heif_box(kind, bytes([version]) + flags.to_bytes(3, "big") + body)
def av1_tile(im, scratch):
    im.save(scratch / "tile.png")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(scratch / "tile.png"), "-c:v", "libaom-av1", "-still-picture", "1",
                    "-pix_fmt", "yuv444p", "-crf", "20", "-f", "obu", str(scratch / "tile.obu")], check=True)
    return (scratch / "tile.obu").read_bytes()
def heif_avif(name, tiles, columns, rows, size, transforms, scratch):
    grid = len(tiles) > 1
    datas = [av1_tile(t, scratch) for t in tiles]
    ids = list(range(2, 2 + len(tiles))) if grid else [1]
    infe = [heif_full(b"infe", 2, 0, struct.pack(">HH", 1, 0) + b"grid\0")] if grid else []
    infe += [heif_full(b"infe", 2, 1 if grid else 0, struct.pack(">HH", i, 0) + b"av01\0") for i in ids]
    iinf = heif_full(b"iinf", 0, 0, struct.pack(">H", len(infe)) + b"".join(infe))
    description = bytes([0, 0, rows - 1, columns - 1]) + struct.pack(">HH", *size)
    # Properties: 1 tile ispe, 2 av1C (profile 1: 4:4:4), 3 colr, then the
    # grid's ispe and the transforms.
    props = [heif_box(b"ispe", bytes(4) + struct.pack(">II", *tiles[0].size)), heif_box(b"av1C", bytes([0x81, 0x3F, 0, 0])),
             heif_box(b"colr", b"nclx" + struct.pack(">HHHB", 1, 13, 6, 0))]
    if grid:
        props.append(heif_box(b"ispe", bytes(4) + struct.pack(">II", *size)))
    first = len(props) + 1
    props += [heif_box(kind, bytes([value])) for kind, value in transforms]
    moves = [0x80 | (first + k) for k in range(len(transforms))]
    entries = [struct.pack(">HB", i, 3 + (0 if grid else len(moves))) + bytes([1, 0x82, 3] + ([] if grid else moves)) for i in ids]
    if grid:
        entries.append(struct.pack(">HB", 1, 2 + len(moves)) + bytes([4, 3] + moves))
    iprp = heif_box(b"iprp", heif_box(b"ipco", b"".join(props)) + heif_full(b"ipma", 0, 0, struct.pack(">I", len(entries)) + b"".join(entries)))
    iref = heif_full(b"iref", 0, 0, heif_box(b"dimg", struct.pack(">HH", 1, len(ids)) + b"".join(struct.pack(">H", i) for i in ids))) if grid else b""
    head = heif_full(b"hdlr", 0, 0, bytes(4) + b"pict" + bytes(13)) + heif_full(b"pitm", 0, 0, struct.pack(">H", 1))
    def assemble(offsets):
        # iloc version 1: the grid description in idat (construction method 1).
        items = [struct.pack(">HHHHII", 1, 1, 0, 1, 0, len(description))] if grid else []
        items += [struct.pack(">HHHHII", i, 0, 0, 1, at, len(d)) for i, at, d in zip(ids, offsets, datas)]
        iloc = heif_full(b"iloc", 1, 0, bytes([0x44, 0]) + struct.pack(">H", len(items)) + b"".join(items))
        idat = heif_box(b"idat", description) if grid else b""
        return heif_box(b"ftyp", b"avif" + bytes(4) + b"mif1avifmiaf") + heif_full(b"meta", 0, 0, head + iloc + iinf + iref + iprp + idat)
    at = len(assemble([0] * len(datas))) + 8
    offsets = []
    for d in datas:
        offsets.append(at); at += len(d)
    (out / name).write_bytes(assemble(offsets) + heif_box(b"mdat", b"".join(datas)))
    made.append(name)
try:
    import tempfile
    with tempfile.TemporaryDirectory() as folder:
        scratch = Path(folder)
        w, h = rgb.size
        tw, th = (w + 1) // 2 + 2, (h + 1) // 2 + 2
        padded = Image.new("RGB", (tw * 2, th * 2)); padded.paste(rgb)
        quarters = [padded.crop((c * tw, r * th, c * tw + tw, r * th + th)) for r in range(2) for c in range(2)]
        heif_avif("avif-grid.avif", quarters, 2, 2, (w, h), [], scratch)
        heif_avif("avif-irot.avif", [rgb], 1, 1, (w, h), [(b"irot", 1)], scratch)
        heif_avif("avif-imir.avif", [rgb], 1, 1, (w, h), [(b"imir", 1)], scratch)
        heif_avif("avif-grid-irot-imir.avif", quarters, 2, 2, (w, h), [(b"irot", 3), (b"imir", 0)], scratch)
except Exception as error:
    print("skip AVIF grid and transforms", error)
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
