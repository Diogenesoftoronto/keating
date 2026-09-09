#!/usr/bin/env python3
"""Render aggregate-only case-study charts with Matplotlib.

Use --portable to rebuild weekly counts from the local export. Without it, the
checked-in aggregate chart data is sufficient. No transcript text or session
identifiers are written. Requires matplotlib; no hosted inference is used.
"""
import argparse
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
import hashlib
import json
from pathlib import Path
import textwrap

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.ticker import MaxNLocator
import numpy as np


ROOT = Path(__file__).resolve().parents[1]
INK = "#254e63"
MUTED = "#536570"
GRID = "#dce4e8"
BLUE = "#0072B2"
TEAL = "#00836B"
ORANGE = "#C97900"
PURPLE = "#93679F"
GRAY = "#89969C"
PALE = "#eef3f5"

plt.rcParams.update({
    "font.family": "DejaVu Sans",
    "font.size": 10,
    "text.color": INK,
    "axes.labelcolor": MUTED,
    "xtick.color": MUTED,
    "ytick.color": INK,
    "axes.edgecolor": GRID,
    "axes.spines.top": False,
    "axes.spines.right": False,
    "axes.spines.left": False,
    "axes.titlesize": 12,
    "axes.titleweight": "bold",
    "axes.titlecolor": INK,
    "figure.facecolor": "white",
    "savefig.facecolor": "white",
    "svg.hashsalt": "keating-creator-case-study-charts-v1",
})


def digest(value):
    # Same event identity as scripts/analyze-single-learner.py.
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False).encode()).hexdigest()


def derive_weekly(portable_path, aggregate):
    raw = portable_path.read_bytes()
    source_hash = hashlib.sha256(raw).hexdigest()
    expected_hash = next(item["sha256"] for item in aggregate["inputs"] if item["role"] == "portable")
    if source_hash != expected_hash:
        raise ValueError("Portable input differs from the paper's audited snapshot")
    portable = json.loads(raw)
    seen = set()
    roles = Counter()
    dated_roles = Counter()
    daily = Counter()
    weekly = defaultdict(Counter)
    invalid = 0
    for entry in portable["sessions"]:
        for message in entry["data"].get("messages", []):
            key = digest([message.get("role"), message.get("timestamp"), message.get("content")])
            if key in seen:
                continue
            seen.add(key)
            role = message.get("role", "unknown")
            roles[role] += 1
            timestamp = message.get("timestamp")
            try:
                if not isinstance(timestamp, (int, float)) or isinstance(timestamp, bool):
                    raise ValueError("not milliseconds")
                dt = datetime.fromtimestamp(timestamp / 1000, timezone.utc)
                if not 2000 <= dt.year <= 2100:
                    raise ValueError("implausible timestamp")
            except (ValueError, OverflowError, OSError):
                invalid += 1
                continue
            day = dt.date()
            monday = day - timedelta(days=day.weekday())
            weekly[monday][role] += 1
            daily[day.isoformat()] += 1
            dated_roles[role] += 1
    assert dict(roles) == aggregate["messageRoles"]
    assert dict(sorted(daily.items())) == aggregate["dailyMessages"]
    assert invalid == aggregate["invalidMessageTimestamps"]
    start = date.fromisoformat(aggregate["firstMessageUtc"][:10])
    end = date.fromisoformat(aggregate["lastMessageUtc"][:10])
    rows = []
    monday = start - timedelta(days=start.weekday())
    while monday <= end:
        observed_start = max(start, monday)
        observed_end = min(end, monday + timedelta(days=6))
        rows.append({
            "weekStartUtc": monday.isoformat(),
            "observedDays": (observed_end - observed_start).days + 1,
            **{role: weekly[monday][role] for role in ("user", "assistant", "toolResult")},
        })
        monday += timedelta(days=7)
    return {
        "chartDataVersion": 1,
        "portableSha256": source_hash,
        "eventFingerprint": "sha256(json([role, timestamp, content], sort_keys=True, ensure_ascii=False))",
        "firstObservedDateUtc": start.isoformat(),
        "lastObservedDateUtc": end.isoformat(),
        "datedMessageRoles": dict(dated_roles),
        "undatedEventsExcludedFromTimeChart": invalid,
        "weeklyMessages": rows,
    }


def save(fig, output_dir, name):
    fig.savefig(output_dir / name, format="svg", metadata={"Date": None, "Creator": "Keating aggregate chart renderer"})
    plt.close(fig)


def grid_axis(ax, axis="y"):
    ax.set_axisbelow(True)
    ax.grid(axis=axis, color=GRID, linewidth=0.65)
    ax.tick_params(axis="both", length=0, pad=6)


def render_activity(data, output_dir):
    rows = data["weeklyMessages"]
    x = np.arange(len(rows))
    fig, ax = plt.subplots(figsize=(8.2, 3.4))
    fig.subplots_adjust(left=0.08, right=0.985, bottom=0.28, top=0.77)
    fig.text(0.01, 0.955, "A  |  Weekly interaction", fontsize=12, weight="bold")
    fig.text(0.01, 0.875, "Distinct retained events per Monday–Sunday week", fontsize=10, color=MUTED)
    ax.axvspan(-0.4, 0.4, color=PALE, zorder=0)
    for role, label, color, marker, style in [
        ("assistant", "Tutor", BLUE, "o", "-"),
        ("user", "Learner", TEAL, "s", "-"),
        ("toolResult", "Tool results", GRAY, "^", "--"),
    ]:
        ax.plot(x, [row[role] for row in rows], label=label, color=color,
                marker=marker, markersize=4, linewidth=1.8, linestyle=style)
    ax.set_xlim(-0.4, len(rows) - 0.6)
    ax.set_ylim(bottom=0)
    ax.yaxis.set_major_locator(MaxNLocator(nbins=4, integer=True))
    ticks = list(range(0, len(rows) - 2, 2)) + [len(rows) - 1]
    ax.set_xticks(ticks, [date.fromisoformat(rows[i]["weekStartUtc"]).strftime("%b %d") for i in ticks], fontsize=9)
    ax.set_ylabel("Events", fontsize=10)
    grid_axis(ax)
    ax.legend(loc="lower left", bbox_to_anchor=(0, 1.015), borderaxespad=0,
              frameon=False, ncol=3, handlelength=2.4, columnspacing=1.8, fontsize=9)
    fig.text(0.08, 0.13, "Week beginning (UTC, 2026)", fontsize=9, color=MUTED)
    fig.text(0.01, 0.035, "1,248 dated events; 23 untimed events excluded. Shaded first week contains May 9–10 only.", fontsize=9, color=MUTED)
    save(fig, output_dir, "chart-weekly-activity.svg")


def render_models(aggregate, output_dir):
    counts = aggregate["modelMetadata"]["distinctAssistantEventLabels"]
    named = [
        ("MiniMax M3", counts["minimax/MiniMax-M3"], BLUE),
        ("MiniMax M2.7", counts["minimax/MiniMax-M2.7"], TEAL),
        ("MiniMax M2.7-highspeed", counts["minimax/MiniMax-M2.7-highspeed"], PURPLE),
    ]
    missing = counts["missing/missing"]
    total = sum(counts.values())
    named += [("Other recorded models", total - sum(row[1] for row in named) - missing, ORANGE),
              ("Missing model label", missing, GRAY)]
    assert total == aggregate["messageRoles"]["assistant"]
    fig = plt.figure(figsize=(8.2, 2.7))
    fig.text(0.01, 0.95, "B  |  The models present in the retained lessons", fontsize=12, weight="bold")
    fig.text(0.01, 0.84, "Share of distinct assistant events by stored response-level model label", fontsize=10, color=MUTED)
    ax = fig.add_axes([0.015, 0.08, 0.30, 0.72])
    ax.pie([row[1] for row in named], colors=[row[2] for row in named], startangle=90,
           counterclock=False, wedgeprops={"width": 0.28, "edgecolor": "white", "linewidth": 1.5})
    ax.text(0, 0.1, str(total), ha="center", va="center", fontsize=25, weight="bold")
    ax.text(0, -0.22, "tutor events", ha="center", va="center", fontsize=10, color=MUTED)
    for i, (label, count, color) in enumerate(named):
        y = 0.715 - i * 0.115
        fig.text(0.345, y, "●", color=color, fontsize=13, va="center")
        fig.text(0.38, y, label, fontsize=10, va="center")
        fig.text(0.98, y, f"{count}  ·  {count / total:.1%}", fontsize=10, ha="right", va="center")
    fig.text(0.01, 0.03, "MiniMax variants: 370 / 604 events (61.3%). Denominator includes 13 events with missing labels.", fontsize=9, color=MUTED)
    save(fig, output_dir, "chart-model-mix.svg")


def render_practice(aggregate, output_dir):
    fig, axes = plt.subplots(1, 2, figsize=(8.2, 3.15))
    fig.subplots_adjust(left=0.13, right=0.97, top=0.68, bottom=0.20, wspace=0.60)
    fig.text(0.01, 0.95, "C  |  Teaching materials and self-rated card practice", fontsize=12, weight="bold")
    fig.text(0.01, 0.835, "Stored material objects", fontsize=10, weight="bold")
    fig.text(0.56, 0.835, "Card-review events", fontsize=10, weight="bold")
    materials = [("Verifications", "verifications"), ("Lesson plans", "lessonPlans"), ("Maps", "lessonMaps"), ("Animations", "animations")]
    ratings = [("Again", "0"), ("Hard", "1"), ("Good", "2"), ("Easy", "3")]
    for ax, names, values, colors, limit in [
        (axes[0], [row[0] for row in materials], [aggregate["storageCounts"][row[1]] for row in materials], [BLUE] * 4, 33),
        (axes[1], [row[0] for row in ratings], [aggregate["reviewRatings"][row[1]] for row in ratings], [PURPLE, ORANGE, TEAL, BLUE], 14.5),
    ]:
        y = np.arange(len(names))
        ax.barh(y, values, color=colors, height=0.58, zorder=3)
        ax.set_yticks(y, names, fontsize=9)
        ax.invert_yaxis()
        ax.set_xlim(0, limit)
        ax.xaxis.set_major_locator(MaxNLocator(nbins=4, integer=True))
        ax.set_xlabel("Count", fontsize=9)
        grid_axis(ax, axis="x")
        for index, count in enumerate(values):
            ax.text(count + limit * 0.025, index, str(count), va="center", fontsize=10, weight="bold")
    fig.text(0.01, 0.03, "86 stored materials. 37 review events: Again = missed; Hard = strained; Good = recalled; Easy = instant.", fontsize=9, color=MUTED)
    save(fig, output_dir, "chart-materials-reviews.svg")


def render_feedback(aggregate, output_dir):
    fig = plt.figure(figsize=(8.2, 2.95))
    fig.text(0.01, 0.96, "D  |  How responses became feedback and assessment records", fontsize=12, weight="bold")
    fig.text(0.01, 0.855, "Each bar partitions its own record type; counts and shares are labeled", fontsize=10, color=MUTED)
    series = [
        ("Feedback provenance", [
            ("Turn analysis", aggregate["feedbackSources"]["turn-analysis"], BLUE),
            ("Explicit", aggregate["feedbackSources"]["explicit"], TEAL),
            ("Unspecified", aggregate["feedbackSources"]["unspecified"], GRAY),
        ], 0.64),
        ("Question-check status", [
            ("Model-graded", aggregate["questionCheckGrading"]["model"], TEAL),
            ("Pending", aggregate["questionCheckGrading"]["pending"], ORANGE),
        ], 0.25),
    ]
    for title, entries, y in series:
        total = sum(row[1] for row in entries)
        fig.text(0.01, y + 0.085, title, fontsize=10, weight="bold")
        fig.text(0.985, y + 0.085, f"n = {total}", fontsize=10, ha="right", weight="bold")
        ax = fig.add_axes([0.01, y - 0.09, 0.975, 0.13])
        left = 0
        for label, count, color in entries:
            width = count / total
            ax.barh(0, width, left=left, color=color, edgecolor="white", linewidth=1, height=0.8)
            if width > 0.075:
                ax.text(left + width / 2, 0, str(count), ha="center", va="center", fontsize=10, color="white", weight="bold")
            left += width
        ax.set_xlim(0, 1)
        ax.set_ylim(-0.5, 0.5)
        ax.axis("off")
        offsets = [0.01, 0.395, 0.71] if len(entries) == 3 else [0.01, 0.51]
        for offset, (label, count, color) in zip(offsets, entries):
            fig.text(offset, y - 0.175, "●", color=color, fontsize=11, va="center")
            fig.text(offset + 0.025, y - 0.175, f"{label}: {count} ({count / total:.1%})", fontsize=9, va="center")
    save(fig, output_dir, "chart-feedback-assessment.svg")


def render_subjects(data, output_dir):
    metadata = data["metadata"]
    subjects = sorted(data["subjects"], key=lambda row: (-row["discussedCount"], -row["count"], row["label"]))
    assert sum(row["count"] for row in subjects) == metadata["includedFamilies"]
    assert sum(row["discussedCount"] for row in subjects) == metadata["discussedFamilies"]
    assert sum(row["openingOnlyCount"] for row in subjects) == metadata["openingOnlyFamilies"]
    assert all(row["count"] == row["discussedCount"] + row["openingOnlyCount"] for row in subjects)
    fig, ax = plt.subplots(figsize=(8.2, 1.9 + 0.64 * len(subjects)))
    fig.subplots_adjust(left=0.30, right=0.96, top=0.84, bottom=0.13)
    fig.text(0.01, 0.965, "Subjects in the creator's learning record", fontsize=13, weight="bold")
    fig.text(0.01, 0.917, "One primary subject per conversation family; copied histories and forks are grouped", fontsize=9.5, color=MUTED)
    y = np.arange(len(subjects)) * 1.55
    discussed = [row["discussedCount"] for row in subjects]
    opening = [row["openingOnlyCount"] for row in subjects]
    ax.barh(y, discussed, height=0.52, color=BLUE, label="Discussion or practice", zorder=3)
    ax.barh(y, opening, left=discussed, height=0.52, color=PALE, edgecolor=GRAY,
            linewidth=0.65, hatch="////", label="Opening only", zorder=3)
    ax.set_yticks(y, [row["label"] for row in subjects], fontsize=10)
    ax.tick_params(axis="y", pad=12)
    maximum = max(row["count"] for row in subjects)
    ax.set_xlim(0, maximum * 1.12)
    ax.set_ylim(y[-1] + 0.95, -0.65)
    ax.xaxis.set_major_locator(MaxNLocator(nbins=5, integer=True))
    ax.set_xlabel("Conversation families", fontsize=10, labelpad=9)
    grid_axis(ax, axis="x")
    for position, row in zip(y, subjects):
        ax.text(row["count"] + maximum * 0.025, position, str(row["count"]),
                va="center", fontsize=11, weight="bold")
        selected_topics = row.get("representativeTopics", row.get("discussedTopics", row["topics"]))[:3]
        assert all(topic in row["discussedTopics"] for topic in selected_topics)
        examples = "; ".join(selected_topics)
        lines = textwrap.wrap(examples, width=62)
        ax.text(0, position + 0.44, "\n".join(lines[:2]), va="top", fontsize=8.5, color=MUTED,
                bbox={"facecolor": "white", "edgecolor": "none", "pad": 0.8})
    ax.legend(loc="lower left", bbox_to_anchor=(0, 1.035), frameon=False, ncol=2,
              borderaxespad=0, handlelength=2, columnspacing=1.4, fontsize=9)
    fig.text(0.01, 0.043,
             f"{metadata['discussedFamilies']} discussed + {metadata['openingOnlyFamilies']} opening-only = "
             f"{metadata['includedFamilies']} topic-bearing families from {metadata['totalSessionObjects']} session objects.",
             fontsize=9, color=MUTED)
    fig.text(0.01, 0.016,
             f"{metadata['excludedFamilies']} greeting, setup, demonstration, or repair-only families excluded. Counts describe coverage.",
             fontsize=8.5, color=MUTED)
    save(fig, output_dir, "chart-subject-coverage.svg")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--portable", type=Path, help="Optional local portable export to rebuild weekly counts")
    parser.add_argument("--aggregates", type=Path, default=ROOT / "docs/case-study/aggregates.json")
    parser.add_argument("--chart-data", type=Path, default=ROOT / "docs/case-study/chart-data.json")
    parser.add_argument("--subject-data", type=Path, default=ROOT / "docs/case-study/subject-data.json")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "docs/case-study/figures")
    args = parser.parse_args()
    aggregate = json.loads(args.aggregates.read_text())
    if args.portable:
        data = derive_weekly(args.portable, aggregate)
        args.chart_data.write_text(json.dumps(data, indent=2) + "\n")
    else:
        data = json.loads(args.chart_data.read_text())
    expected_hash = next(item["sha256"] for item in aggregate["inputs"] if item["role"] == "portable")
    assert data["portableSha256"] == expected_hash
    assert sum(sum(row.get(role, 0) for role in ("user", "assistant", "toolResult")) for row in data["weeklyMessages"]) == sum(aggregate["dailyMessages"].values())
    assert sum(data["datedMessageRoles"].values()) + data["undatedEventsExcludedFromTimeChart"] == aggregate["messageEvents"]
    args.output_dir.mkdir(parents=True, exist_ok=True)
    render_activity(data, args.output_dir)
    render_models(aggregate, args.output_dir)
    render_practice(aggregate, args.output_dir)
    render_feedback(aggregate, args.output_dir)
    figure_count = 4
    if args.subject_data.exists():
        subject_data = json.loads(args.subject_data.read_text())
        assert subject_data["metadata"]["portableSha256"] == expected_hash
        render_subjects(subject_data, args.output_dir)
        figure_count += 1
    print(f"Rendered {figure_count} aggregate chart figures in {args.output_dir}")


if __name__ == "__main__":
    main()
