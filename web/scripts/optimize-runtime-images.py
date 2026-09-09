#!/usr/bin/env python3
"""Generate verified AVIF runtime images; keep PNG masters.

The navigation/footer/chat lockup is resized to 128px high (2x its largest
64px display). Artwork preserves original dimensions with quality 75; tutorial screenshots
use quality 80. Full chroma resolution and checked color/alpha error bounds
protect text and transparent edges. The compact logo remains lossless.

Run: rtk proxy python3 web/scripts/optimize-runtime-images.py
Requires ImageMagick with AVIF support. The manifest includes active static image
references plus all dynamic KeatingBot and AppStatusScreen variants. It excludes
unreferenced masters, individual sprite frames, posters, and platform/OG icons.
"""
import hashlib
import math
import json
import subprocess
import tempfile
from pathlib import Path

WEB = Path(__file__).resolve().parents[1]
PUBLIC = WEB / "public"
ASSETS = json.loads(Path(__file__).with_name("runtime-image-assets.json").read_text())


def magick(*args):
    return subprocess.check_output(["rtk", "proxy", "magick", *map(str, args)])


def rgba(path):
    return magick(path, "-alpha", "on", "-depth", "8", "rgba:-")


def pixels(path):
    # Explicit RGBA includes invisible RGB and alpha, rather than comparing only
    # the composited appearance of transparent pixels.
    return hashlib.sha256(magick(path, "-alpha", "on", "-depth", "8", "rgba:-")).hexdigest()


def dimensions(path):
    return magick("identify", "-format", "%w %h", path).decode()


results = []
for asset in ASSETS:
    original = PUBLIC / asset
    compact = asset == "brand/logo-lockup-hd.png"
    target = original.with_name("logo-lockup-compact.avif") if compact else original.with_suffix(".avif")
    if int(magick("identify", "-format", "%z", original)) > 8:
        raise RuntimeError(f"AVIF cannot preserve this source bit depth: {asset}")
    with tempfile.TemporaryDirectory(prefix="keating-avif-") as directory:
        candidate = Path(directory) / target.name
        source = original
        if compact:
            source = Path(directory) / "resized.png"
            magick(original, "-resize", "x128", source)
        source_rgba = rgba(source)
        quality = 100 if compact else 80 if asset.startswith("tutorial/") else 75
        magick(source, "-define", "heic:chroma=444", "-define", "heic:cicp=1/13/0/1",
               "-quality", str(quality), candidate)
        if dimensions(source) != dimensions(candidate):
            raise RuntimeError(f"Dimensions changed: {asset}")
        output_rgba = rgba(candidate)
        if quality == 100 and source_rgba != output_rgba:
            raise RuntimeError(f"Decoded RGBA pixels changed: {asset}")
        error = math.sqrt(sum((a-b)**2 for a,b in zip(source_rgba, output_rgba))/len(source_rgba))/255
        alpha_error = math.sqrt(sum((a-b)**2 for a,b in zip(source_rgba[3::4], output_rgba[3::4]))/(len(source_rgba)/4))/255
        if alpha_error > 0.005:
            raise RuntimeError(f"Alpha error exceeds 0.5% RMSE: {asset}: {alpha_error}")
        if error > 0.01:
            raise RuntimeError(f"Image error exceeds 1% RMSE: {asset}: {error}")
        before, after = original.stat().st_size, candidate.stat().st_size
        target.write_bytes(candidate.read_bytes())
        results.append({"source": asset, "output": target.relative_to(PUBLIC).as_posix(),
                        "pngBytes": before, "avifBytes": after, "dimensions": dimensions(candidate),
                        "resizedFrom": dimensions(original) if compact else None,
                        "quality": quality, "rgbaRmse": error, "alphaRmse": alpha_error, "rgbaSha256": hashlib.sha256(output_rgba).hexdigest()})
        print(f"{asset}: {before:,} -> {after:,} bytes", flush=True)

before = sum(row["pngBytes"] for row in results)
after = sum(row["avifBytes"] for row in results)
print(f"TOTAL: {len(results)} images, {before:,} -> {after:,} bytes ({(1-after/before)*100:.1f}% smaller)")
Path(__file__).with_name("runtime-image-report.json").write_text(json.dumps(results, indent=2) + "\n")
