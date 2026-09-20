#!/usr/bin/env python3
"""Fetch bounded publisher-hosted human records, without labels-based selection.

Raw data stays outside Git. This is acquisition only, never application activation.
EdNet: complete learner members from a fixed ZIP prefix. FSRS: complete histories
from the first 24 distinct publisher files under 10 MiB, ordered by path.
"""
import hashlib
import io
import json
from pathlib import Path
import struct
import sys
import urllib.request
import zipfile
import zlib

FSRS_REVISION = "ae96575728d364265a75f2447fe7b7fa389ba96c"
FSRS_REPO = "open-spaced-repetition/fsrs-dataset"
EDNET_KT1 = "https://drive.usercontent.google.com/download?id=1AmGcOs5U31wIIqvthn9ARqJMrMTFTcaw&export=download&confirm=t"
EDNET_CONTENT = "https://drive.usercontent.google.com/download?id=117aYJAWG3GU48suS66NPaB82HwFj6xWS&export=download&confirm=t"
PREFIX_BYTES = 16 * 1024 * 1024


def sha(data):
    return hashlib.sha256(data).hexdigest()


def fetch(url, maximum, headers=None):
    request = urllib.request.Request(url, headers=headers or {})
    with urllib.request.urlopen(request, timeout=60) as response:
        data = response.read(maximum + 1)
        if len(data) > maximum:
            raise ValueError("Publisher file exceeded the declared acquisition budget")
        if headers and "Range" in headers and response.status != 206:
            raise ValueError("Publisher did not honor the bounded archive range")
        return data


def save(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if path.read_bytes() != data:
            raise ValueError("Refusing to overwrite different source bytes")
    else:
        path.write_bytes(data)


def fetch_decision_policy_data(directory):
    root = Path(directory)
    root.mkdir(parents=True, exist_ok=True)
    records = []
    prefix_path = root / "ednet-kt1-prefix.zip.part"
    prefix = prefix_path.read_bytes() if prefix_path.exists() else fetch(
        EDNET_KT1 + "&keating_range=16m", PREFIX_BYTES, {"Range": f"bytes=0-{PREFIX_BYTES - 1}"})
    if len(prefix) != PREFIX_BYTES or prefix[:4] != b"PK\x03\x04":
        raise ValueError("Invalid EdNet archive prefix")
    save(prefix_path, prefix)
    offset, learners = 0, 0
    while offset + 30 <= len(prefix) and learners < 128:
        fields = struct.unpack_from("<IHHHHHIIIHH", prefix, offset)
        signature, _, flags, method, _, _, crc, compressed, size, name_len, extra_len = fields
        if signature != 0x04034B50 or flags & 9:
            raise ValueError("Unsupported EdNet member structure")
        name = prefix[offset + 30:offset + 30 + name_len].decode("utf-8")
        start = offset + 30 + name_len + extra_len
        end = start + compressed
        if end > len(prefix):
            break  # Never treat a partial learner file as complete evidence.
        if name.startswith("KT1/u") and name.endswith(".csv") and "/" not in name[4:]:
            if size > 8 * 1024 * 1024:
                raise ValueError("EdNet member exceeded the declared budget")
            data = zlib.decompress(prefix[start:end], -15) if method == 8 else prefix[start:end] if method == 0 else None
            if data is None or len(data) != size or zlib.crc32(data) != crc:
                raise ValueError("EdNet member CRC or size mismatch")
            path = root / "ednet" / Path(name).name
            save(path, data)
            records.append({"source": "ednet", "path": str(path.relative_to(root)), "sha256": sha(data), "bytes": len(data), "archiveMember": name})
            learners += 1
        offset = end
    if learners < 32:
        raise ValueError("Fixed EdNet prefix contains too few complete learners")
    content_path = root / "ednet-contents.zip"
    content = content_path.read_bytes() if content_path.exists() else fetch(EDNET_CONTENT + "&keating_content=1", 2 * 1024 * 1024)
    save(content_path, content)
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        names = [name for name in archive.namelist() if name.endswith("/questions.csv")]
        if len(names) != 1:
            raise ValueError("EdNet question reference is ambiguous")
        questions = archive.read(names[0])
        save(root / "ednet-questions.csv", questions)
    metadata_url = f"https://huggingface.co/api/datasets/{FSRS_REPO}/tree/{FSRS_REVISION}/float-delta-t?limit=100"
    metadata = json.loads(fetch(metadata_url, 1024 * 1024))
    selected, seen = [], set()
    for item in sorted(metadata, key=lambda item: item["path"]):
        digest = item.get("lfs", {}).get("oid")
        if item["size"] > 10 * 1024 * 1024 or not digest or digest in seen:
            continue
        seen.add(digest)
        selected.append(item)
        if len(selected) == 24:
            break
    if len(selected) != 24:
        raise ValueError("Not enough distinct publisher learner files")
    for item in selected:
        path = root / "fsrs" / Path(item["path"]).name
        data = path.read_bytes() if path.exists() else fetch(f"https://huggingface.co/datasets/{FSRS_REPO}/resolve/{FSRS_REVISION}/{item['path']}", item["size"])
        if len(data) != item["size"] or sha(data) != item["lfs"]["oid"]:
            raise ValueError("FSRS source differs from its pinned publisher hash")
        save(path, data)
        records.append({"source": "fsrs", "path": str(path.relative_to(root)), "sha256": sha(data), "bytes": len(data), "publisherPath": item["path"]})
    manifest = {"schemaVersion": 1, "selection": "ednet-first-128-complete-prefix-members;fsrs-first-24-distinct-files-under-10MiB-by-path",
        "ednet": {"source": "https://github.com/riiid/ednet", "archiveUrl": EDNET_KT1, "prefixBytes": PREFIX_BYTES, "prefixSha256": sha(prefix), "contentsSha256": sha(content), "questionsSha256": sha(questions)},
        "fsrs": {"source": f"https://huggingface.co/datasets/{FSRS_REPO}", "revision": FSRS_REVISION, "license": "MIT"}, "files": records}
    save(root / "public-sources.json", (json.dumps(manifest, indent=2) + "\n").encode())
    print(json.dumps({"ednetLearners": learners, "fsrsLearners": len(selected), "sourceManifest": str(root / "public-sources.json")}))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: fetch-decision-policy-data.py RAW-output-directory")
    fetch_decision_policy_data(sys.argv[1])
