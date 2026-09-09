#!/usr/bin/env python3
"""Check published lesson excerpts against the unchanged local source snapshot."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[1]


def hidden_spans(text):
    stack = []
    start = None
    spans = []
    for match in re.finditer(r"<(/?)(think|thinking|analysis)\b[^>]*>", text, re.I):
        closing, tag = match.group(1), match.group(2).lower()
        if not closing:
            if not stack:
                start = match.start()
            stack.append(tag)
        elif stack and tag == stack[-1]:
            stack.pop()
            if not stack:
                spans.append((start, match.end()))
    if stack:
        spans.append((start, len(text)))
    return spans


def verify(portable_path, ledger_path):
    raw = portable_path.read_bytes()
    ledger = json.loads(ledger_path.read_text())
    assert hashlib.sha256(raw).hexdigest() == ledger["sourceSha256"], "Source hash mismatch"
    portable = json.loads(raw)
    ids = set()
    for quote in ledger["quotes"]:
        qid = quote["id"]
        assert qid not in ids, "Duplicate quote ID"
        ids.add(qid)
        session = portable["sessions"][quote["portableSessionIndex"]]["data"]
        assert session["id"] == quote["sessionId"], f"{qid}: session mismatch"
        assert hashlib.sha256(session["id"].encode()).hexdigest() == quote["sessionIdSha256"]
        message = session["messages"][quote["messageIndex"]]
        assert message["role"] == quote["role"] and message["role"] in {"user", "assistant"}
        assert message["timestamp"] == quote["timestampMs"], f"{qid}: timestamp mismatch"
        timestamp = datetime.fromtimestamp(message["timestamp"] / 1000, timezone.utc)
        assert timestamp.isoformat(timespec="milliseconds").replace("+00:00", "Z") == quote["timestampUTC"]
        content = message["content"]
        if isinstance(content, str):
            assert quote["textBlockIndex"] == 0
            text = content
        else:
            block = content[quote["textBlockIndex"]]
            assert block["type"] == "text", f"{qid}: non-visible content block"
            text = block["text"]
        start, end = quote["substringStartInclusive"], quote["substringEndExclusive"]
        assert 0 <= start < end <= len(text)
        assert text[start:end] == quote["quote"], f"{qid}: excerpt mismatch"
        assert not any(start < hidden_end and end > hidden_start
                       for hidden_start, hidden_end in hidden_spans(text)), f"{qid}: thinking content"
    print(f"Verified {len(ids)}/{len(ledger['quotes'])} exact visible lesson excerpts; source hash matches.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--portable", type=Path, required=True)
    parser.add_argument("--ledger", type=Path, default=ROOT / "docs/case-study/quote-ledger.json")
    args = parser.parse_args()
    verify(args.portable, args.ledger)
