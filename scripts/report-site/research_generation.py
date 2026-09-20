"""Render the actual controlled-generation comparison from reviewed public data."""
from collections import Counter
import html

CONDITIONS = {
    "baseline": "Baseline",
    "selected_positive": "Selected direction +",
    "selected_negative": "Selected direction −",
    "random": "Random direction",
    "unrelated": "Comparison feature",
}
CRITERIA = {"correctness": "Correctness", "request_match": "Matches request", "no_unwarranted_claims": "Supported claims"}


def validate_generation_data(data):
    rows = data["rows"]
    n = len({r["case_id"] for r in rows})
    assert 1 <= n <= 8 and len(rows) == 5 * n and len({r["id"] for r in rows}) == len(rows)
    assert Counter(r["condition"] for r in rows) == {key: n for key in CONDITIONS}
    assert all({r["condition"] for r in rows if r["case_id"] == case_id} == set(CONDITIONS) for case_id in {r["case_id"] for r in rows})
    for row in rows:
        assert row["generated_token_count"] == len(row["generated_ids"])
        assert row["stop_reason"] in {"eos", "max_new_tokens"}
        assert set(row["criteria"]) == set(CRITERIA)
        baseline = next(r for r in rows if r["case_id"] == row["case_id"] and r["condition"] == "baseline")
        assert row["identical_to_baseline"] == (row["generated_ids"] == baseline["generated_ids"])
        for item in [*row["criteria"].values(), row["all_three"]]:
            reviews = item["reviews"]
            assert len(reviews) == 2
            assert item["consensus"]["verdict"] == (reviews[0]["verdict"] if reviews[0]["verdict"] == reviews[1]["verdict"] else "unknown")
    for total in data["totals"]:
        assert total["denominator"] == total["numerator"] + total["fail"] + total["unknown"]


def _response(row):
    escape = html.escape
    changed = "Identical token sequence" if row["identical_to_baseline"] else f'First changed token: {row["first_divergent_position"] + 1}'
    stop = "96-token limit reached" if row["stop_reason"] == "max_new_tokens" else "End-of-sequence token"
    judgments = []
    for key, label in CRITERIA.items():
        item = row["criteria"][key]
        cells = "".join(f'<td>{escape(r["verdict"])}</td>' for r in item["reviews"])
        judgments.append(f'<tr><th>{label}</th>{cells}<td>{escape(item["consensus"]["verdict"])}</td></tr>')
    reasons = "".join(f'<h5>{label}</h5>' + "".join(
        f'<p><strong>Reviewer {i + 1}:</strong> {escape(r["reason"])}</p>'
        for i, r in enumerate(row["criteria"][key]["reviews"])) for key, label in CRITERIA.items())
    return f'''<p class="record-meta">{row['generated_token_count']} tokens · {stop}<br>{changed}</p>
    <pre class="verbatim" data-generated-text>{escape(row['raw_output'])}</pre>
    <div class="table-scroll generation-grades"><table><thead><tr><th>Criterion</th><th>R1</th><th>R2</th><th>Agreement</th></tr></thead><tbody>{''.join(judgments)}</tbody></table></div>
    <details><summary>Read the two reviews</summary>{reasons}</details>
    <details><summary>Inspect original token IDs</summary><p class="record-meta">{escape(str(row['generated_ids']))}</p></details>'''


def render_generation_inspector(data):
    validate_generation_data(data)
    rows = data["rows"]
    cases = sorted({r["case_id"] for r in rows})
    panels, options = [], []
    for case_id in cases:
        case_rows = {r["condition"]: r for r in rows if r["case_id"] == case_id}
        baseline = case_rows["baseline"]
        title = baseline["family_id"].replace("-", " ").capitalize()
        options.append(f'<option value="{case_id}">{html.escape(title)}</option>')
        alternatives = "".join(f'<div data-generation-condition="{key}"><h4>{label}</h4>{_response(case_rows[key])}</div>' for key, label in CONDITIONS.items())
        panels.append(f'''<section data-generation-case="{case_id}"><h3 class="record-heading">{html.escape(title)}</h3>
        <div class="probe-text"><strong>Learner request</strong><p>{html.escape(baseline['learner_prompt'])}</p></div>
        <div class="pair"><div class="evidence-pane"><h4>Baseline</h4>{_response(baseline)}</div>
        <div class="evidence-pane native">{alternatives}</div></div></section>''')
    choices = "".join(f'<option value="{key}"{(" selected" if key == "selected_negative" else "")}>{label}</option>' for key, label in CONDITIONS.items())
    return f'''<section class="inspector" id="generation-workbench" aria-label="Inspect controlled generation">
    <div class="inspector-tools js-only"><label>Choose a task<select id="generation-task">{''.join(options)}</select></label>
    <label>Compare with baseline<select id="generation-condition">{choices}</select></label><a href="generation-examples.json" download>Download all {len(rows)} outputs</a></div>
    <p class="review-note">Exact generated text, including special tokens and cutoffs. The two reviewers received the learner request, frozen criteria and anonymized output. R1 and R2 are their separate judgments; disagreements remain unknown.</p>
    {''.join(panels)}</section>'''


def render_generation_figure(data, output):
    validate_generation_data(data)
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    plt.rcParams.update({"font.family": "DejaVu Sans", "svg.hashsalt": "keating-generation-outcomes-v1"})
    fig, axes = plt.subplots(1, 3, figsize=(12, 4.8))
    labels = list(CONDITIONS.values())
    task_count = len({r["case_id"] for r in data["rows"]})
    hint_count = len({r["case_id"] for r in data["rows"] if r["category"] == "hint"})
    for i, (ax, category, metric, title, denominator) in enumerate(zip(axes,
            ["hint", "all", "all"], ["request_match", "correctness", "changed"],
            ["Matches hint request", "Correct response", "Changed token sequence"], [hint_count, task_count, task_count])):
        for y, condition in enumerate(CONDITIONS):
            if metric == "changed":
                value = sum(not r["identical_to_baseline"] for r in data["rows"] if r["condition"] == condition)
                unknown = 0
            else:
                total = next(t for t in data["totals"] if t["reviewer"] == "consensus" and t["condition"] == condition and t["category"] == category and t["metric"] == metric)
                value, unknown = total["numerator"], total["unknown"]
            ax.barh(y, value, color="#00836B" if condition != "baseline" else "#89969C", height=.55)
            ax.plot([value], [y], "o", color="#254e63", markersize=3)
            ax.text(value + .13, y, f"{value}/{denominator}" + (f" · {unknown} unknown" if unknown else ""), va="center", fontsize=9, color="#254e63")
        ax.set_yticks(range(5), labels if i == 0 else [""] * 5)
        ax.set_ylim(4.7, -.7)
        ax.set_xlim(0, denominator + 2.8)
        ax.set_xticks(sorted({0, denominator // 2, denominator}))
        ax.set_title(title, loc="left", fontsize=12, fontweight="bold", color="#254e63", pad=18)
        ax.tick_params(length=0, labelsize=10, labelcolor="#254e63")
        for spine in ax.spines.values():
            spine.set_visible(False)
    fig.text(.035, .94, "One feature direction, five controlled conditions", fontsize=17, fontweight="bold", color="#254e63")
    fig.text(.035, .025, f"{task_count}/8 planned paired tasks completed · greedy Base continuation · layer 12 · ε = 0.02 · 96-token cap\n"
             "Pass counts use agreement between two blinded model-assisted reviews. Token changes are measured exactly.", fontsize=9, color="#536570")
    fig.subplots_adjust(left=.20, right=.97, top=.79, bottom=.18, wspace=.18)
    fig.savefig(output, metadata={"Date": None}, facecolor="white")
    plt.close(fig)
