# /// script
# requires-python = ">=3.12"
# dependencies = ["pandas==2.*", "numpy>=2,<3", "matplotlib==3.10.*"]
# ///
"""Offline paired checkpoint report. Reads evidence; never scores, samples or trains."""
from __future__ import annotations

import argparse
from collections import Counter
from copy import deepcopy
import hashlib
import html
import json
import math
from pathlib import Path
import re
import subprocess

from native_training import native_hash

ARMS = ("original_checkpoint", "updated_checkpoint")
REPO = Path(__file__).resolve().parents[2]
LIMITATIONS = [
    "These are authored task-level behavioral diagnostics, not human learning or causal efficacy evidence.",
    "One generation per case and arm supplies no independent replication; criteria and tokens are not independent people or situations.",
    "Only criterion pairs with two observed judgments have a paired difference. Missing outputs or judgments remain unknown.",
    "Completion diagnostics compare pre-optimizer student forward scores with original behavior scores on the same completion tokens. They do not measure the updated checkpoint's probability change.",
    "Raw provider loss_metrics have an unverified reduction scope and may include masked prompt positions with zero-padded behavior scores. They are not completion-only diagnostics.",
    "Content hashes check supplied evidence integrity, not reviewer independence, truthful capture, or complete provenance. source_file values are displayed, never followed.",
    "The fixed chat prompt tests one condition; it does not establish native tool behavior, population coverage, or a reliable training effect.",
]


def require_report_evidence(condition, message):
    if not condition:
        raise ValueError(message)


def read_report_evidence(path):
    """Read one local snapshot, rejecting ambiguous duplicate JSON keys."""
    raw = Path(path).read_bytes()

    def unique_object(pairs):
        result = {}
        for key, value in pairs:
            require_report_evidence(key not in result, f"duplicate JSON key: {key}")
            result[key] = value
        return result

    def reject_constant(value):
        raise ValueError(f"nonfinite JSON constant: {value}")

    value = json.loads(raw, object_pairs_hook=unique_object, parse_constant=reject_constant)
    require_report_evidence(type(value) is dict, "expected JSON object")
    return value, hashlib.sha256(raw).hexdigest()


def check_report_seal(value, field):
    require_report_evidence(type(value) is dict and type(value.get(field)) is str
        and value[field] == native_hash({k: v for k, v in value.items() if k != field}),
        f"invalid {field}")


def collect_update_diagnostics(update, plan=None):
    """Completion-only math; raw provider reductions are deliberately separate."""
    check_report_seal(update, "result_hash")
    require_report_evidence(type(update.get("schema_version")) is int and update["schema_version"] == 1,
                            "update schema_version must be 1")
    epsilon = None
    if plan is not None:
        check_report_seal(plan, "plan_hash")
        require_report_evidence(plan["plan_hash"] == update.get("plan_hash"), "update/plan hash mismatch")
        config = plan.get("config", {})
        require_report_evidence(config.get("method") == "ppo", "expected PPO update plan")
        epsilon = config.get("epsilon")
        require_report_evidence(type(epsilon) in (int, float) and math.isfinite(epsilon)
                                and 0 < epsilon < 1, "invalid recorded PPO epsilon")
    records = update.get("score_records")
    require_report_evidence(type(records) is list, "score_records must be a list")
    captures, summaries, token_rows = set(), [], []
    for record in records:
        require_report_evidence(type(record) is dict, "invalid score record")
        capture = record.get("capture_hash")
        require_report_evidence(type(capture) is str and re.fullmatch(r"[0-9a-f]{64}", capture)
                                and capture not in captures, "unknown or duplicate score capture")
        captures.add(capture)
        ids = record.get("completion_token_ids")
        require_report_evidence(type(ids) is list and ids
            and all(type(t) is int and 0 <= t < 2**31 for t in ids), "invalid completion token IDs")
        vectors = [record.get(key) for key in ("student_logprobs", "behavior_logprobs", "detached_advantages")]
        for index, vector in enumerate(vectors):
            require_report_evidence(type(vector) is list and len(vector) == len(ids)
                and all(type(v) in (int, float) and math.isfinite(v) and abs(v) <= 1e100
                        and (index == 2 or v <= 0) for v in vector), "unaligned or invalid score vectors")
        rows = []
        for position, (token, student, behavior, advantage) in enumerate(zip(ids, *vectors)):
            delta = student - behavior
            try:
                ratio = math.exp(delta)
            except OverflowError:
                raise ValueError("nonfinite completion probability ratio") from None
            require_report_evidence(math.isfinite(ratio), "nonfinite completion probability ratio")
            outside = clipped = None
            if epsilon is not None:
                outside = ratio < 1 - epsilon or ratio > 1 + epsilon
                clipped = (advantage > 0 and ratio > 1 + epsilon) or (advantage < 0 and ratio < 1 - epsilon)
            rows.append({"capture_hash": capture, "position": position, "token_id": token,
                         "student_minus_behavior_logprob": delta,
                         "student_minus_behavior_probability": math.exp(student) - math.exp(behavior),
                         "probability_ratio": ratio, "advantage": advantage,
                         "ratio_outside_clip_bounds": outside, "surrogate_clipped": clipped})
        token_rows.extend(rows)
        summaries.append({"capture_hash": capture, "completion_tokens": len(rows),
            "student_model": record.get("student_model"), "behavior_model": record.get("behavior_model"),
            "mean_student_minus_behavior_logprob": math.fsum(r["student_minus_behavior_logprob"] / len(rows) for r in rows),
            "mean_student_minus_behavior_probability": math.fsum(r["student_minus_behavior_probability"] / len(rows) for r in rows),
            "max_abs_log_ratio": max(abs(r["student_minus_behavior_logprob"]) for r in rows),
            "mean_probability_ratio": math.fsum(r["probability_ratio"] / len(rows) for r in rows),
            "half_mean_squared_log_ratio": math.fsum(.5 * r["student_minus_behavior_logprob"]**2 / len(rows) for r in rows),
            "fraction_ratio_outside_bounds": None if epsilon is None else sum(r["ratio_outside_clip_bounds"] for r in rows) / len(rows),
            "fraction_surrogate_clipped": None if epsilon is None else sum(r["surrogate_clipped"] for r in rows) / len(rows),
            "negative_advantage_tokens": sum(r["advantage"] < 0 for r in rows),
            "zero_advantage_tokens": sum(r["advantage"] == 0 for r in rows),
            "positive_advantage_tokens": sum(r["advantage"] > 0 for r in rows)})
    raw_metrics = update.get("loss_metrics", {})
    require_report_evidence(type(raw_metrics) is dict and all(type(v) in (int, float)
        and math.isfinite(v) for v in raw_metrics.values()), "invalid raw provider metrics")
    return {"status": update.get("status"), "optimizer_acknowledged": update.get("optimizer_acknowledged"),
            "sampler_checkpoint": update.get("sampler_checkpoint"), "result_hash": update["result_hash"],
            "plan_hash": update.get("plan_hash"), "epsilon": epsilon,
            "clip_threshold_status": "verified_plan" if epsilon is not None else "unknown_no_plan",
            "score_phase": "pre_optimizer_student_vs_original_behavior",
            "completion_tokens": len(token_rows), "captures": summaries, "tokens": token_rows,
            "raw_provider_metrics": deepcopy(raw_metrics), "provider_reduction_scope": "unverified"}


def build_update_report(suite, evaluation, reviews, update, *, suite_sha256, plan=None):
    """Join exact planned case/arm identities, retaining every missing slot."""
    for name, value in (("suite", suite), ("evaluation", evaluation), ("reviews", reviews)):
        require_report_evidence(type(value) is dict and type(value.get("schema_version")) is int
                                and value["schema_version"] == 1, f"invalid {name} schema_version")
    require_report_evidence(evaluation.get("suite_sha256") == suite_sha256, "suite byte hash mismatch")
    if "result_hash" in evaluation:
        check_report_seal(evaluation, "result_hash")
    if "suite_sha256" in reviews:
        require_report_evidence(reviews["suite_sha256"] == suite_sha256, "review suite hash mismatch")
    arms = evaluation.get("arms")
    require_report_evidence(type(arms) is dict and set(arms) == set(ARMS), "unknown or missing evaluation arm")
    require_report_evidence(all(type(uri) is str and re.fullmatch(
        r"tinker://[A-Za-z0-9_-]+(?::[A-Za-z0-9_-]+)*/sampler_weights/[A-Za-z0-9_.-]+", uri)
        for uri in arms.values()) and len(set(arms.values())) == 2, "distinct immutable sampler URIs required")
    comparison = suite.get("comparison", {})
    require_report_evidence(comparison.get("arms") == list(ARMS)
        and comparison.get("replicates_per_case_per_arm") == 1, "expected one paired generation per case/arm")
    for arm, uri in comparison.get("checkpoint_uris", {}).items():
        require_report_evidence(arm in ARMS and (uri is None or uri == arms[arm]), "suite checkpoint mismatch")
    cases = suite.get("cases")
    require_report_evidence(type(cases) is list and cases, "suite cases required")
    case_map, criteria_map = {}, {}
    for case in cases:
        require_report_evidence(type(case) is dict and type(case.get("id")) is str
            and case["id"] and case["id"] not in case_map and type(case.get("family")) is str
            and case["family"], "unknown or duplicate suite case")
        require_report_evidence(type(case.get("actor", {}).get("opening_message")) is str, "missing task text")
        criteria = case.get("evaluation_only", {}).get("criteria")
        require_report_evidence(type(criteria) is list and criteria, "private criteria required")
        ids = []
        for criterion in criteria:
            require_report_evidence(type(criterion) is dict and type(criterion.get("id")) is str
                and criterion["id"] and type(criterion.get("pass_when")) is str, "invalid criterion")
            ids.append(criterion["id"])
        require_report_evidence(len(set(ids)) == len(ids), "duplicate suite criterion")
        case_map[case["id"]], criteria_map[case["id"]] = case, ids
    planned_keys = {(case_id, arm) for case_id in case_map for arm in ARMS}
    order = comparison.get("execution_order")
    require_report_evidence(type(order) is list and all(type(r) is dict for r in order)
        and len(order) == len(planned_keys)
        and {(r.get("case_id"), r.get("arm")) for r in order} == planned_keys
        and comparison.get("planned_generations") == len(planned_keys), "invalid planned pairing")
    result_map, review_map = {}, {}
    for name, document, target in (("result", evaluation, result_map), ("review", reviews, review_map)):
        require_report_evidence(type(document.get("rows")) is list, f"{name} rows must be a list")
        for row in document["rows"]:
            require_report_evidence(type(row) is dict and type(row.get("case_id")) is str
                and type(row.get("arm")) is str, f"invalid {name} row")
            key = (row["case_id"], row["arm"])
            require_report_evidence(key in planned_keys and key not in target, f"unknown or duplicate {name} row")
            target[key] = row
    normalized = []
    for case_id, case in case_map.items():
        for arm in ARMS:
            key = (case_id, arm)
            row, review = result_map.get(key), review_map.get(key)
            status, response, error, source = "unattempted", None, None, None
            usage = {field: None for field in ("prompt_tokens", "completion_tokens", "total_tokens")}
            if row is not None:
                require_report_evidence(set(row) == {"case_id", "arm", "status", "response", "error_type", "source_file"},
                                        "invalid result row fields")
                status, response, error, source = (row[k] for k in ("status", "response", "error_type", "source_file"))
                require_report_evidence(type(source) is str and source, "source_file provenance required")
                require_report_evidence(status in ("returned", "failed"), "unknown result status")
                if status == "failed":
                    require_report_evidence(response is None and type(error) is str and error, "failed result must have null response and error_type")
                else:
                    require_report_evidence(error is None and type(response) is dict, "returned result must have completion and null error_type")
                    choices = response.get("choices")
                    require_report_evidence(type(choices) is list and len(choices) == 1
                        and type(choices[0]) is dict and type(choices[0].get("message")) is dict
                        and choices[0]["message"].get("role") == "assistant", "expected one OpenAI assistant completion")
                    raw_usage = response.get("usage")
                    raw_usage = {} if raw_usage is None else raw_usage
                    require_report_evidence(type(raw_usage) is dict, "invalid completion usage")
                    for field in usage:
                        value = raw_usage.get(field)
                        require_report_evidence(value is None or type(value) is int and value >= 0, "invalid usage token count")
                        usage[field] = value
                    if all(value is not None for value in usage.values()):
                        require_report_evidence(usage["total_tokens"] == usage["prompt_tokens"] + usage["completion_tokens"], "inconsistent usage totals")
            judgments = dict.fromkeys(criteria_map[case_id])
            if review is not None:
                require_report_evidence(set(review) == {"case_id", "arm", "criteria", "rationale"}
                    and type(review["rationale"]) is str and type(review["criteria"]) is dict,
                    "invalid review fields")
                require_report_evidence(set(review["criteria"]) <= set(judgments)
                    and all(v is None or type(v) is bool for v in review["criteria"].values()), "unknown criterion or non-boolean review")
                judgments.update(review["criteria"])
                require_report_evidence(status == "returned" or all(v is None for v in judgments.values()), "judgment without returned evidence")
            known = sum(v is not None for v in judgments.values())
            normalized.append({"case_id": case_id, "family": case["family"], "category": case.get("category"),
                "arm": arm, "status": status, "response": deepcopy(response), "error_type": error, "source_file": source,
                **usage, "criteria": judgments, "criterion_slots": len(judgments), "known_criteria": known,
                "pass_count": sum(v is True for v in judgments.values()) if known else None,
                "fail_count": sum(v is False for v in judgments.values()) if known else None,
                "unknown_count": len(judgments) - known, "review_present": review is not None,
                "rationale": review["rationale"] if review else None})
    denominators = []
    for arm in ARMS:
        rows = [r for r in normalized if r["arm"] == arm]
        counts = Counter(r["status"] for r in rows)
        denominators.append({"arm": arm, "planned": len(rows), "attempted": counts["returned"] + counts["failed"],
            "returned": counts["returned"], "failed": counts["failed"], "unattempted": counts["unattempted"],
            "returned_with_no_known_review": sum(r["status"] == "returned" and r["known_criteria"] == 0 for r in rows),
            "returned_with_partial_review": sum(0 < r["known_criteria"] < r["criterion_slots"] for r in rows),
            "criterion_slots": sum(r["criterion_slots"] for r in rows),
            "known_criteria": sum(r["known_criteria"] for r in rows),
            "unknown_criteria": sum(r["unknown_count"] for r in rows),
            "completion_usage_known": sum(r["completion_tokens"] is not None for r in rows)})
    normalized_map = {(r["case_id"], r["arm"]): r for r in normalized}
    paired = []
    for case_id, ids in criteria_map.items():
        old, new = (normalized_map[case_id, arm]["criteria"] for arm in ARMS)
        deltas = {k: int(new[k]) - int(old[k]) if old[k] is not None and new[k] is not None else None for k in ids}
        observed = [v for v in deltas.values() if v is not None]
        paired.append({"case_id": case_id, "family": case_map[case_id]["family"],
            "paired_criteria": len(observed), "criterion_slots": len(ids), "deltas": deltas,
            "matched_pass_count_difference": sum(observed) if observed else None})
    diagnostics = collect_update_diagnostics(update, plan)
    if update.get("sampler_checkpoint") is not None:
        require_report_evidence(arms["updated_checkpoint"] == update["sampler_checkpoint"], "evaluation/update checkpoint mismatch")
    family_groups = {}
    for case in cases:
        family_groups.setdefault(case["family"], []).append(case["id"])
    all_paired = all(row["paired_criteria"] == row["criterion_slots"] for row in paired)
    all_tied = all_paired and all(v == 0 for row in paired for v in row["deltas"].values())
    observations = [{"case_id": row["case_id"], "arm": row["arm"], "rationale": row["rationale"],
        "origin": "supplied_review_rationale", "changes_frozen_scores": False}
        for row in normalized if row["rationale"]]
    return {"schema_version": 1, "kind": "native-update-report", "suite_id": suite.get("id"),
        "suite_sha256": suite_sha256, "arms": deepcopy(arms), "cases": deepcopy(cases),
        "rows": normalized, "denominators": denominators, "paired": paired,
        "families": [{"family": family, "case_ids": ids} for family, ids in family_groups.items()],
        "independent_family_count": len(family_groups), "update": diagnostics, "limitations": list(LIMITATIONS),
        "headline": "No detected improvement on the frozen rubric" if all_tied else "Paired frozen-criterion observations",
        "complete_paired_cases": sum(row["paired_criteria"] == row["criterion_slots"] for row in paired),
        "fully_observed_tied_cases": sum(row["paired_criteria"] == row["criterion_slots"]
            and all(v == 0 for v in row["deltas"].values()) for row in paired),
        "reviewer": deepcopy(reviews.get("reviewer")), "posthoc_reviewer_observations": observations}


def load_update_report(suite, evaluation, reviews, update):
    inputs, values = {}, {}
    for name, path in (("suite", suite), ("evaluation", evaluation), ("reviews", reviews), ("update", update)):
        path = Path(path)
        if name == "reviews" and not path.exists():
            values[name], digest = {"schema_version": 1, "rows": []}, None
        else:
            values[name], digest = read_report_evidence(path)
        inputs[name] = {"path": str(path.resolve()), "sha256": digest, "status": "missing" if digest is None else "read"}
    plan_path = Path(update).parent / "plan.json"
    plan = None
    if plan_path.exists():
        plan, digest = read_report_evidence(plan_path)
        inputs["update_plan"] = {"path": str(plan_path.resolve()), "sha256": digest, "status": "read"}
    report = build_update_report(**values, suite_sha256=inputs["suite"]["sha256"], plan=plan)
    report["inputs"] = inputs
    report["report_hash"] = native_hash(report)
    return report


def plot_update_report(report):
    """Figures from validated observations only; absent measurements are labeled."""
    import matplotlib.pyplot as plt
    import numpy as np
    import pandas as pd
    plt.rcParams.update({"font.family": "DejaVu Sans", "axes.spines.top": False,
        "axes.spines.right": False, "svg.hashsalt": "keating-native-update-v1"})
    frame = pd.DataFrame(report["rows"])
    labels = [c["id"].replace("authored-", "").replace("-", "\n", 2) for c in report["cases"]]
    x = np.arange(len(labels))
    figures = {}
    fig, ax = plt.subplots(figsize=(10, 5))
    for index, arm in enumerate(ARMS):
        rows = frame[frame.arm == arm]
        bottom = np.zeros(len(rows))
        for field, label, color in (("pass_count", "Pass", "#00836B"), ("fail_count", "Fail", "#C97900"), ("unknown_count", "Unknown", "#dce4e8")):
            values = rows[field].fillna(0).to_numpy(dtype=float)
            ax.bar(x + (index - .5) * .36, values, .34, bottom=bottom, color=color,
                edgecolor="#536570", linewidth=.5, hatch="//" if index else None,
                label=label if index == 0 else None)
            bottom += values
    ax.set_xticks(x, labels)
    ax.set_ylabel("Declared criteria (unknown is not failure)")
    ax.set_title("Original (left, solid) vs updated (right, hatched)")
    ax.legend(loc="upper right")
    fig.tight_layout()
    figures["criteria"] = fig
    fig, axes = plt.subplots(1, 2, figsize=(12, 4.8))
    for ax, field in zip(axes, ("prompt_tokens", "completion_tokens")):
        for index, arm in enumerate(ARMS):
            values = frame[frame.arm == arm][field].to_numpy(dtype=float, na_value=np.nan)
            positions = x + (index - .5) * .36
            ax.bar(positions, values, .34, color=("#0072B2", "#00836B")[index], label=arm.replace("_checkpoint", ""))
            for pos, value in zip(positions, values):
                if np.isnan(value):
                    ax.annotate("unknown", (pos, 0), rotation=90, va="bottom", ha="center", fontsize=8)
        ax.set_xticks(x, labels, fontsize=8)
        ax.set_title(field.replace("_", " ").capitalize())
        ax.set_ylabel("Provider-reported usage tokens")
        ax.legend()
    fig.tight_layout()
    figures["tokens"] = fig
    fig, axes = plt.subplots(3, 1, figsize=(11, 9), sharex=True)
    tokens = pd.DataFrame(report["update"]["tokens"])
    if tokens.empty:
        for ax in axes:
            ax.text(.5, .5, "No completion score records — unknown", transform=ax.transAxes, ha="center")
    else:
        for capture, group in tokens.groupby("capture_hash", sort=False):
            for ax, field in zip(axes, ("student_minus_behavior_logprob", "student_minus_behavior_probability", "probability_ratio")):
                ax.plot(group.position, group[field], label=capture[:12], alpha=.8, linewidth=.8)
        for ax in axes[:2]:
            ax.axhline(0, color="#596c75", linewidth=.7)
        axes[2].axhline(1, color="#596c75", linewidth=.7)
        epsilon = report["update"]["epsilon"]
        if epsilon is not None:
            for bound in (1 - epsilon, 1 + epsilon):
                axes[2].axhline(bound, color="#C97900", linestyle="--", label=f"clip bound {bound:g}")
        else:
            axes[2].text(.02, .96, "Clip bounds unknown: verified plan absent", transform=axes[2].transAxes, va="top")
        axes[0].legend(title="Capture", fontsize=8)
        axes[2].legend(fontsize=8) if epsilon is not None else None
    for ax, label in zip(axes, ("log p(student) − log p(behavior)", "p(student) − p(behavior)", "p(student) / p(behavior)")):
        ax.set_ylabel(label)
    axes[0].set_title("Completion-only, pre-optimizer student vs original behavior")
    axes[2].set_xlabel("Original completion token position (per capture)")
    fig.tight_layout()
    figures["completion-diagnostics"] = fig
    return figures


def write_update_report(report, output):
    """Write a new private ignored directory; never overwrite source artifacts."""
    check_report_seal(report, "report_hash")
    output = Path(output).resolve()
    require_report_evidence(output.is_relative_to(REPO / ".keating"), "output must be inside ignored .keating/")
    ignored = subprocess.run(["git", "check-ignore", "-q", "--", str(output)], cwd=REPO, check=False)
    require_report_evidence(ignored.returncode == 0, "output must be gitignored")
    output.mkdir(parents=True, mode=0o700, exist_ok=False)
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    figures = plot_update_report(report)
    esc = html.escape

    def table(rows):
        if not rows:
            return "<p>Unknown — no records.</p>"
        keys = list(rows[0])
        head = "".join(f"<th>{esc(k.replace('_', ' '))}</th>" for k in keys)
        body = "".join("<tr>" + "".join(f"<td>{esc('unknown' if row.get(k) is None else str(row[k]))}</td>" for k in keys) + "</tr>" for row in rows)
        return f'<div class="table"><table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table></div>'

    charts = []
    try:
        for name, figure in figures.items():
            for suffix in ("png", "svg"):
                path = output / f"{name}.{suffix}"
                figure.savefig(path, dpi=150, metadata={"Date": None} if suffix == "svg" else None)
                path.chmod(0o600)
            svg = (output / f"{name}.svg").read_text()
            charts.append(f'<figure>{svg[svg.index("<svg"):]}<figcaption>{esc(name)} · '
                          f'<a href="{name}.png">PNG</a> · <a href="{name}.svg">SVG</a></figcaption></figure>')
    finally:
        for figure in figures.values():
            plt.close(figure)
    per_case = []
    for case in report["cases"]:
        per_case.append(f'<article><h3>{esc(case["id"])}</h3><p>Family: {esc(case["family"])}</p><blockquote>{esc(case["actor"]["opening_message"])}</blockquote>')
        per_case.append(table(case["evaluation_only"]["criteria"]))
        rows = [r for r in report["rows"] if r["case_id"] == case["id"]]
        per_case.append(table([{k: r[k] for k in ("arm", "status", "known_criteria", "criterion_slots", "pass_count", "fail_count", "unknown_count")} for r in rows]))
        for row in rows:
            per_case.append(f'<details><summary>{esc(row["arm"])} — {esc(row["status"])}</summary>'
                f'<p>Source: {esc(row["source_file"] or "unknown")}</p><p>Error: {esc(row["error_type"] or "none recorded")}</p>'
                f'<pre>{esc(json.dumps(row["response"], indent=2, ensure_ascii=False))}</pre>'
                f'<p>Review: {esc(row["rationale"] if row["rationale"] is not None else "unknown")}</p>'
                + table([{"criterion": k, "judgment": v} for k, v in row["criteria"].items()]) + '</details>')
        per_case.append('</article>')
    diagnostics = report["update"]
    metrics = [{k: v for k, v in row.items() if k not in ("student_model", "behavior_model")} for row in diagnostics["captures"]]
    paired = [{k: v for k, v in row.items() if k != "deltas"} for row in report["paired"]]
    body = f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<title>Native PPO checkpoint comparison</title><style>
body{{max-width:1150px;margin:40px auto;padding:0 24px;background:#fcfcf9;color:#172e3d;font:16px/1.6 system-ui}}h1{{font-size:36px;line-height:1.15}}h2{{margin-top:48px;color:#176b67}}article,aside{{background:#eef5f3;padding:20px;margin:24px 0}}.table{{overflow:auto}}table{{border-collapse:collapse;font-size:13px;width:100%}}td,th{{text-align:left;vertical-align:top;border:1px solid #cedcd9;padding:9px;overflow-wrap:anywhere}}pre{{white-space:pre-wrap;overflow-wrap:anywhere}}figure{{margin:25px 0}}figure svg{{width:100%;height:auto}}a{{color:#176b67}}blockquote{{margin:12px 0;padding-left:16px;border-left:3px solid #176b67}}summary{{cursor:pointer;padding:10px 0}}code{{overflow-wrap:anywhere}}</style></head><body>
<h1>{esc(report['headline'])}</h1><p>Native PPO checkpoint comparison · {len(report['cases'])} authored cases · {report['independent_family_count']} source families · {report['fully_observed_tied_cases']} fully observed criterion ties</p>
<aside><strong>Behavioral diagnostic only.</strong> This report does not establish human learning or causal efficacy. Missing evidence stays unknown.</aside>
<h2>Rubric blind spots and post-hoc reviewer observations</h2><p><strong>Frozen criterion passes are not an overall correctness verdict.</strong> The supplied rationales below may identify factual errors outside the frozen criteria. They are reproduced verbatim, separately from the scores; no criterion or rating is changed. Reviewer: {esc(json.dumps(report['reviewer'], ensure_ascii=False))}.</p>
{''.join(f'<article><strong>{esc(o["case_id"])} · {esc(o["arm"])}</strong><p>{esc(o["rationale"])}</p></article>' for o in report['posthoc_reviewer_observations']) or '<p>Unknown — no reviewer observations supplied.</p>'}
<p>Update status: <strong>{esc(str(diagnostics['status']))}</strong>; optimizer acknowledged: {esc(str(diagnostics['optimizer_acknowledged']))}.</p>
{table([{'arm': k, 'immutable_checkpoint': v} for k,v in report['arms'].items()])}
<h2>Planned and observed denominators</h2>{table(report['denominators'])}
<h2>Criterion judgments</h2>{charts[0]}<p>Pass/fail counts describe known judgments only. Gray slots are unknown, including unavailable responses. Compare only matched criteria below.</p>{table(paired)}
<h2>Reported token usage</h2>{charts[1]}<p>Missing provider usage is unknown; response text is never retokenized to invent counts.</p>
<h2>Completion-only update diagnostics</h2>{charts[2]}{table(metrics)}
<p>Each row uses exactly its recorded completion tokens. Ratio-outside fraction counts either bound; surrogate-clipped fraction also uses the advantage sign. Half mean squared log-ratio is a sampled diagnostic, not exact distribution KL. Epsilon: {esc(str(diagnostics['epsilon']))} ({esc(diagnostics['clip_threshold_status'])}).</p>
<h2>Raw provider metrics — reduction scope unverified</h2><p>These may include masked prompt positions and zero-padded behavior scores. Do not read them as completion-only or post-update measurements.</p>{table([{'metric':k,'raw_value':v} for k,v in diagnostics['raw_provider_metrics'].items()])}
<h2>Tasks, observed responses and private reviews</h2>{''.join(per_case)}
<h2>Limitations</h2><ul>{''.join(f'<li>{esc(item)}</li>' for item in report['limitations'])}</ul>
<h2>Input provenance</h2>{table([{'input':k,**v} for k,v in report.get('inputs',{}).items()])}
<p>Report hash: <code>{report['report_hash']}</code>. <a href="report.json">Machine-readable report</a>. No inference, model judging or billing was performed by this reporter.</p></body></html>'''
    for name, content in (("index.html", body), ("report.json", json.dumps(report, indent=2, ensure_ascii=False, allow_nan=False) + "\n")):
        path = output / name
        path.write_text(content)
        path.chmod(0o600)
    return output / "index.html"


def native_update_report_main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("suite", "evaluation", "reviews", "update", "output"):
        parser.add_argument(f"--{name}", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        report = load_update_report(args.suite, args.evaluation, args.reviews, args.update)
        print(write_update_report(report, args.output))
    except (ValueError, OSError) as error:
        parser.exit(2, f"Invalid or unavailable report evidence: {error}\n")


if __name__ == "__main__":
    native_update_report_main()
