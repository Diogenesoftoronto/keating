#!/usr/bin/env python3
"""Copy the Keating runtime without accounts, generated lesson outputs or dependencies."""
from __future__ import annotations

import hashlib
import json
import os
import shutil
import tempfile
from datetime import datetime, timezone
from pathlib import Path

import typer

app = typer.Typer(add_completion=False, pretty_exceptions_enable=False)
ROOT = Path(__file__).resolve().parents[2]
TREES = ("src", "shared", "packages", "dist", "pi")
ROOT_FILES = ("SYSTEM.md", "package.json", "bun.lock", "bunfig.toml", "tsconfig.json")
DRIVER_FILES = (
    "scripts/training/benchmark_harness_v3.ts",
    "scripts/training/benchmark_harness_v3_extension.ts",
    "scripts/training/benchmark_harness_v3_limits.ts",
    "scripts/training/benchmark_harness_v3_provenance.ts",
    "scripts/training/benchmark_tui_openui.ts",
)
EXCLUDED_DIRS = {"node_modules", "__pycache__", "outputs", "coverage", "reports", "release"}
EXCLUDED_FILES = {"auth.json", "credentials.json", "secrets.json", "tokens.json", "token.json"}
MANIFEST = "runtime-snapshot.json"


def digest(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _source_files(root: Path):
    for name in ROOT_FILES + DRIVER_FILES:
        path = root / name
        if not path.is_file() or path.is_symlink():
            raise ValueError(f"Required regular runtime file missing: {name}")
        yield path
    for name in TREES:
        tree = root / name
        if not tree.is_dir() or tree.is_symlink():
            raise ValueError(f"Required runtime directory missing: {name}")
        for directory, dirs, files in os.walk(tree, followlinks=False):
            dirs[:] = sorted(d for d in dirs if not d.startswith(".")
                             and d not in EXCLUDED_DIRS and not (Path(directory) / d).is_symlink())
            for filename in sorted(files):
                path = Path(directory) / filename
                if (filename.startswith(".") or filename in EXCLUDED_FILES or path.is_symlink()
                        or filename.endswith((".pyc", ".log", ".tsbuildinfo"))):
                    continue
                if path.is_file():
                    yield path


def snapshot_runtime(output: Path, source_root: Path = ROOT) -> dict:
    """Create a new standalone source/build tree; return its manifest (not credential paths)."""
    source_root = Path(source_root).resolve()
    output = Path(output).absolute()
    if output.exists() or output.is_symlink():
        raise ValueError("Snapshot output already exists; choose a new directory")
    for tree in TREES:
        if output.is_relative_to(source_root / tree):
            raise ValueError("Snapshot output cannot be inside a copied runtime tree")
    dependency_root = (source_root / "node_modules").resolve(strict=True)
    if not dependency_root.is_dir():
        raise ValueError("Installed node_modules directory is required")
    output.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix=".keating-runtime-copy-", dir=output.parent))
    files: dict[str, str] = {}
    try:
        for source in _source_files(source_root):
            relative = source.relative_to(source_root)
            data = source.read_bytes()
            target = staging / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
            target.chmod(0o444)
            files[relative.as_posix()] = digest(data)
        # Detect concurrent edits while copying; a partial cross-revision copy is not published.
        current_names = {p.relative_to(source_root).as_posix() for p in _source_files(source_root)}
        if current_names != set(files):
            raise RuntimeError("Runtime file set changed while copying; retry after the edit settles")
        changed = [name for name, expected in files.items()
                   if digest((source_root / name).read_bytes()) != expected]
        if changed:
            raise RuntimeError(f"Runtime source changed while copying: {changed[0]}")
        (staging / "node_modules").symlink_to(dependency_root, target_is_directory=True)
        manifest = {
            "schema_version": 1,
            "kind": "keating-cli-runtime-snapshot",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "files": dict(sorted(files.items())),
            "dependency_link": {
                "path": "node_modules",
                "kind": "shared-installed-dependencies",
                "target_path_sha256": digest(str(dependency_root).encode()),
                "lockfile_sha256": files["bun.lock"],
            },
            "limitations": [
                "Keating source, built modules, prompts and skills are copied; node_modules is a symlink to the installed dependencies.",
                "Dependencies and host Bun/Node binaries are not containerized or independently installed by this helper.",
                "Each driver run fingerprints its resolved dependencies and checks them again at completion; shared dependency changes can still invalidate a run.",
                "The helper copies the existing build without rebuilding it. Source/build differences remain explicit in their separate file hashes.",
                "No credentials, .env files, .git, user sessions, nested node_modules or generated lesson outputs are copied.",
            ],
        }
        (staging / MANIFEST).write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
        (staging / MANIFEST).chmod(0o444)
        if output.exists() or output.is_symlink():
            raise ValueError("Snapshot output appeared while copying; refusing to overwrite it")
        staging.rename(output)
        return manifest
    finally:
        if staging.exists():
            shutil.rmtree(staging)


def verify_snapshot(root: Path) -> dict:
    root = Path(root).resolve()
    manifest = json.loads((root / MANIFEST).read_text())
    if manifest.get("kind") != "keating-cli-runtime-snapshot" or manifest.get("schema_version") != 1:
        raise ValueError("Unsupported runtime snapshot manifest")
    for name, expected in manifest["files"].items():
        relative = Path(name)
        if relative.is_absolute() or ".." in relative.parts:
            raise ValueError("Invalid snapshot path")
        path = root / relative
        if path.is_symlink() or not path.is_file() or digest(path.read_bytes()) != expected:
            raise ValueError(f"Runtime snapshot changed: {name}")
    link = root / "node_modules"
    if not link.is_symlink() or digest(str(link.resolve(strict=True)).encode()) != manifest["dependency_link"]["target_path_sha256"]:
        raise ValueError("Snapshot dependency link changed")
    return manifest


@app.command()
def create(output: Path, source_root: Path = ROOT):
    manifest = snapshot_runtime(output, source_root)
    print(json.dumps({"status": "created", "files": len(manifest["files"]),
                      "manifest_sha256": digest((output / MANIFEST).read_bytes())}))


@app.command()
def verify(root: Path):
    manifest = verify_snapshot(root)
    print(json.dumps({"status": "verified", "files": len(manifest["files"])}))


if __name__ == "__main__":
    app()
