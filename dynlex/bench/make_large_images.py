#!/usr/bin/env python3
"""Writes very large test images into dynlex/build/images/large: a real 4K
photograph (Ubuntu's wallpaper, or any image given as the argument) scaled
up to 8K, 16K and 16384 x 16384 (268 megapixels), as JPEG and, up to 8K, PNG.

    python3 dynlex/bench/make_large_images.py [SOURCE.jpg]
"""
import sys, glob
from pathlib import Path
from PIL import Image

Image.MAX_IMAGE_PIXELS = None
out = Path(__file__).resolve().parents[1] / "build" / "images" / "large"
out.mkdir(parents=True, exist_ok=True)
source = sys.argv[1] if len(sys.argv) > 1 else (sorted(glob.glob("/usr/share/backgrounds/*.jpg")) or sorted(glob.glob("/usr/share/backgrounds/*.png")))[0]
photo = Image.open(source).convert("RGB")
print("source", source, photo.size)
for name, size, kinds in (("4k", (3840, 2160), ("jpg", "png")), ("8k", (7680, 4320), ("jpg", "png")),
                          ("16k", (15360, 8640), ("jpg",)), ("268mp", (16384, 16384), ("jpg",))):
    scaled = photo.resize(size, Image.Resampling.BICUBIC)
    for kind in kinds:
        path = out / f"{name}.{kind}"
        if kind == "jpg":
            scaled.save(path, quality=90)
        else:
            scaled.save(path, compress_level=6)
        print(path.name, size, f"{size[0] * size[1] / 1e6:.1f} MP", f"{path.stat().st_size / 1e6:.1f} MB", flush=True)
