#!/usr/bin/env python3
"""Local, aggregate-only audit. Never writes message text, topics, or session IDs."""
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import zipfile


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def analyze(portable_path, training_path):
    portable = json.loads(portable_path.read_text())
    with zipfile.ZipFile(training_path) as archive:
        manifest = json.loads(archive.read("manifest.json"))
        datasets = {name: [json.loads(line) for line in archive.read(name).splitlines() if line.strip()]
                    for name in archive.namelist() if name.endswith(".jsonl")}
    records = datasets["data/keating.training.jsonl"]
    sessions = [entry["data"] for entry in portable["sessions"]]
    seen = set()
    roles = Counter()
    monthly = defaultdict(Counter)
    daily = Counter()
    dates = []
    invalid_timestamps = 0
    copies = 0
    event_models = defaultdict(set)
    for session in sessions:
        for message in session.get("messages", []):
            # A retained event is role + timestamp + content, irrespective of fork.
            # Equal text at different times is deliberately not collapsed.
            key = digest([message.get("role"), message.get("timestamp"), message.get("content")])
            if message.get("role") == "assistant":
                event_models[key].add((str(message.get("provider", "missing")), str(message.get("model", "missing"))))
            if key in seen:
                copies += 1
                continue
            seen.add(key)
            role = message.get("role", "unknown")
            roles[role] += 1
            timestamp = message.get("timestamp")
            try:
                if not isinstance(timestamp, (int, float)) or isinstance(timestamp, bool):
                    raise ValueError("not milliseconds")
                date = datetime.fromtimestamp(timestamp / 1000, timezone.utc)
                if not 2000 <= date.year <= 2100:
                    raise ValueError("implausible timestamp")
                dates.append(date.isoformat())
                monthly[date.strftime("%Y-%m")][role] += 1
                daily[date.strftime("%Y-%m-%d")] += 1
            except (ValueError, OverflowError, OSError):
                invalid_timestamps += 1
    portable_ids = {s["id"] for s in sessions}
    exported_ids = {r["source"]["sessionId"] for r in records if r["source"].get("sessionId")}
    train = [r for r in records if r["split"] == "train"]
    validation = [r for r in records if r["split"] == "validation"]
    rewarded = datasets.get("data/rewards/train.rewarded.jsonl", [])
    source_counts = Counter(f'{r["source"]["type"]}/{r["source"]["kind"]}' for r in records)
    storage = portable["storage"]
    split_sources = lambda rows: {r["source"].get("sessionId") for r in rows if r["source"].get("sessionId")}
    result = {
        "analysisVersion": 1,
        "inputs": [{"role": role, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()}
                   for role, path in [("portable", portable_path), ("training", training_path)]],
        "portableGeneratedAt": portable["generatedAt"],
        "trainingGeneratedAt": manifest["generatedAt"],
        "sessions": len(sessions), "uniqueSessionIds": len(portable_ids),
        "sessionFlags": {k: sum(bool(s.get(k)) for s in sessions) for k in
                         ["parentSessionId", "generatedAlternative", "hiddenAlternative"]},
        "messageEvents": len(seen), "repeatedEventCopies": copies,
        "messageRoles": dict(roles), "invalidMessageTimestamps": invalid_timestamps,
        "firstMessageUtc": min(dates) if dates else None,
        "lastMessageUtc": max(dates) if dates else None,
        "activeUtcDates": len({d[:10] for d in dates}),
        "monthlyMessages": {k: dict(v) for k, v in sorted(monthly.items())},
        "dailyMessages": dict(sorted(daily.items())),
        "modelMetadata": {
            "sessionsWithDifferentAssistantModelId": sum(any(m.get("role") == "assistant" and m.get("model") and m["model"] != (s.get("model") or {}).get("id") for m in s.get("messages", [])) for s in sessions),
            "sessionLabels": dict(Counter(f'{(s.get("model") or {}).get("provider", "missing")}/{(s.get("model") or {}).get("id", "missing")}' for s in sessions)),
            "distinctAssistantEventLabels": dict(Counter(next(iter(labels))[0] + "/" + next(iter(labels))[1] if len(labels) == 1 else "conflicting-copy-labels" for labels in event_models.values())),
            "assistantEventsWithConflictingCopyLabels": sum(len(labels) > 1 for labels in event_models.values()),
            "interpretation": "Stored labels, not verified execution identities or historical provider routing. Session label is not assigned retrospectively to every turn.",
        },
        "storageCounts": {k: len(v) for k, v in storage.items() if isinstance(v, list)},
        "feedbackSources": dict(Counter(x.get("source", "unspecified") for x in storage.get("feedback", []))),
        "questionCheckGrading": dict(Counter(x.get("grading", "unspecified") for x in storage.get("questionChecks", []))),
        "reviewRatings": dict(Counter(str(x.get("rating")) for x in storage.get("cardReviews", []))),
        "training": {
            "fileRows": {k: len(v) for k, v in datasets.items()},
            "canonicalSources": dict(source_counts),
            "quality": dict(Counter(r["quality"]["status"] for r in records)),
            "splits": dict(Counter(r["split"] for r in records)),
            "representedSessionIds": len(exported_ids),
            "sessionIdsAbsentFromPortable": len(exported_ids - portable_ids),
            "crossSplitSessionIds": len(split_sources(train) & split_sources(validation)),
            "crossSplitExactCompletions": len({r["completion"] for r in train} & {r["completion"] for r in validation}),
            "validationCompletionsInAlpaca": sum(r["completion"] in {a["output"] for a in datasets.get("data/sft/train.alpaca.jsonl", [])} for r in validation),
            "judgeEnabled": manifest["judgeScoringEnabled"],
            "rewardedScored": sum(bool(r["scored"]) for r in rewarded),
            "rewardSignalCounts": {k: sum(k in r.get("signals", {}) for r in rewarded)
                                   for k in ["explicit", "inferred", "quiz", "judge"]},
            "manifestCounts": manifest["counts"],
            "manifestWarnings": manifest["warnings"],
        },
    }
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--portable", required=True, type=Path)
    parser.add_argument("--training", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    result = analyze(args.portable, args.training)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(f"Aggregate audit written to {args.output}")
