"""Collect every measured artifact into one canonical dataset for the site.

Nothing here is typed from memory: each figure is read out of the result file the
benchmark wrote. Missing inputs raise, so the site cannot silently ship a gap.
"""
from __future__ import annotations

import json
import pathlib
import statistics

ROOT = pathlib.Path(__file__).resolve().parents[2]
DATA = ROOT / ".keating/tmp/site-data"
TMP = ROOT / ".keating/tmp"
TRAINING = TMP / "needle-training"


def score_level(value: float) -> int:
    return min(2, max(0, round(value)))


def read_json(path: pathlib.Path):
    return json.loads(path.read_text())


def read_jsonl(path: pathlib.Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def needle_retrieval() -> dict:
    raw = (TMP / "bench-needle-retrieval.json").read_text()
    parsed = json.loads(raw[raw.index("{"):])
    out = {"corpusMessages": parsed["corpusMessages"], "embedMs": parsed["embedMs"], "splits": {}}
    for split in ("literal", "paraphrase"):
        section = parsed[split]
        rows = section["rows"]
        out["splits"][split] = {
            "n": section["n"],
            "needle": section["needle"],
            "lexical": section["lexical"],
            "separations": sum(1 for row in rows if row["bestRelevantZ"] > row["topIrrelevantZ"]),
            "rows": rows,
        }
    return out


def needle_170() -> dict:
    report = read_json(TRAINING / "eval-report.json")
    out = {"artifacts": report["artifacts"], "models": {}}
    for name, model in report["models"].items():
        out["models"][name] = {
            "probeCorrect": model["probe_correct"], "probeN": model["probe_n"],
            "trainCorrect": model["train_correct"], "trainN": model["train_n"],
            "refused": model["offtopic_refused"], "refusedN": model["offtopic_n"],
            "medianMs": model["probe_median_ms"], "loadMs": model["load_ms"],
            "perClass": model["train_per_class"],
        }
    return out


def dataset_shape() -> dict:
    rows = [json.loads(line) for line in (TRAINING / "dataset.jsonl").read_text().splitlines() if line.strip()]
    probe = read_json(TRAINING / "eval.json")
    refusals = sum(1 for row in rows if not row["answers"])
    tools = rows[0]["tools"]
    return {"rows": len(rows), "refusalRows": refusals, "subjectRows": len(rows) - refusals,
            "tools": len(tools), "toolNames": [tool["name"] for tool in tools], "probeRows": len(probe)}


def answer_level(answer: dict) -> str:
    kind = answer.get("type")
    if kind == "score":
        return str(score_level(answer.get("score", 0)))
    if kind == "noul":
        return "yes" if answer.get("noul", 0) >= 0.5 else "no"
    if kind == "choice":
        return str(answer.get("choice"))
    return "?"


def question_family(key: str) -> str:
    for suffix, name in ((".evidence.1", "evidence-selection"), (".judgeable", "judgeable-noul"),
                         (".support", "support-choice"), (".score", "rubric-score")):
        if key.endswith(suffix):
            return name
    return "other"


def kev_vs_jev() -> dict:
    records = [r for r in read_jsonl(TMP / "kev-vs-jev.jsonl") if r.get("kev") and r.get("jev")]
    agree: dict[str, int] = {}
    total: dict[str, int] = {}
    kev_levels: dict[str, dict[str, int]] = {}
    jev_levels: dict[str, dict[str, int]] = {}
    deltas: list[float] = []
    confident = 0
    for record in records:
        local, hosted = record["kev"]["answers"], record["jev"]["answers"]
        for key in sorted(set(local) & set(hosted)):
            group = question_family(key)
            total[group] = total.get(group, 0) + 1
            total["all"] = total.get("all", 0) + 1
            left, right = answer_level(local[key]), answer_level(hosted[key])
            same = left == right
            agree[group] = agree.get(group, 0) + int(same)
            agree["all"] = agree.get("all", 0) + int(same)
            kev_levels.setdefault(group, {})
            jev_levels.setdefault(group, {})
            kev_levels[group][left] = kev_levels[group].get(left, 0) + 1
            jev_levels[group][right] = jev_levels[group].get(right, 0) + 1
            if local[key].get("type") == "score" and hosted[key].get("type") == "score":
                deltas.append(abs(local[key]["score"] - hosted[key]["score"]))
            if not same:
                value = local[key].get("confidence")
                if local[key].get("type") == "noul":
                    noul = local[key].get("noul", 0)
                    value = max(noul, 1 - noul)
                if isinstance(value, (int, float)) and value >= 0.9:
                    confident += 1
    return {
        "requests": len(records),
        "questions": total.get("all", 0),
        "agreement": {group: {"agree": agree.get(group, 0), "total": count}
                      for group, count in sorted(total.items())},
        "kevLevels": {k: dict(sorted(v.items())) for k, v in sorted(kev_levels.items())},
        "jevLevels": {k: dict(sorted(v.items())) for k, v in sorted(jev_levels.items())},
        "meanAbsScoreDelta": round(statistics.mean(deltas), 3) if deltas else None,
        "confidentDisagreements": confident,
        "kevMedianMs": round(statistics.median([r["kevMs"] for r in records])),
        "jevMedianMs": round(statistics.median([r["jevMs"] for r in records])),
        "suites": sorted({r["suite"] for r in records}),
    }


def jev_harness() -> dict:
    records = read_jsonl(TMP / "jev-only.jsonl")
    ok = [r for r in records if r.get("jev")]
    latencies = [r["ms"] for r in ok]
    by_suite: dict[str, list[float]] = {}
    stub_suite = "teaching-v4"
    scores: dict[int, int] = {}
    judgeable = {"yes": 0, "no": 0}
    support: dict[str, int] = {}
    evidence = {"span": 0, "no_match": 0}
    blank = lambda: {"judgeableYes": 0, "judgeableNo": 0, "span": 0, "noMatch": 0,
                     "unverifiable": 0, "dims": 0, "requests": 0}
    real, stub = blank(), blank()
    suite_scores: dict[str, dict[int, int]] = {}
    all_two_rows = 0
    confidences: list[float] = []
    high = tokens_in = tokens_out = requested = answered = 0
    models: dict[str, int] = {}
    for record in ok:
        suite = record["suite"]
        by_suite.setdefault(suite, []).append(record["ms"])
        bucket = stub if suite == stub_suite else real
        bucket["requests"] += 1
        answers = record["jev"]["answers"]
        requested += record["questions"]
        answered += len(answers)
        name = record["jev"].get("model")
        models[name] = models.get(name, 0) + 1
        usage = record["jev"].get("usage") or {}
        tokens_in += usage.get("input_tokens", 0) or 0
        tokens_out += usage.get("output_tokens", 0) or 0
        row_levels: list[int] = []
        for key, answer in answers.items():
            kind = answer.get("type")
            if kind == "score":
                level = score_level(answer.get("score", 0))
                scores[level] = scores.get(level, 0) + 1
                suite_scores.setdefault(suite, {})
                suite_scores[suite][level] = suite_scores[suite].get(level, 0) + 1
                row_levels.append(level)
                bucket["dims"] += 1
            elif kind == "noul" and key.endswith(".judgeable"):
                yes = answer.get("noul", 0) >= 0.5
                judgeable["yes" if yes else "no"] += 1
                bucket["judgeableYes" if yes else "judgeableNo"] += 1
            elif kind == "choice":
                choice = str(answer.get("choice"))
                if key.endswith(".support"):
                    support[choice] = support.get(choice, 0) + 1
                    if choice == "unverifiable":
                        bucket["unverifiable"] += 1
                elif key.endswith(".evidence.1"):
                    matched = choice != "__no_match__"
                    evidence["span" if matched else "no_match"] += 1
                    bucket["span" if matched else "noMatch"] += 1
                value = answer.get("confidence")
                if isinstance(value, (int, float)):
                    confidences.append(value)
                    high += int(value >= 0.9)
        if len(row_levels) >= 3 and all(level == 2 for level in row_levels):
            all_two_rows += 1
    return {
        "requests": len(ok), "errors": len(records) - len(ok),
        "questionsRequested": requested, "questionsAnswered": answered,
        "models": models,
        "latency": {"min": round(min(latencies)), "median": round(statistics.median(latencies)),
                    "p90": round(sorted(latencies)[int(len(latencies) * 0.9)]), "max": round(max(latencies))},
        "latencyBySuite": {suite: round(statistics.median(values)) for suite, values in sorted(by_suite.items())},
        "requestsBySuite": {suite: len(values) for suite, values in sorted(by_suite.items())},
        "scoreLevels": dict(sorted(scores.items())),
        "scoreLevelsBySuite": {suite: dict(sorted(levels.items())) for suite, levels in sorted(suite_scores.items())},
        "rowsAllTwos": all_two_rows,
        "judgeable": judgeable, "support": dict(sorted(support.items())), "evidence": evidence,
        "realAnswers": real, "stubAnswers": stub,
        "choiceConfidence": {"median": round(statistics.median(confidences), 3),
                             "atLeast0.9": high, "n": len(confidences)},
        "tokens": {"input": tokens_in, "output": tokens_out},
    }


def index_footprint() -> dict:
    candidates = sorted(ROOT.glob(".keating/tmp/**/state/needle-index.json"))
    if not candidates:
        raise FileNotFoundError("no needle-index.json sample found")
    path = candidates[0]
    entries = read_json(path)["entries"]
    dimensions = len(entries[0]["vector"])
    size = path.stat().st_size
    return {"entries": len(entries), "dimensions": dimensions, "jsonBytes": size,
            "bytesPerEntry": round(size / len(entries)),
            "packedFloat32Bytes": len(entries) * dimensions * 4,
            "capEntries": 152,
            "projectedJsonBytesAtCap": round(size / len(entries) * 152),
            "projected256Int8BytesAtCap": 152 * 256}


def build() -> dict:
    return {
        "needleRetrieval": needle_retrieval(),
        "staticRetrieval": read_jsonl(DATA / "static-retrieval.jsonl"),
        "needleLatency": read_json(DATA / "needle-latency.json"),
        "needleClassifyCensus": read_json(DATA / "needle-classify-census.json"),
        "needleExtractCensus": read_json(DATA / "needle-extract-census.json"),
        "staticExtraction": read_json(DATA / "static-extraction.json"),
        "subject170": read_jsonl(DATA / "static-subject-170.jsonl"),
        "needle170": needle_170(),
        "datasetShape": dataset_shape(),
        "probeSplit": read_json(DATA / "probe-split.json"),
        "abstain": {"potion-base-8M": read_json(TMP / "bench-abstain-8m.json"),
                    "potion-retrieval-32M": read_json(TMP / "bench-abstain-32m.json")},
        "kevVsJev": kev_vs_jev(),
        "jevHarness": jev_harness(),
        "artifactSizes": read_json(DATA / "artifact-sizes.json"),
        "indexFootprint": index_footprint(),
    }


if __name__ == "__main__":
    print(json.dumps(build(), indent=1))
