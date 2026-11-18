"""Recount frozen public tutor evaluations using Python, Git, tar, Node, Bun and rtk."""

import hashlib
import json
import re
import statistics
import subprocess
import sys
import tempfile
from collections import Counter, defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parents[4]
ARCHIVE = "web/public/reports/learning-to-teach"
CLI_FILE = f"{ARCHIVE}/benchmark-v3-results.json"
TEACHING_FILE = f"{ARCHIVE}/report-data.json"
COMPILER_FILE = f"{ARCHIVE}/openui-preview.js"
CLI_REVISION = "1f1c518ca72f96e3897264c03df2a6455deee9ef"
PINS = {
    CLI_FILE: "7851527cd9589c7051db096dc64e65110d2c2b2f2b3e7ced878ea2b64d442dc9",
    TEACHING_FILE: "2090c64089477cc565562d3c78435e9f92d817ae68286234527dcaf98e750bb6",
    COMPILER_FILE: "43bc1250a87d8dc6ebded47de6b9201cf7a43247bb392a8dc4ed02a18b7f4b22",
}

# Determine the practice subset from the scripted learner input, before inspecting model output.
PRACTICE = (
    "Can we do one more?",
    "Oh, half of that is 3/8 litre. Two equal parts. Can I try another?",
    "Okay, try me with water draining out instead.",
)
CLI_EXAMPLES = {
    ("kimi-k3", "context-fractions-fragile", 4): "fraction-question",
    ("gemma-4-31b", "context-fractions-fragile", 4): "fraction-rejected",
    ("inkling-small-base", "context-fractions-fragile", 4): "fraction-text",
    ("qwen3.6-35b", "fraction-whole-repair", 2): "fraction-brief",
}
CHECKPOINTS = {
    "before": "Inkling Small + identity SFT",
    "after": "Inkling Small + OpenUI SFT",
    "sdpo": "Inkling Small + OpenUI SFT + SDPO",
}
CHECKPOINT_EXAMPLES = {
    ("before", "test-probability-check"): "coin-text",
    ("after", "test-probability-check"): "coin-grading-failed",
    ("sdpo", "test-probability-check"): "coin-graded",
    ("sdpo", "test-fare-simulation"): "taxi-simulation",
    ("after", "test-speed-cards"): "speed-flashcards",
}
NO_TEST_CASES = {
    "worked-equation-negative", "worked-probability-tree", "fluent-conservation-mass",
    "direct-derivative-help", "long-python-nested-copy", "long-stats-switch-support",
    "long-reading-interpretation", "long-sql-null-recovery", "long-units-change-preference",
}


def digest(value):
    return hashlib.sha256(value).hexdigest()


def zero_counts(*names):
    return Counter(dict.fromkeys(names, 0))


def measured_example(example_id, cohort, model, case_id, step_index, learner, reply, **details):
    return {
        "id": example_id, "cohort": cohort, "model": model, "case_id": case_id,
        "step_index": step_index, "learner": learner, "reply": reply,
        "learner_sha256": digest(learner.encode()), "reply_sha256": digest(reply.encode()),
        **details,
    }


def inspect_rejections(records):
    """Replay the original source and test a one-field repair in a temporary snapshot."""
    source_paths = ["src/tui/ui/adapter.ts", "src/tui/ui/types.ts", "src/tui/learner-contracts.ts",
                    "packages/learner-contracts/src"]
    archive = subprocess.check_output(["rtk", "proxy", "git", "archive", CLI_REVISION, *source_paths], cwd=ROOT)
    script = """
import {readFileSync} from 'node:fs';
import {adaptUiDocument} from './src/tui/ui/adapter.ts';
const counts = {documents: 0, rejected: 0, invalid_json: 0, markdown_field_mismatch: 0, valid_after_field_rename: 0};
const repairedExamples = [];
for (const {source, status, example} of JSON.parse(readFileSync(0, 'utf8'))) {
  if (adaptUiDocument(source).ok !== (status === 'rendered')) throw Error('Archived receipt disagrees with replay');
  counts.documents++;
  if (status !== 'rejected') continue;
  counts.rejected++;
  let value;
  try { value = JSON.parse(source); } catch { counts.invalid_json++; continue; }
  let changed = false;
  for (const node of Array.isArray(value?.nodes) ? value.nodes : []) {
    if (node?.type !== 'markdown' || node.markdown !== undefined) continue;
    const keys = ['content', 'text', 'body'].filter(key => typeof node[key] === 'string');
    if (keys.length !== 1) continue;
    node.markdown = node[keys[0]];
    delete node[keys[0]];
    changed = true;
  }
  if (!changed) continue;
  counts.markdown_field_mismatch++;
  if (adaptUiDocument(JSON.stringify(value)).ok) {
    counts.valid_after_field_rename++;
    if (example) repairedExamples.push(example);
  }
}
process.stdout.write(JSON.stringify({counts, repaired_examples: repairedExamples}));
"""
    with tempfile.TemporaryDirectory(prefix="keating-archived-adapter-") as snapshot:
        subprocess.run(["rtk", "proxy", "tar", "-x", "-C", snapshot], input=archive, check=True)
        result = subprocess.run(["rtk", "proxy", "bun", "-e", script], cwd=snapshot,
                                input=json.dumps(records), text=True, capture_output=True, check=True)
    return {
        **json.loads(result.stdout), "adapter_revision": CLI_REVISION,
        "unit": "Individual extracted documents from eligible message steps. Original validity matched every archived receipt. "
                "For rejected JSON, replay an in-memory copy after renaming content, text, or body to markdown on top-level Markdown nodes.",
    }


def cli_results(data, examples):
    cases = {c["id"]: c["steps"] for c in data["cases"]}
    practice_cases = [
        {"case_id": case_id, "step_index": index, "learner": step["text"]}
        for case_id, steps in cases.items() for index, step in enumerate(steps)
        if step["kind"] == "message" and step["text"] in PRACTICE
    ]
    models, prose_lengths, records = [], [], []
    type_frequency = Counter()
    total = Counter()
    # Preserve zero numerators in the model table.
    names = (
        "episodes", "output_limited_episodes", "failed_episodes", "turns", "nonblank_turns",
        "recognized", "valid", "rejected_only", "question", "question_group",
        "practice", "practice_recognized", "practice_valid", "practice_question",
    )
    for model in data["models"]:
        counts = zero_counts(*names)
        episode_ids = [r["case_id"] for r in model["rows"]]
        assert len(set(episode_ids)) == len(episode_ids) == len(cases)
        for row in model["rows"]:
            status = row["delivery_status"]
            if status != "completed":
                assert status in {"failed", "output_limited"}
                counts[status + "_episodes"] += 1
                continue
            counts["episodes"] += 1
            for step in row["trace"]["steps"]:
                if step["kind"] != "message":
                    continue
                assert step["status"] == "completed"
                index, case_id = step["index"], row["case_id"]
                learner = cases[case_id][index]["text"]
                replies = [b["text"] for msg in step["messages"] if msg["role"] == "assistant"
                           for b in msg["content"] if b["type"] == "text" and b["text"].strip()]
                docs = [u for u in row["ui_documents"] if u["step"] == index]
                assert all(u["status"] in {"rendered", "rejected"} for u in docs)
                valid = [u["document"] for u in docs if u["status"] == "rendered"]
                types = {node["type"] for document in valid for node in document["nodes"]}
                type_frequency.update(types)
                practice = learner in PRACTICE
                counts.update({
                    "turns": 1, "nonblank_turns": bool(replies), "recognized": bool(docs),
                    "valid": bool(valid), "rejected_only": bool(docs and not valid),
                    "question": "question" in types, "question_group": "question-group" in types,
                    "practice": practice, "practice_recognized": practice and bool(docs),
                    "practice_valid": practice and bool(valid), "practice_question": practice and "question" in types,
                })
                text = "\n".join(replies)
                if text and not docs and not re.search(r"```(?:keating-ui|openui)\b", text, re.I):
                    prose_lengths.append(len(text.split()))
                key = (model["id"], case_id, index)
                records.extend({"source": u["source"], "status": u["status"], "example": CLI_EXAMPLES.get(key)}
                               for u in docs)
                if key in CLI_EXAMPLES:
                    assert len(replies) == 1 and len(docs) <= 1
                    feedback = docs[0].get("recovery", {}).get("message") if docs else None
                    prior = [s["text"] for s in cases[case_id][:index] if s["kind"] == "message"]
                    examples.append(measured_example(
                        CLI_EXAMPLES[key], "cli", model["label"], case_id, index, learner, replies[0],
                        prior_learner=prior[-1] if prior else None,
                        outcome=docs[0]["status"] if docs else "no_recognized_surface",
                        components=sorted(types), document=valid[0] if valid else None,
                        feedback=feedback, source_file=CLI_FILE, episode_sha256=row["source_sha256"],
                        document_provenance="Archived terminal adapter receipt" if valid else None,
                    ))
        total.update(counts)
        models.append({"id": model["id"], "model": model["label"], **counts})
    return {
        "benchmark": "keating-teaching-v3-profiles", "version": data["version"], "exported_at": data["exported_at"],
        "cases": len(cases), "planned_episodes": len(data["models"]) * len(cases),
        "scope": "Real frozen headless Pi/CLI with authored learner messages. One result per model and case. "
                 "Only whole episodes with completed delivery are included. The source exporter replaces only eligible failed attempts.",
        "unit": "One completed learner-message step. Multiple assistant calls or documents in a step count once.",
        "definitions": {
            "recognized": "At least one model-authored canonical keating-ui source block reached the terminal adapter.",
            "valid": "At least one source block passed the shared contract and received a terminal presentation. "
                     "The receipt measures generation and validation. Browser display, clicks and tutoring continuations were unmeasured.",
            "rejected_only": "Every recognized document on the turn failed the adapter.",
            "question": "A valid document has a top-level question node.",
            "question_group": "A valid document has a top-level question-group node.",
            "practice": "The authored message exactly matches one of the three next-practice utterances listed below.",
        },
        "practice_inputs": list(PRACTICE), "practice_cases": practice_cases,
        "models": models, "totals": dict(total), "valid_turns_by_node_type": dict(sorted(type_frequency.items())),
        "rejection_replay": inspect_rejections(records),
        "unfenced_text_length": {
            "definition": "Nonblank assistant text on turns with no recognized document or literal OpenUI fence. "
                          "Count whitespace-delimited words across visible assistant text, including any Markdown and code. "
                          "These cutoffs describe length and carry no quality judgement.",
            "turns": len(prose_lengths), "median_words": statistics.median(prose_lengths),
            "at_most_75": sum(n <= 75 for n in prose_lengths), "at_least_200": sum(n >= 200 for n in prose_lengths),
        },
        "uncertainty": "Descriptive census of a fixed development suite. Turns repeat within cases and several cases share a family. "
                       "Model case coverage varies with exclusions. Traffic weights and the proportion of UI-appropriate turns are unknown.",
    }


def explicit_tasks(data):
    cases = {c["id"]: c for c in data["cases"] if "openui" in c["expect"]}
    total, by_activity, no_test = Counter(), defaultdict(Counter), Counter()
    models = []
    # Use the frozen benchmark's parser/compiler and exercise receipts, including recorded turn-limit/truncation failures.
    for model in data["models"]:
        counts = zero_counts("planned", "measured", "recognized", "compiled", "full_contract", "unavailable")
        stops = Counter()
        for row in model["rows"]:
            case_id = row["case_id"]
            checks = {c["name"]: c for c in (row.get("checks") or {}).get("checks", [])}
            compile_check = checks.get("openui.compile", {}).get("status")
            if case_id in NO_TEST_CASES:
                no_test[compile_check or "unknown"] += 1
            if case_id not in cases:
                continue
            components = cases[case_id]["expect"]["openui"]["components"]
            activity = " + ".join(c.get("mode", c["type"]) for c in components)
            measured = row["measurement_status"] == "collected"
            stages = {"planned": 1, "measured": int(measured), "unavailable": int(not measured)}
            if measured:
                assert compile_check in {"pass", "fail"}
                evidence = checks["openui.surface_count"]["evidence"]
                count = re.fullmatch(r"(\d+) recognized surface\(s\)\.", evidence) or re.fullmatch(
                    r"Expected \d+ OpenUI surface\(s\); received (\d+)\.", evidence)
                assert count, evidence
                stages.update(recognized=int(count[1]) > 0, compiled=compile_check == "pass",
                              full_contract=row["contract_passed"] is True)
            else:
                assert compile_check is None and row["contract_passed"] is None
            counts.update(stages)
            by_activity[activity].update(stages)
            stops[row["stop"]] += 1
        total.update(counts)
        models.append({"id": model["id"], "model": model["label"], **counts, "stop_reasons": dict(stops)})
    return {
        "benchmark": data["manifest"]["benchmark_id"], "version": data["manifest"]["version"],
        "created_at": data["manifest"]["created_at"], "case_ids": list(cases),
        "selection": "All frozen cases requiring an OpenUI document in expect.openui, including cases outside the OpenUI category.",
        "unit": "One authored model-case episode, with at most three assistant turns and isolated real tool execution.",
        "definitions": {
            "recognized": "The actual message parser counted at least one surface, including when the learner requested exactly one and the model supplied two.",
            "compiled": "Every recognized surface compiled according to the frozen openui.compile check.",
            "full_contract": "All case-specific objective checks passed, including requested structure, counts and applicable actions.",
        },
        "totals": dict(total), "by_requested_activity": dict(by_activity), "models": models,
        "worked_explanation_control": {
            "case_ids": sorted(NO_TEST_CASES), "checks": dict(no_test),
            "selection": "Nine learner messages explicitly declined a quiz, test, prediction, guess or follow-up, or asked to see the worked solution. "
                         "An explanatory interface could still fit. These counts do not score unwanted assessments.",
        },
        "uncertainty": "A known, fixed public benchmark. A compiled surface may have the wrong component, counts or educational content. "
                       "Some tasks explicitly name the component and some specify the interaction. No live browser, Jev or human outcome was observed.",
    }


def compile_archived_example(reply, case_id):
    # This exact published ESM bundle exposes the frozen report compiler without needing a browser.
    js = """
import {readFileSync} from 'node:fs';
import {compileMessage} from './web/public/reports/learning-to-teach/openui-preview.js';
const [reply, id] = JSON.parse(readFileSync(0, 'utf8'));
process.stdout.write(JSON.stringify(compileMessage(reply, id)));
"""
    result = subprocess.run(["rtk", "proxy", "node", "--input-type=module", "-e", js], cwd=ROOT,
                            input=json.dumps([reply, case_id]), text=True, capture_output=True, check=True)
    documents = json.loads(result.stdout)
    assert len(documents) == 1
    return documents[0]


def checkpoint_results(data, examples):
    arms = []
    for arm, label in CHECKPOINTS.items():
        counts = zero_counts("requested", "fenced", "created", "full", "controls", "unfenced_controls")
        cases = []
        for row in data[arm]:
            scenario = row["scenario"]
            reply = next(m["content"] for m in row["messages"] if m["role"] == "assistant")
            requested = bool(scenario.get("component"))
            fenced = bool(re.search(r"(?im)^\s*```openui\b", reply))
            created = row["creation"]["passed"]
            if requested:
                counts.update(requested=1, fenced=fenced, created=created, full=row["passed"])
            else:
                assert scenario["kind"] in {"identity", "arithmetic"}
                counts.update(controls=1, unfenced_controls=not fenced)
            case_id = scenario["id"]
            cases.append({"case_id": case_id, "requested_component": scenario.get("component"),
                          "fenced": fenced, "created": created if requested else None,
                          "grading": row.get("grading", {}).get("passed"), "passed": row["passed"]})
            if (arm, case_id) in CHECKPOINT_EXAMPLES:
                document = compile_archived_example(reply, case_id) if requested and created else None
                grade = row.get("grading")
                feedback = (grade or row["creation"])["feedback"]
                examples.append(measured_example(
                    CHECKPOINT_EXAMPLES[(arm, case_id)], "checkpoints", label, case_id, 0, scenario["prompt"], reply,
                    outcome=("grading_failed" if grade and not grade["passed"] else "passed") if created else "creation_failed",
                    components=[n["type"] for n in document["nodes"]] if document else [],
                    document=document, feedback=feedback, creation_feedback=row["creation"]["feedback"],
                    grading=grade["passed"] if grade else None,
                    document_provenance="Recompiled original reply with the hash-pinned public report compiler" if document else None,
                    source_file=TEACHING_FILE, source_pointer=f"interaction_round.{arm}[scenario.id={case_id}].messages",
                ))
        arms.append({"id": arm, "model": label, **counts, "cases": cases})
    return {
        "benchmark": "Inkling OpenUI interaction evaluation", "date": "2026-09-06",
        "system_prompt_sha256": data["system_prompt_sha256"],
        "unit": "One predeclared, evaluation-only scenario for one checkpoint. All five activity prompts name OpenUI and the component.",
        "definitions": {"fenced": "First assistant output contains a line opening an OpenUI fence.",
                        "created": "Original creation and component checks succeeded.",
                        "full": "All task checks passed, including pending-answer grading or simulated interaction when required.",
                        "unfenced_controls": "Identity or multiplication response had no OpenUI fence."},
        "models": arms,
        "uncertainty": "The five named activity tasks are one per family. Success on them measures instructed capability. "
                       "The two text controls are small regression checks. No learner chose these tasks or supplied the synthetic answers.",
    }


def measure():
    for name, expected in PINS.items():
        if digest((ROOT / name).read_bytes()) != expected:
            raise ValueError(f"Source digest changed for {name}")
    cli = json.loads((ROOT / CLI_FILE).read_bytes())
    teaching = json.loads((ROOT / TEACHING_FILE).read_bytes())
    examples = []
    return {
        "schema_version": 1, "source_files": PINS,
        "cli": cli_results(cli, examples), "explicit_tasks": explicit_tasks(teaching["benchmark_v2"]),
        "checkpoints": checkpoint_results(teaching["interaction_round"], examples),
        "examples": sorted(examples, key=lambda e: e["id"]),
        "jev_decision_utilization": None,
        "jev_coverage": "These three tutor evaluations have no paired record of a Jev decision being shown to the tutor. "
                        "No model-following rate or production traffic estimate can be calculated from them.",
    }


if __name__ == "__main__":
    encoded = json.dumps(measure(), ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    if sys.argv[1:] == ["--check"]:
        if encoded != Path(__file__).with_name("summary.json").read_text():
            raise SystemExit("summary.json differs from the recounted evidence")
        print("Historical counts and response hashes match summary.json")
    elif sys.argv[1:]:
        raise SystemExit("Use --check to verify summary.json, or redirect standard output to generate it.")
    else:
        sys.stdout.write(encoded)
