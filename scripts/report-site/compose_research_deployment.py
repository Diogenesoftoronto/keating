"""Compose verified original and companion report snapshots; no deploy or network."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def verified_files(root, manifest):
    for name, expected in manifest["files"].items():
        path = root / name
        if not path.resolve().is_relative_to(root.resolve()) or path.is_symlink():
            raise ValueError(f"Unsafe snapshot path: {name}")
        if sha(path) != expected:
            raise ValueError(f"Snapshot changed: {name}")
        yield name, path


def composeResearchDeployment(original, companion, output, live_index=None):
    old = json.loads((original / "snapshot.json").read_text())
    new = json.loads((companion / "snapshot.json").read_text())
    old_files = list(verified_files(original, old))
    new_files = list(verified_files(companion, new))
    if live_index and sha(live_index) != old["files"]["public/index.html"]:
        raise ValueError("Live original differs from the selected original snapshot")
    output.mkdir(parents=True, exist_ok=False)
    for name, source in old_files:
        dest = output / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, dest)
    story = output / "public/learning-from-next-turn"
    story.mkdir()
    for name, source in new_files:
        shutil.copyfile(source, story / name)
    shutil.copyfile(companion / "snapshot.json", story / "snapshot.json")
    shutil.copyfile(companion.with_suffix('.zip'), output / "public/learning-from-next-turn.zip")
    index = output / "public/index.html"
    old_link = '<a href="#benchmark-v3" class="nav-link">Latest experiment <span aria-hidden="true">↘</span></a>'
    new_link = '<a href="/learning-from-next-turn/" class="nav-link">New research report <span aria-hidden="true">↗</span></a>'
    original_html = index.read_text()
    if original_html.count(old_link) != 1:
        raise ValueError("Original navigation changed")
    index.write_text(original_html.replace(old_link, new_link))
    # All original experiment data/styles/scripts remain byte-identical.
    preserved = [name for name, _ in old_files if name != "public/index.html"]
    assert all(sha(output / name) == old["files"][name] for name in preserved)
    manifest = {"reports": ["Learning to teach", "Learning from the next turn"],
                "original_snapshot_sha256": sha(original / "snapshot.json"),
                "companion_snapshot_sha256": sha(companion / "snapshot.json"),
                "original_change": "One header navigation link points to the companion; all other original files preserved.",
                "files": {str(p.relative_to(output)): sha(p) for p in sorted(output.rglob('*')) if p.is_file()}}
    (output / "snapshot.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(json.dumps({"output": str(output), "files": len(manifest["files"]), "original_assets_preserved": len(preserved)}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--original', type=Path, required=True)
    parser.add_argument('--companion', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--live-index', type=Path)
    args = parser.parse_args()
    composeResearchDeployment(args.original, args.companion, args.output, args.live_index)
