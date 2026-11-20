#!/usr/bin/env python3
"""Rebuild scratch files from a Claude Code transcript.

The session scratch folder is wiped when the host restarts. Every file the coordinator wrote with the
Write tool (and changed with Edit) is still in the transcript, so this replays those calls.

    python3 recover-scratch.py <transcript.jsonl> <scratch-prefix> <out-dir> [--list]

Files changed afterwards by shell commands are recovered at their last Write/Edit state; check those by hand.
"""
import json, os, sys

transcript, prefix, out = sys.argv[1:4]
listing = "--list" in sys.argv
files, edits_missed = {}, {}
with open(transcript, encoding="utf8") as handle:
    for line in handle:
        try:
            record = json.loads(line)
        except ValueError:
            continue
        message = record.get("message") or {}
        content = message.get("content")
        if message.get("role") != "assistant" or not isinstance(content, list):
            continue
        for block in content:
            if not isinstance(block, dict) or block.get("type") != "tool_use":
                continue
            args = block.get("input") or {}
            path = args.get("file_path") or ""
            if not path.startswith(prefix):
                continue
            if block.get("name") == "Write":
                files[path] = args.get("content", "")
            elif block.get("name") == "Edit" and path in files:
                old, new = args.get("old_string", ""), args.get("new_string", "")
                if old in files[path]:
                    files[path] = files[path].replace(old, new) if args.get("replace_all") else files[path].replace(old, new, 1)
                else:
                    edits_missed[path] = edits_missed.get(path, 0) + 1
for path in sorted(files):
    rel = path[len(prefix):].lstrip("/")
    note = f"  ({edits_missed[path]} edits did not apply)" if path in edits_missed else ""
    print(f"{len(files[path]):>8}  {rel}{note}")
    if listing:
        continue
    target = os.path.join(out, rel)
    os.makedirs(os.path.dirname(target), exist_ok=True)
    with open(target, "w", encoding="utf8") as handle:
        handle.write(files[path])
print(f"{len(files)} files" + ("" if listing else f" written under {out}"))
