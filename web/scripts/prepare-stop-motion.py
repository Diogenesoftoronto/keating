#!/usr/bin/env python3
"""Prepare approved Keatingbot frames with ImageMagick (no Python image editing).

Raw generated PNGs remain untouched. Background removal and cropping are authorized. Inspect the prepared PNGs before
accepting the resulting AVIFs; --head-crop allows a consistent crop adjustment.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

WEB = Path(__file__).resolve().parents[1]
STATES = ("idle", "listening", "thinking", "speaking", "success", "waving", "walking", "sitting", "flipping", "reading", "music", "science", "maths", "coding", "chemistry", "biology", "physics", "astronomy", "palaeontology", "electronics", "mycology", "loading", "lotus", "connecting", "understanding")
CELL_SIZE = 256


def magick(*args: object) -> str:
    result = subprocess.run(
        ["rtk", "proxy", "magick", *(str(arg) for arg in args)],
        check=True, capture_output=True, text=True,
    )
    return result.stdout.strip()


def dimensions(path: Path) -> tuple[int, int]:
    width, height = magick("identify", "-format", "%w %h", path).split()
    return int(width), int(height)


def check_atlas(path: Path) -> dict[str, object]:
    size = dimensions(path)
    if size != (CELL_SIZE * 4, CELL_SIZE * 2):
        raise ValueError(f"{path}: expected 1024x512, got {size}")
    channels = magick("identify", "-format", "%[channels]", path)
    opaque = magick("identify", "-format", "%[opaque]", path).lower()
    if "a" not in channels.lower() or opaque != "false":
        raise ValueError(f"{path}: missing real transparent pixels ({channels}, opaque={opaque})")
    return {"path": str(path.relative_to(WEB)), "width": size[0], "height": size[1],
            "bytes": path.stat().st_size, "channels": channels, "transparent": True}


def prepare(state: str, raw_dir: Path, prepared_dir: Path, output_dir: Path,
            head_crop: tuple[float, float, float, float], quality: int) -> dict[str, object]:
    source = raw_dir / f"{state}.png"
    width, height = dimensions(source)
    if width < 8 or height < 4 or abs(width / height - 2) > 0.02:
        raise ValueError(f"{source}: expected a four-column/two-row atlas near 2:1, got {width}x{height}")
    with tempfile.TemporaryDirectory(prefix=f"keating-stop-motion-{state}-") as tmp:
        temporary = Path(tmp)
        keyed = temporary / "keyed.png"
        # Key by magenta hue rather than exact RGB: generated backgrounds vary
        # slightly in brightness. Contract the alpha edge by one source pixel
        # before downsampling, preventing a magenta/green fringe without changing
        # the robot's RGB colors. Antialiasing is rebuilt by the later resize.
        if magick("identify", "-format", "%[opaque]", source).lower() == "false":
            # Preserve model-provided transparency, contracting only edge noise.
            magick(source, "-channel", "A", "-morphology", "Erode", "Diamond:1",
                   "+channel", "-depth", 8, keyed)
        else:
            magick(source, "-colorspace", "sRGB", "-alpha", "set", "-channel", "A",
                   "-fx", "min(r,b)>g+0.035&&min(r,b)>max(r,b)*0.5?0:1",
                   "-morphology", "Erode", "Diamond:1", "+channel", "-depth", 8, keyed)
        cells: dict[str, list[Path]] = {"body": [], "head": []}
        for frame in range(8):
            column, row = frame % 4, frame // 4
            x0, x1 = round(column * width / 4), round((column + 1) * width / 4)
            y0, y1 = round(row * height / 2), round((row + 1) * height / 2)
            cell_width, cell_height = x1 - x0, y1 - y0
            cell = temporary / f"cell-{frame}.png"
            magick(keyed, "-crop", f"{cell_width}x{cell_height}+{x0}+{y0}", "+repage", cell)
            if state == "connecting":
                # The corrected peg/socket sheet has thin white cell dividers.
                # Remove only its outer six pixels, preserving the cell canvas.
                magick(cell, "-shave", "6x6", "+repage", "-background", "none",
                       "-gravity", "center", "-extent", f"{cell_width}x{cell_height}", cell)
            body = temporary / f"body-{frame}.png"
            # Keep the whole original cell, so pose motion is never recentered.
            magick(cell, "-resize", "256x256", "-background", "none", "-gravity", "center",
                   "-extent", "256x256", body)
            left, top, right, bottom = head_crop
            hx0, hx1 = round(left * cell_width), round(right * cell_width)
            hy0, hy1 = round(top * cell_height), round(bottom * cell_height)
            head = temporary / f"head-{frame}.png"
            cropped_head = temporary / f"head-crop-{frame}.png"
            hw, hh = hx1-hx0, hy1-hy0
            magick(cell, "-crop", f"{hw}x{hh}+{hx0}+{hy0}", "+repage", cropped_head)
            # Inspect row occupancy to stop at the narrow neck, removing small
            # detached torso slivers. Keep the original crop canvas so this does
            # not resize/recenter the head differently between animation poses.
            profile = subprocess.check_output(["rtk", "proxy", "magick", str(cropped_head),
                "-alpha", "extract", "-threshold", "30%", "-scale", f"1x{hh}!", "-depth", "8", "gray:-"])
            peak = max(profile)
            peak_row = max(i for i, value in enumerate(profile) if value >= peak * 0.9)
            cut = next((i for i in range(peak_row + 1, hh) if profile[i] < peak * 0.25), hh)
            magick(cropped_head, "-crop", f"{hw}x{max(1, cut)}+0+0", "+repage",
                   "-background", "none", "-gravity", "northwest", "-extent", f"{hw}x{hh}",
                   "-resize", "224x224", "-gravity", "center", "-extent", "256x256", head)
            cells["body"].append(body)
            cells["head"].append(head)
        variants = {}
        for variant, frames in cells.items():
            if len(frames) != 8 or any(dimensions(frame) != (256, 256) for frame in frames):
                raise ValueError(f"{state}/{variant}: expected eight 256-square frames")
            rows = []
            for row in range(2):
                row_path = temporary / f"{variant}-row-{row}.png"
                magick(*frames[row * 4:(row + 1) * 4], "+append", row_path)
                rows.append(row_path)
            atlas = prepared_dir / f"keatingbot-{variant}-{state}.png"
            magick(*rows, "-append", "-depth", 8, atlas)
            source_report = check_atlas(atlas)
            target = output_dir / f"keatingbot-{variant}-{state}.avif"
            magick(atlas, "-strip", "-depth", 8, "-define", "heic:chroma=444",
                   "-quality", quality, target)
            variants[variant] = {"frames": 8, "source": source_report, "production": check_atlas(target)}
        return {"state": state, "raw": str(source), "raw_dimensions": [width, height], "variants": variants}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--states", nargs="+", choices=STATES, default=list(STATES))
    parser.add_argument("--raw-dir", type=Path, default=WEB / "artwork/stop-motion-v1/raw")
    parser.add_argument("--prepared-dir", type=Path, default=WEB / "artwork/stop-motion-v1/prepared")
    parser.add_argument("--output-dir", type=Path, default=WEB / "public/brand/stop-motion-v1")
    parser.add_argument("--head-crop", nargs=4, type=float, metavar=("LEFT", "TOP", "RIGHT", "BOTTOM"),
                        default=(0.16, 0.01, 0.84, 0.47), help="Fixed fractional head crop for every pose")
    parser.add_argument("--quality", type=int, default=75)
    args = parser.parse_args()
    if not shutil.which("magick"):
        parser.error("ImageMagick 7 (magick) is required")
    left, top, right, bottom = args.head_crop
    if not (0 <= left < right <= 1 and 0 <= top < bottom <= 1):
        parser.error("--head-crop must describe a rectangle inside [0,1]")
    if not 1 <= args.quality <= 100:
        parser.error("--quality must be between 1 and 100")
    missing = [str(args.raw_dir / f"{state}.png") for state in args.states
               if not (args.raw_dir / f"{state}.png").is_file()]
    if missing:
        parser.error("Missing raw sources: " + ", ".join(missing))
    args.prepared_dir.mkdir(parents=True, exist_ok=True)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    report = {"layout": {"columns": 4, "rows": 2, "cell": CELL_SIZE},
              "head_crop": args.head_crop, "avif_quality": args.quality, "avif_chroma": "444", "states": []}
    for state in args.states:
        item = prepare(state, args.raw_dir, args.prepared_dir, args.output_dir, tuple(args.head_crop), args.quality)
        report["states"].append(item)
        print(json.dumps(item), flush=True)
    report_path = args.prepared_dir / "report.json"
    if report_path.exists():
        prior = json.loads(report_path.read_text())
        merged = {item["state"]: item for item in prior.get("states", [])}
        merged.update({item["state"]: item for item in report["states"]})
        report["states"] = [merged[state] for state in STATES if state in merged]
    report_path.write_text(json.dumps(report, indent=2) + "\n")
    print(f"Report: {report_path}")


if __name__ == "__main__":
    main()
