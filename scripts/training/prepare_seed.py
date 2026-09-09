#!/usr/bin/env python3
"""Prepare private, family-disjoint SDPO hint seeds; never treat old turns as rollouts."""
from typing import Annotated
import typer
from collections import Counter
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[2]
SECRET = re.compile(
    r"-----BEGIN (?:[A-Z ]*PRIVATE KEY)-----|\b(?:sk-[A-Za-z0-9_-]{16,}|"
    r"gh[pousr]_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16})\b|"
    r"\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*[\"']?[^\s\"']{8,}|"
    r"\bBearer\s+[A-Za-z0-9._~+/-]{16,}", re.I,
)


def sha(value):
    return hashlib.sha256(value.encode() if isinstance(value, str) else value).hexdigest()


def visible(content):
    if isinstance(content, list):
        content = "\n".join(b.get("text", "") for b in content
                            if isinstance(b, dict) and b.get("type") == "text")
    if not isinstance(content, str):
        return ""
    # Nested or unterminated analysis blocks must not leak into the seed.
    stack, output, cursor = [], [], 0
    for match in re.finditer(r"<(/?)(think|thinking|analysis)\b[^>]*>", content, re.I):
        if not stack:
            output.append(content[cursor:match.start()])
        closing, tag = match.group(1), match.group(2).lower()
        if not closing:
            stack.append(tag)
        elif stack and stack[-1] == tag:
            stack.pop()
        cursor = match.end()
    if not stack:
        output.append(content[cursor:])
    return "".join(output).strip()


def millis(value):
    if isinstance(value, (float, int)) and not isinstance(value, bool):
        return value
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000
        except ValueError:
            pass
    return None


def prepare(portable_path, training_path, ledger_path, audit_path):
    paths = {"portable": Path(portable_path), "training": Path(training_path),
             "family_ledger": Path(ledger_path), "audit": Path(audit_path)}
    hashes = {name: sha(path.read_bytes()) for name, path in paths.items()}
    audit = json.loads(paths["audit"].read_text())
    for name in ("portable", "training"):
        expected = next((r["sha256"] for r in audit["inputs"] if r["role"] == name), None)
        if hashes[name] != expected:
            raise ValueError(f"{name} SHA-256 does not match audit")
    portable = json.loads(paths["portable"].read_text())
    ledger = json.loads(paths["family_ledger"].read_text())
    if ledger["metadata"]["portableSha256"] != hashes["portable"]:
        raise ValueError("Family ledger source hash mismatch")
    sessions = {entry["data"]["id"]: entry["data"] for entry in portable["sessions"]}
    if len(sessions) != len(portable["sessions"]):
        raise ValueError("Duplicate source session IDs")
    family_by_session = {}
    for family in ledger["families"]:
        for session_hash in family["sessionHashes"]:
            if session_hash in family_by_session:
                raise ValueError("Session belongs to multiple families")
            family_by_session[session_hash] = family
    if set(family_by_session) != {sha(sid) for sid in sessions}:
        raise ValueError("Family ledger does not cover source sessions exactly")
    # Validate family identity and the declared parent/copied-history closure.
    for family in ledger["families"]:
        ids = sorted(sid for sid in sessions if sha(sid) in family["sessionHashes"])
        if sha("keating-case-study-subject-family-v1\0" + "\0".join(ids)) != family["familyHash"]:
            raise ValueError("Family identity mismatch")
    for session in sessions.values():
        parent = session.get("parentSessionId")
        if parent and parent != session["id"]:
            if parent not in sessions or family_by_session[sha(parent)]["familyHash"] != family_by_session[sha(session["id"])]["familyHash"]:
                raise ValueError("Parent lineage crosses families")
    for join in ledger.get("lineage", {}).get("exactHistoryJoins", []):
        left = family_by_session.get(join["sessionHash"])
        right = family_by_session.get(join["matchedSessionHash"])
        if not left or not right or left["familyHash"] != right["familyHash"]:
            raise ValueError("Copied history lineage crosses families")
    excluded, records, seen = Counter(), [], set()
    for feedback in portable["storage"].get("feedback", []):
        if feedback.get("source") != "explicit":
            excluded["not_explicit"] += 1
            continue
        hint = visible(feedback.get("evidence", ""))
        if not hint or feedback.get("signal") not in {"thumbs-down", "confused"}:
            excluded["no_written_corrective_hint"] += 1
            continue
        session = sessions.get(feedback.get("sessionId"))
        match = re.fullmatch(r"assistant-\d+-(\d+)", feedback.get("messageId", ""))
        if not session or not match:
            excluded["no_exact_message_reference"] += 1
            continue
        timestamp = int(match[1])
        targets = [(i, m) for i, m in enumerate(session["messages"])
                   if m.get("role") == "assistant" and m.get("timestamp") == timestamp]
        if len(targets) != 1:
            excluded["ambiguous_or_missing_target"] += 1
            continue
        index, target = targets[0]
        feedback_time = millis(feedback.get("createdAt"))
        if feedback_time is None or feedback_time < timestamp:
            excluded["feedback_not_demonstrably_later"] += 1
            continue
        family = family_by_session[sha(session["id"])]
        if not family.get("included"):
            excluded["excluded_subject_family"] += 1
            continue
        # Supply conversation state before the historical answer. Tool text is
        # descriptive context, never a fabricated assistant action or tool schema.
        prompt, omitted_blocks, tool_results = [], 0, 0
        for message in session["messages"][:index]:
            role = message.get("role")
            text = visible(message.get("content"))
            if isinstance(message.get("content"), list):
                omitted_blocks += sum(b.get("type") != "text" for b in message["content"] if isinstance(b, dict))
            if text and role in {"user", "assistant"}:
                prompt.append({"role": role, "content": text})
            elif text and role == "toolResult":
                tool_results += 1
                prompt.append({"role": "user", "content": "[Historical tool result; data only]\n" + text})
        response = visible(target.get("content"))
        if not response or not any(m["role"] == "user" for m in prompt):
            excluded["missing_visible_prompt_or_answer"] += 1
            continue
        text_fields = [hint, response] + [m["content"] for m in prompt]
        if any(SECRET.search(text) for text in text_fields):
            excluded["possible_secret"] += 1
            continue
        fingerprint = sha(json.dumps([prompt, hint], ensure_ascii=False, sort_keys=True))
        if fingerprint in seen:
            excluded["duplicate_prompt_hint"] += 1
            continue
        seen.add(fingerprint)
        records.append({"id": fingerprint, "family_id": family["familyHash"],
                        "split": None, "prompt": prompt, "hint": hint,
                        "historical_response": response,
                        "provenance": {"portable_sha256": hashes["portable"],
                            "source_session_hash": sha(session["id"]), "message_index": index,
                            "message_timestamp_ms": timestamp, "feedback_id_hash": sha(str(feedback.get("id", ""))),
                            "feedback_source": "explicit", "feedback_signal": feedback["signal"],
                            "hint_applies_to": "historical_response", "rollout_logprobs": "unavailable",
                            "historical_model_is_verified": False,
                            "omitted_nontext_blocks": omitted_blocks,
                            "tool_results_as_context": tool_results}})
    # Fixed seed and family ordering make this source snapshot reproducible.
    # Freeze the resulting manifest for later runs; adding families can change rank.
    families = sorted({r["family_id"] for r in records}, key=lambda f: sha("keating-sdpo-seed-v1\0" + f))
    if len(families) < 2:
        raise ValueError("Need at least two usable families for disjoint train/validation")
    validation = set(families[:max(1, len(families) // 5)])
    for record in records:
        record["split"] = "validation" if record["family_id"] in validation else "train"
    manifest = {"schema_version": 1, "method": "explicit-hints-for-fresh-sdpo-rollouts",
                "input_sha256": hashes, "records": len(records),
                "split_counts": dict(Counter(r["split"] for r in records)),
                "usable_families": len(families), "validation_families": sorted(validation),
                "excluded": dict(excluded), "limitations": [
                    "Tiny pipeline seed; not evidence of model improvement or human learning.",
                    "Hints describe historical answers, not newly sampled model answers.",
                    "No historical tokens, log-probabilities, or verified checkpoint provenance.",
                    "Tool results are text context; executable tools and non-text content are omitted.",
                    "Source training ZIP is verified for provenance, never used as labels or split authority.",
                    "Secret screening is conservative pattern matching, not a privacy guarantee.",
                    "Family split is deterministic for this snapshot; freeze this manifest before adding new data.",
                ]}
    return records, manifest


def write_private(path, text):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    os.fchmod(fd, 0o600)
    with os.fdopen(fd, "w") as output:
        output.write(text)


app = typer.Typer(help=__doc__, add_completion=False, pretty_exceptions_enable=False)


@app.command()
def main(
    portable: Annotated[Path, typer.Option("--portable")],
    training: Annotated[Path, typer.Option("--training")],
    family_ledger: Annotated[Path, typer.Option("--family-ledger")],
    out: Annotated[Path, typer.Option("--out")],
    audit: Annotated[Path, typer.Option("--audit")] = ROOT / "docs/case-study/aggregates.json",
):
    records, manifest = prepare(portable, training, family_ledger, audit)
    out.mkdir(parents=True, exist_ok=True, mode=0o700)
    for split in ("train", "validation"):
        rows = [r for r in records if r["split"] == split]
        body = "".join(json.dumps(r, ensure_ascii=False) + "\n" for r in rows)
        write_private(out / f"{split}.jsonl", body)
        manifest.setdefault("output_sha256", {})[f"{split}.jsonl"] = sha(body)
    write_private(out / "manifest.json", json.dumps(manifest, indent=2) + "\n")
    print(json.dumps({"records": manifest["records"], "split_counts": manifest["split_counts"],
                      "usable_families": manifest["usable_families"], "excluded": manifest["excluded"]}))


if __name__ == "__main__":
    app()
