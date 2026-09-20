# /// script
# requires-python = ">=3.12,<3.14"
# dependencies = ["markdown==3.10.3", "matplotlib==3.10.*"]
# ///
"""Build an offline, allowlisted research report; never calls model providers."""
import argparse
import hashlib
import html
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import shutil
from urllib.parse import urlsplit, unquote
import zipfile

import markdown
from research_inspectors import render_dataset_inspector, render_probe_inspector, validate_inspector_data
from research_scale import render_scale_figure
from research_generation import render_generation_inspector, render_generation_figure, validate_generation_data
from research_frontier import frontier_workbench, probe_page_body, diagnostic_page_body
from research_revision import revision_data, revision_workbench

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "docs/research-story"
CONFIG = Path(__file__).parent


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def render_markdown(text):
    rendered = markdown.markdown(text, extensions=["tables", "attr_list"])
    return rendered.replace("<table>", '<div class="table-scroll"><table>').replace("</table>", "</table></div>")


def trace_explorer():
    rows = [
        ("1", "Starting hint", "The learner asks for a starting hint on 63 − 28 without the difference.",
         "Start by breaking 28 into friendly chunks relative to 63.",
         "The learner asks whether to split 28 into 3 and 25 or 20 and 8, then asks to try the approach.",
         "0.102627", "16"),
        ("2", "A next step", "The learner has asked to try decomposing 28. The previous hint is already in context.",
         "Try subtracting 20 first, then 8. What do you get at each step?",
         "The learner computes 63 − 20 = 43 and 43 − 8 = 35, then asks whether 35 is the difference.",
         "0.030449", "21"),
    ]
    panels = []
    for step, title, prefix, reply, consequence, score, tokens in rows:
        panels.append(f'''<div class="trace-panel" data-trace-panel="{step}" id="trace-{step}">
        <h3>{title}</h3><ol>
        <li><span class="role">Before the action</span><p class="text">{prefix}<span class="annotation">Paraphrase of recorded context. Future learner feedback is unavailable here.</span></p></li>
        <li><span class="role">Delivered tutor reply</span><p class="text">“{reply}”<span class="score">Measured premature-answer score: {score}</span><span class="annotation">Exact recorded tutor text · {tokens} original completion tokens · feature penalty applied once per action.</span></p></li>
        <li><span class="role">Next learner event</span><p class="text">{consequence}<span class="annotation">Paraphrase of actual delivered simulated feedback. Available to the hindsight teacher, not the original student prefix.</span></p></li>
        </ol></div>''')
    return '''<section class="trace" aria-label="Explore the recorded native exchange">
    <h3>Follow the two training actions</h3><p>Recorded Keating chat · authored task · simulated learner · actual frozen observer scores</p>
    <div class="trace-controls" role="group" aria-label="Choose a recorded action"><button type="button" data-trace-step="1" aria-controls="trace-1" aria-pressed="true">First action</button><button type="button" data-trace-step="2" aria-controls="trace-2" aria-pressed="false">Second action</button></div>
    ''' + "".join(panels) + '''<p class="trace-note">Both actions receive a small penalty proportional to their measured risk of premature answer delivery. Explore execution and measurement boundaries in <a href="#limitations">limitations</a>.</p></section>'''


def page(body, brief=False):
    nav = "" if brief else '''<nav aria-label="Reading map">
    <a href="#beginning">The teaching decision</a><a href="#journey">How we got here</a><a href="#situations">From datasets to situations</a><a href="#dataset-inspector">Inspect original / native</a><a href="#measurement">A measurable behavior</a><a href="#probe-inspector">Diagnose probe decisions</a><a href="#generation-inspector">Inspect feature interventions</a><a href="#interaction">The actual exchange</a><a href="#updates">Three real updates</a><a href="#behavior">The output check</a><a href="#scale">Scale and published milestones</a><a href="#benchmark-frontier">The v4.0 pilot</a><a href="#v41">V4.1: natural learner dialogue</a><a href="#contextual-training">Teaching judgment in training</a><a href="#lessons">What the detours taught us</a><a href="#next">The next funded stage</a><a href="#conclusion">Conclusions</a><a href="#limitations">Limitations</a><a href="#glossary">Plain-language glossary</a><a href="#evidence">Evidence and sources</a><a class="download" href="funding-brief.html">Read the research brief ↗</a></nav>'''
    hero = "" if brief else '''<section class="hero wrap"><div><p class="series">Keating research · A companion to Learning to Teach</p><h1>Learning from<br>the next turn.</h1><p class="lede">We taught a system to measure one teaching failure, connected that measurement to real model updates, and tested what changed.</p><p class="subtitle">From the v4 pilot to natural learner dialogue and context-sensitive teaching rewards.</p><div class="actions"><a href="#beginning">Follow the research ↓</a><a href="funding-brief.html">Read the funding brief ↗</a></div></div><figure><img src="mascot-head-v2.png" width="1280" height="1280" alt="Keating Bot, the cream-colored tutor robot with a green screen"><div><div class="seal">Measure the action.<br>Follow its consequence.</div><figcaption>A field report from Keith Noel’s Keating project.<br>Evidence through 14 September 2026.</figcaption></div></figure></section><div class="opening-note"><div class="wrap"><p><strong>Pipeline demonstrated:</strong> a pinned SAE readout and subsequent simulated learner feedback reached three real optimizer updates on original tutor tokens.</p><p><strong>Initial output check:</strong> just 2 actions, 37 target tokens and 1 step per branch. F and F+S preserved all measured verdicts; S lost one pass. Larger studies must test for gains.</p></div></div>'''
    return f'''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Keating's research journey from native teaching scenarios to SAE feature rewards, hindsight updates, and a fresh behavior comparison."><title>Learning from the next turn · Keating research</title><link rel="icon" href="mascot-head-v2.png"><link rel="stylesheet" href="report.css"><script defer src="report.js"></script></head><body><a class="skip" href="#content">Skip to the research</a><header class="masthead wrap"><a class="brand" href="https://keating.help/">keating<span>_</span></a><span class="edition">Research notes · 13–14 September 2026</span><a href="https://learning-to-teach-report-production.up.railway.app/">Previous report ↗</a></header>{hero}<main class="reading wrap"{' style="display:block;max-width:850px"' if brief else ''}>{nav}<article id="content">{body}</article></main><footer class="footer wrap"><p>Keating · Research direction by Keith Noel<br>Implementation and review assisted by coding agents. See the evidence audit.</p><div><a href="index.html">Full report</a> · <a href="manuscript.md">Editable manuscript</a> · <a href="evidence-audit.html">Evidence audit</a></div></footer></body></html>'''


def probe_figure(summary, output):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    plt.rcParams.update({"font.family": "DejaVu Sans", "svg.hashsalt": "keating-story-probe-v1", "axes.spines.top": False, "axes.spines.right": False})
    keys = ["text", "raw", "sae"]
    labels = ["Text\n(intercept-only)", "Raw\nactivations", "SAE\nreadout"]
    values = [summary["baselines"][k]["test"]["brier"] for k in keys]
    fig, ax = plt.subplots(figsize=(10, 4.8))
    ax.bar(labels, values, color=["#89969C", "#0072B2", "#00836B"], width=.55)
    ax.set_ylim(0, .23)
    ax.set_ylabel("Brier error · lower is better", color="#254e63")
    ax.set_title("Can the readout detect an answer given too soon?", loc="left", pad=25, color="#254e63", fontweight="bold", fontsize=16)
    for i, value in enumerate(values):
        ax.text(i, value+.007, f"{value:.4f}", ha="center", fontsize=12, color="#254e63")
    fig.text(.13, .02, "24 authored test records · 6 held-out task families · fixed classification recipe", fontsize=9, color="#536570")
    fig.subplots_adjust(bottom=.19, top=.82)
    fig.savefig(output, metadata={"Date": None}, facecolor="white")
    plt.close(fig)


class Links(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids, self.links = set(), []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if "id" in attrs:
            if attrs["id"] in self.ids:
                raise ValueError("Duplicate HTML ID")
            self.ids.add(attrs["id"])
        for key in ("href", "src"):
            if key in attrs:
                self.links.append(attrs[key])


def packageResearchStory(output, report_pdf=None, brief_pdf=None):
    if output.exists():
        raise ValueError("Choose a fresh output directory; existing packages are preserved")
    # Every packaged input is named here. No recursive copying of source data or .keating.
    inputs = {
        "manuscript.md": SOURCE / "manuscript.md",
        "funding-brief.md": SOURCE / "funding-brief.md",
        "evidence-audit.md": SOURCE / "evidence-audit.md",
        "evidence-notes.md": SOURCE / "evidence-notes.md",
        "probe-summary.json": SOURCE / "probe-summary.json",
        "dataset-examples.json": SOURCE / "dataset-examples.json",
        "probe-examples.json": SOURCE / "probe-examples.json",
        "generation-examples.json": SOURCE / "generation-examples.json",
        "benchmark-frontier.md": SOURCE / "benchmark-frontier.md",
        "contextual-teaching.md": SOURCE / "contextual-teaching.md",
        "revision.css": CONFIG / "research-revision.css",
        "revision.js": CONFIG / "research-revision.js",
        "v4.0-cases.json": ROOT / "scripts/training/benchmarks/teaching-v4/versions/4.0.0/cases.json",
        "v4.0-manifest.json": ROOT / "scripts/training/benchmarks/teaching-v4/versions/4.0.0/manifest.json",
        "v4.1-cases.json": ROOT / "scripts/training/benchmarks/teaching-v4/cases.json",
        "v4.1-manifest.json": ROOT / "scripts/training/benchmarks/teaching-v4/manifest.json",
        "frontier-example.json": SOURCE / "frontier-example.json",
        "benchmark-diagnostics.json": SOURCE / "benchmark-diagnostics.json",
        "probe-spans.json": SOURCE / "probe-spans.json",
        "teaching-v4-pilot.json": ROOT / "docs/generated/teaching-v4-pilot.json",
        "teaching-v4-pilot.svg": ROOT / "docs/assets/teaching-v4-pilot.svg",
        "native-document-clock.svg": ROOT / "docs/assets/native-document-clock.svg",
        "frontier.css": CONFIG / "research-frontier.css",
        "frontier.js": CONFIG / "research-frontier.js",
        "feature-hindsight-evaluation.json": ROOT / "docs/generated/feature-hindsight-evaluation.json",
        "native-combined-update.json": ROOT / "docs/generated/native-combined-update.json",
        "native-combined-update.svg": ROOT / "docs/assets/native-combined-update.svg",
        "checkpoint-behavior.svg": ROOT / "docs/assets/checkpoint-behavior.svg",
        "mascot-head-v2.png": ROOT / "web/public/brand/mascot-head-v2.png",
        "report.css": CONFIG / "research-story.css",
        "report.js": CONFIG / "research-story.js",
        "inspectors.css": CONFIG / "research-inspectors.css",
        "inspectors.js": CONFIG / "research-inspectors.js",
        "generation.css": CONFIG / "research-generation.css",
        "generation.js": CONFIG / "research-generation.js",
        **{name: SOURCE / "assets" / name for name in ("vt323.ttf", "roboto.ttf", "VT323-OFL.txt", "Roboto-OFL.txt")},
    }
    if report_pdf:
        inputs["report.pdf"] = report_pdf
    if brief_pdf:
        inputs["funding-brief.pdf"] = brief_pdf
    evaluation = json.loads(inputs["feature-hindsight-evaluation.json"].read_text())
    assert len(evaluation["rows"]) == 64
    for arm, passes in [("Initial", 10), ("F-only", 10), ("S-only", 9), ("F+S", 10)]:
        rows = [r for r in evaluation["rows"] if r["arm"] == arm]
        assert len(rows) == 16
        # Overall counts are checked independently of the manuscript text.
        assert evaluation["by_arm"][arm]["pass"] == passes
        assert sum(r["task_pass"] == 1 for r in rows) == passes
    datasets = json.loads(inputs["dataset-examples.json"].read_text())
    probes = json.loads(inputs["probe-examples.json"].read_text())
    validate_inspector_data(datasets, probes)
    generation = json.loads(inputs["generation-examples.json"].read_text())
    validate_generation_data(generation)
    revisions = revision_data(inputs["v4.1-cases.json"], inputs["v4.0-cases.json"],
                              inputs["v4.1-manifest.json"], inputs["v4.0-manifest.json"])
    output.mkdir(parents=True)
    for name, source in inputs.items():
        shutil.copyfile(source, output / name)
    (output / "dialogue-revisions.json").write_text(json.dumps(revisions, ensure_ascii=False, indent=2) + "\n")
    probe = json.loads(inputs["probe-summary.json"].read_text())
    assert probe["counts"] == {"train": 72, "calibration": 24, "test": 24}
    assert probe["baselines"]["sae"]["nonzero_coefficients"] == 19
    probe_figure(probe, output / "probe-comparison.svg")
    render_scale_figure(output / "training-exposure.svg")
    render_generation_figure(generation, output / "generation-outcomes.svg")
    manuscript = inputs["manuscript.md"].read_text().split("\n", 1)[1]
    for remote, local in {
        "native-combined-results.md": "native-update",
        "checkpoint-behavior-results.md": "behavior",
        "native-scenario-adapters.md": "adapters",
        "plans/native-research-completion-audit.md": "earlier-gates",
        "premature-answer-reward.md": "probe",
    }.items():
        manuscript = manuscript.replace("https://github.com/Diogenesoftoronto/keating/blob/main/docs/" + remote, "evidence-notes.html#" + local)
    manuscript = manuscript.replace("evidence-audit.md)", "evidence-audit.html)").replace("funding-brief.md)", "funding-brief.html)")
    body = render_markdown(manuscript).replace("<!-- TRACE_EXPLORER -->", trace_explorer())
    body = body.replace("<!-- DATASET_INSPECTOR -->", render_dataset_inspector(datasets))
    body = body.replace("<!-- PROBE_INSPECTOR -->", render_probe_inspector(probes))
    body = body.replace("<!-- GENERATION_INSPECTOR -->", render_generation_inspector(generation))
    frontier = json.loads(inputs["frontier-example.json"].read_text())
    chapter = render_markdown(inputs["benchmark-frontier.md"].read_text())
    chapter += frontier_workbench(frontier)
    body = body.replace("<!-- BENCHMARK_FRONTIER -->", chapter)
    revision_chapter = render_markdown(inputs["contextual-teaching.md"].read_text()).replace(
        "<!-- REVISION_WORKBENCH -->", revision_workbench(revisions))
    body = body.replace("<!-- CONTEXTUAL_TEACHING -->", revision_chapter)
    arms = ["Initial", "F-only", "S-only", "F+S"]
    bars = "".join(f'<div class="behavior-row"><span>{arm}</span><div class="bar-track"><i data-bar="{arm}" style="width:{evaluation["by_arm"][arm]["pass"]/16*100}%"></i></div><strong data-count="{arm}">{evaluation["by_arm"][arm]["pass"]}/16</strong></div>' for arm in arms)
    interactive = '''<section class="behavior-explorer" aria-label="Filter actual checkpoint results"><h3>Inspect the comparison</h3><p>Choose a task category. Counts include both seeds; the underlying task families stay the same.</p><div class="category-controls" role="group" aria-label="Task category"><button data-category="all" aria-pressed="true">All tasks</button><button data-category="hint" aria-pressed="false">Hint requests</button><button data-category="worked" aria-pressed="false">Worked answers</button><button data-category="retention" aria-pressed="false">Other capabilities</button></div><div id="behavior-bars" aria-live="polite">''' + bars + '''</div><p id="behavior-note">8 task families · 16 responses per arm · no improvement observed.</p><details><summary>Inspect passes by task family</summary><div class="table-scroll"><table><thead><tr><th>Family</th><th>Initial</th><th>F-only</th><th>S-only</th><th>F+S</th></tr></thead><tbody id="family-rows"></tbody></table></div></details></section>'''
    safe_data = json.dumps({k: evaluation[k] for k in ("by_arm", "by_category", "cases", "rows")}).replace("<", "\\u003c")
    body = body.replace("<!-- BEHAVIOR_EXPLORER -->", interactive + '<script type="application/json" id="behavior-data">' + safe_data + '</script>')
    (output / "index.html").write_text(page(body).replace('</head>', '<link rel="stylesheet" href="inspectors.css"><script defer src="inspectors.js"></script><link rel="stylesheet" href="generation.css"><script defer src="generation.js"></script></head>'))
    for name in ("funding-brief", "evidence-audit", "evidence-notes"):
        (output / f"{name}.html").write_text(page(render_markdown(inputs[f"{name}.md"].read_text()), brief=True))
    for name, fragment in {
        "benchmark-frontier": chapter,
        "contextual-teaching": revision_chapter,
        "probe-spans": probe_page_body(json.loads(inputs["probe-spans.json"].read_text())),
        "benchmark-diagnostics": diagnostic_page_body(json.loads(inputs["benchmark-diagnostics.json"].read_text())),
    }.items():
        (output / f"{name}.html").write_text(page('<p><a href="index.html#benchmark-frontier">← Back to the research story</a></p>' + fragment, brief=True))
    for path in output.glob("*.html"):
        path.write_text(path.read_text().replace('</head>', '<link rel="stylesheet" href="frontier.css"><script defer src="frontier.js"></script><link rel="stylesheet" href="revision.css"><script defer src="revision.js"></script></head>'))
    downloads = []
    if report_pdf:
        downloads.append('<a href="report.pdf" download>Download the report PDF</a>')
    if brief_pdf:
        downloads.append('<a href="funding-brief.pdf" download>Download the funding brief PDF</a>')
    if downloads:
        for path in output.glob("*.html"):
            path.write_text(path.read_text().replace('</article>', '<div class="actions">' + ' '.join(downloads) + '</div></article>'))
    (output / "README.txt").write_text("Open index.html directly in a browser. Fonts, figures, data and interactions work offline. Read funding-brief.html for the short research case. Browser Print produces a print layout. Selected attributed source excerpts, native adaptations and authored probe records are included for inspection. No complete source datasets, credentials, weights or private product transcripts are included. Deployment is verified separately from this static build. snapshot.json records file and source hashes.\n")
    parsers = {}
    for path in output.glob("*.html"):
        parser = Links()
        parser.feed(path.read_text())
        parsers[path.name] = parser
    for name, parser in parsers.items():
        for link in parser.links:
            parts = urlsplit(link)
            if parts.scheme or parts.netloc:
                continue
            target = unquote(parts.path) or name
            if target == "snapshot.json":
                continue
            assert (output / target).is_file(), f"Missing local link {name}: {link}"
            if parts.fragment and target in parsers:
                assert parts.fragment in parsers[target].ids, f"Missing fragment: {link}"
    manifest = {"title": "Learning from the next turn", "evidence_through": "2026-09-14", "build_kind": "static_snapshot",
                "source_files": {str(p.relative_to(ROOT)) if p.is_relative_to(ROOT) else f"external-input/{name}": digest(p) for name, p in inputs.items()},
                "files": {p.name: digest(p) for p in sorted(output.iterdir()) if p.is_file()},
                "checks": {"scheduled_responses": 64, "dataset_examples": len(datasets["examples"]), "probe_examples": len(probes["examples"]), "local_links_valid": True, "provider_calls": 0}}
    (output / "snapshot.json").write_text(json.dumps(manifest, indent=2) + "\n")
    archive = output.with_suffix(".zip")
    with zipfile.ZipFile(archive, "x", compression=zipfile.ZIP_DEFLATED) as bundle:
        for path in sorted(output.iterdir()):
            bundle.write(path, f"{output.name}/{path.name}")
    print(json.dumps({"report": str(output / "index.html"), "archive": str(archive), "files": len(manifest["files"])+1}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--pdf", type=Path)
    parser.add_argument("--brief-pdf", type=Path)
    args = parser.parse_args()
    packageResearchStory(args.output_dir.resolve(), args.pdf, args.brief_pdf)
