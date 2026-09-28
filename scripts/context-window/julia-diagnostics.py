#!/usr/bin/env python3
"""Literal argmax and complete latency distribution from retained tapes only."""
import collections
import datetime
import hashlib
import json
import math
import pathlib
import statistics
import sys

plan_path, directory, output_path = map(pathlib.Path, sys.argv[1:])
plan = json.loads(plan_path.read_text())
if plan["sha256"] != "53857b3ea5f8dc97d3a32c7542419a806923db3a689b28a23f4fb2947b479c37":
    raise ValueError("wrong frozen plan")
trials = {trial["id"]: trial for trial in plan["trials"]}
planned_types = collections.Counter(trial["request"]["questions"][key]["type"] for trial in plan["trials"] for key in trial["expected"])
models = {}
for provider in [*plan["providers"], {"id": "julia-1-onnx-cpu"}]:
    tape = directory / "receipts.jsonl" if provider["id"] == "julia-1-onnx-cpu" else plan_path.parent / "execution" / provider["id"] / "receipts.jsonl"
    text = tape.read_text()
    rows = [json.loads(line) for line in text.splitlines()]
    kinds = {kind: dict(planned=count, correct=0, tiesOnLabels=0) for kind, count in planned_types.items()}
    ties = covered = failed = 0
    for row in rows:
        trial = trials[row["trialId"]]
        if row["requestSha256"] != trial["requestSha256"]:
            raise ValueError("request hash mismatch")
        if row["outcome"]["status"] != "ok":
            failed += 1
            continue
        for key, question in trial["request"]["questions"].items():
            kind = question["type"]
            keys = ["false", "true"] if kind == "noul" else list(question["criteria"]) if kind == "choice" else list(map(str, range(len(question["criteria"]))))
            probabilities = [row["outcome"]["answers"][key]["probabilities"][label] for label in keys]
            maximum = max(probabilities)
            tie = probabilities.count(maximum) > 1
            index = probabilities.index(maximum)
            value = bool(index) if kind == "noul" else index if kind == "score" else keys[index]
            covered += 1
            ties += tie
            if key in trial["expected"]:
                kinds[kind]["correct"] += value == trial["expected"][key]
                kinds[kind]["tiesOnLabels"] += tie
    models[provider["id"]] = dict(plannedLabels=972, correct=sum(kind["correct"] for kind in kinds.values()), types=kinds,
        coveredQuestions=covered, plannedQuestions=9132, maximumTiesAcrossOutputs=ties,
        maximumTiesOnLabels=sum(kind["tiesOnLabels"] for kind in kinds.values()), failedRequests=failed,
        receiptsSha256=hashlib.sha256(text.encode()).hexdigest())

rows = [json.loads(line) for line in (directory / "receipts.jsonl").read_text().splitlines()]
times = sorted(row["outcome"]["latencyMs"] for row in rows)
seconds = sum(times) / 1000
counts = [len(row["outcome"].get("answers", {})) for row in rows]
run = json.loads((directory / "run.json").read_text())
completion = json.loads((directory / "completion.json").read_text())
date = lambda value: datetime.datetime.fromisoformat(value.replace("Z", "+00:00"))
performance = dict(scoringAttemptSeconds=seconds, elapsedSeconds=(date(completion["completedAt"]) - date(run["startedAt"])).total_seconds(),
    outputsPerSecond=sum(counts) / seconds, requestBatchesPerSecond=len(rows) / seconds,
    medianMs=statistics.median(times), p90Ms=times[math.ceil(len(times) * .90) - 1],
    p95Ms=times[math.ceil(len(times) * .95) - 1], p99Ms=times[math.ceil(len(times) * .99) - 1], minMs=times[0], maxMs=times[-1],
    firstBatchMs=rows[0]["outcome"]["latencyMs"], questionCountDistribution=dict(sorted(collections.Counter(counts).items())),
    meanQuestionsPerRequest=statistics.mean(counts), medianQuestionsPerRequest=statistics.median(counts),
    inferenceMicrobatch=8, inferenceCalls=sum(math.ceil(count / 8) for count in counts), cpu=run["cpu"], threads=4, maxLength=8192, headLength=512,
    peakMemoryMeasured=False, boundary="Single-question latency and cold-load duration are not measured separately. Percentiles use nearest-rank; median midpoint.")
result = dict(originalPlanSha256=plan["sha256"], literalArgmax=models, performance=performance,
    harnessSha256=hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(),
    notices=["Literal maximum probability in frozen option order, with first option winning exact ties. No thresholds or abstentions.",
        "Historical probability rounding can create ties; latent unrounded baseline probabilities cannot be recovered.",
        "Failed requests retain all planned labels. Only the 972 authored assertions have accuracy claims.",
        "Main sweep timings include concurrent repository builds, graph indexing, briefly Android compilation and browser work; not isolated hardware timing."])
with output_path.open("x") as stream:
    json.dump(result, stream, indent=2)
print(json.dumps(dict(julia=models["julia-1-onnx-cpu"], performance=performance)))
