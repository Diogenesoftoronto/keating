#!/usr/bin/env python3
"""Small, predeclared original FP32 CPU control; never a second full sweep."""
import hashlib
import importlib.metadata
import json
import math
import pathlib
import sys
import time

plan_path, benchmark_path, checkpoint_path, output_path = map(pathlib.Path, sys.argv[1:])
revision = "a85b127321d580d65176c89ced8273f305745d85"
plan = json.loads(plan_path.read_text())
if plan["sha256"] != "53857b3ea5f8dc97d3a32c7542419a806923db3a689b28a23f4fb2947b479c37":
    raise ValueError("wrong frozen plan")
manifest = json.loads((checkpoint_path / "download-manifest.json").read_text())
if manifest["sha"] != revision:
    raise ValueError("wrong original revision")
artifacts = []
for filename in ["model.safetensors", "config.json", "julia_config.json", "encoder/config.json", "tokenizer/tokenizer.json", "tokenizer/tokenizer_config.json", *[str(p.relative_to(checkpoint_path)) for p in (checkpoint_path / "julia").rglob("*.py")]]:
    path = checkpoint_path / filename
    meta = next(item for item in manifest["siblings"] if item["rfilename"] == filename)
    sha = hashlib.sha256()
    git_sha = hashlib.sha1(f"blob {path.stat().st_size}\0".encode())
    with path.open("rb") as stream:
        while block := stream.read(1024 * 1024):
            sha.update(block)
            git_sha.update(block)
    if path.stat().st_size != meta["size"] or (meta.get("lfs") and sha.hexdigest() != meta["lfs"]["sha256"]) or (not meta.get("lfs") and git_sha.hexdigest() != meta["blobId"]):
        raise ValueError(f"original artifact integrity mismatch: {filename}")
    artifacts.append(dict(file=filename, bytes=path.stat().st_size, sha256=sha.hexdigest()))

sys.path.insert(0, str(checkpoint_path))
import torch
from julia.inference import TransformerEngine
from julia.data import sequence

torch.set_num_threads(4)
torch.set_num_interop_threads(1)
selection = [("planning", "en"), ("adherence", "en"), ("grading", "en"), ("planning", "fr"), ("adherence", "hi")]
selected = [next(trial for trial in plan["trials"] if trial["stage"] == stage and trial["language"] == language) for stage, language in selection]
billing = dict(state="I was charged twice for the same order.", question="Which team should handle this request?", type="choice", options=["Billing and payment disputes", "Shipping and delivery", "Account access and login"])
saved = {row["trialId"]: row for row in map(json.loads, (benchmark_path / "receipts.jsonl").read_text().splitlines())}
output_path.mkdir(parents=True, exist_ok=True)
provenance = dict(checkpoint=f"SupersonicLabs/Julia-1@{revision}", artifacts=artifacts,
    packages={name: importlib.metadata.version(name) for name in ["torch", "transformers", "tokenizers", "safetensors", "numpy", "huggingface-hub"]},
    python=sys.version, threads=4, maxLength=8192, headLength=512, inferenceMicrobatch=8,
    harnessSha256=hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest(), selectedTrialIds=[trial["id"] for trial in selected],
    selection="First frozen trial for English planning/adherence/grading, French planning, Hindi adherence; no quality-based selection",
    boundary="Unmodified published TransformerEngine CPU FP32. Nullable Choice descriptions fall back to unchanged candidate keys; raw logits/softmax retained. Small diagnostic, not a second benchmark ranking.")
(output_path / "provenance.json").write_text(json.dumps(provenance, indent=2))
load_start = time.perf_counter()
engine = TransformerEngine(checkpoint_path, device="cpu", max_length=8192, head_length=512)
load_seconds = time.perf_counter() - load_start
if any(parameter.dtype != torch.float32 for parameter in engine.model.parameters()):
    raise ValueError("original model is not full FP32")

def softmax(values):
    maximum = max(values)
    values = [math.exp(value - maximum) for value in values]
    total = sum(values)
    return [value / total for value in values]

receipts = []
for trial in selected:
    entries = list(trial["request"]["questions"].items())
    original_rows, labels = [], []
    for key, question in entries:
        kind = question["type"]
        if kind == "noul":
            keys = ["false", "true"]
            options = [question.get("criteria", {}).get(key, key) for key in keys] if question.get("criteria") is not None else keys
        elif kind == "score":
            options = question["criteria"]
            keys = list(map(str, range(len(options))))
        else:
            keys = list(question["criteria"])
            options = [question["criteria"][key] if question["criteria"][key] is not None else key for key in keys]
        labels.append(keys)
        original_rows.append(dict(state=trial["request"]["state"], question=question["instructions"], type=kind, options=options))
    for serializer in ["published-python-json", "shipped-compact-sorted-json"]:
        rows = [dict(row) for row in original_rows]
        if serializer == "shipped-compact-sorted-json":
            for row in rows:
                row["state"] = json.dumps(row["state"], ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        encoded = [sequence(engine.tokenizer, row, max_length=8192, head_length=512, strict=True) for row in rows]
        for row, item in zip(rows, encoded):
            row["_encoded"] = item
        start = time.perf_counter()
        logits = []
        for offset in range(0, len(rows), 8):
            logits.extend(engine.logits(rows[offset:offset + 8]))
        probabilities = [softmax(values) for values in logits]
        answers = {}
        for ((key, question), keys, values, raw_logits, proof) in zip(entries, labels, probabilities, logits, encoded):
            modal = max(range(len(values)), key=values.__getitem__)
            decoded = bool(modal) if question["type"] == "noul" else modal if question["type"] == "score" else keys[modal]
            js_proof = dict(ids=proof["ids"], markers=proof["markers"], qtype=proof["qtype"])
            encoded_hash = hashlib.sha256(json.dumps(js_proof, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()
            benchmark_answer = saved[trial["id"]]["outcome"]["answers"][key]
            benchmark_proof = next(item for item in saved[trial["id"]]["outcome"]["raw"]["contextProof"]["questions"] if item["question"] == key)
            answers[key] = dict(type=question["type"], logits=raw_logits, probabilities=dict(zip(keys, values)), argmax=decoded,
                encodedTokens=len(proof["ids"]), encodedSha256=encoded_hash, identicalToShippedEncoding=encoded_hash == benchmark_proof["encodedSha256"],
                maxProbabilityDifferenceFromShipped=max(abs(value - benchmark_answer["probabilities"][label]) for label, value in zip(keys, values)))
        receipt = dict(trialId=trial["id"], requestSha256=trial["requestSha256"], serializer=serializer,
            elapsedSeconds=time.perf_counter() - start, answers=answers)
        receipts.append(receipt)
        with (output_path / "receipts.jsonl").open("a") as stream:
            stream.write(json.dumps(receipt, ensure_ascii=False) + "\n")
        print(json.dumps(dict(trialId=trial["id"], serializer=serializer, questions=len(answers), elapsedSeconds=receipt["elapsedSeconds"])), flush=True)

billing_logits = engine.logits([billing])[0]
billing_result = dict(request=billing, logits=billing_logits, probabilities=softmax(billing_logits))
summary = dict(provenance=provenance, loadSeconds=load_seconds, billing=billing_result, serializers={})
for serializer in ["published-python-json", "shipped-compact-sorted-json"]:
    rows = [receipt for receipt in receipts if receipt["serializer"] == serializer]
    correct = planned = identical = questions = 0
    maximum_difference = 0
    for receipt in rows:
        trial = next(trial for trial in selected if trial["id"] == receipt["trialId"])
        for key, expected in trial["expected"].items():
            planned += 1
            correct += receipt["answers"][key]["argmax"] == expected
        for answer in receipt["answers"].values():
            questions += 1
            identical += answer["identicalToShippedEncoding"]
            maximum_difference = max(maximum_difference, answer["maxProbabilityDifferenceFromShipped"])
    summary["serializers"][serializer] = dict(trials=len(rows), questions=questions, plannedLabels=planned, correctArgmax=correct,
        identicalToShippedEncodings=identical, maximumProbabilityDifferenceFromShipped=maximum_difference)
(output_path / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2))
print(json.dumps(dict(loadSeconds=load_seconds, billing=billing_result, serializers=summary["serializers"])), flush=True)
