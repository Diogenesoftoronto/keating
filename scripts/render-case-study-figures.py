#!/usr/bin/env python3
"""Render aggregate-only vector explanatory figures for the local case study."""
import calendar
import json
from pathlib import Path
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parent.parent
DATA = json.loads((ROOT / "docs/case-study/aggregates.json").read_text())
OUT = ROOT / "docs/case-study/figures"
OUT.mkdir(parents=True, exist_ok=True)
INK, BLUE, TEAL, GRAY = "#182d38", "#254e63", "#357d78", "#697d86"


def text(x, y, value, size=13, color=INK, weight=400, anchor="start"):
    return f'<text x="{x}" y="{y}" fill="{color}" font-size="{size}" font-weight="{weight}" text-anchor="{anchor}">{escape(str(value))}</text>'


def rect(x, y, w, h, fill, stroke="none", dash=False):
    return f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="4" fill="{fill}" stroke="{stroke}" stroke-width="1.5"' + (' stroke-dasharray="5 4"' if dash else '') + '/>'


def arrow(x1, y1, x2, y2, color=GRAY, dash=False):
    return f'<path d="M{x1},{y1} L{x2},{y2}" fill="none" stroke="{color}" stroke-width="1.7" marker-end="url(#arrow)"' + (' stroke-dasharray="5 4"' if dash else '') + '/>'


def save(name, height, parts):
    (OUT / name).write_text('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="' + str(height) + '" viewBox="0 0 800 ' + str(height) + '"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10" fill="' + GRAY + '"/></marker></defs><g font-family="DejaVu Sans, sans-serif">' + ''.join(parts) + '</g></svg>')


def calendar_figure():
    parts = [text(0, 25, "42 recorded days across a 121-day observation window", 21, weight=600),
             text(0, 49, "One square = one UTC date. Color encodes event counts; numerals identify dates.", 13, GRAY)]
    palette = ["#e9eef0", "#c1d8da", "#72aaa9", "#357d78", "#193f4e"]
    for index, month in enumerate(range(5, 10)):
        x, y = (index % 3) * 265, 85 + (index // 3) * 225
        parts.append(text(x, y, calendar.month_name[month], 17, weight=600))
        for d, label in enumerate(["M", "T", "W", "T", "F", "S", "S"]):
            parts.append(text(x + d * 32 + 13, y + 24, label, 11, GRAY, anchor="middle"))
        for row, week in enumerate(calendar.monthcalendar(2026, month)):
            for column, day in enumerate(week):
                if not day:
                    continue
                key = f"2026-{month:02}-{day:02}"
                count = DATA["dailyMessages"].get(key, 0)
                level = 0 if not count else 1 if count < 10 else 2 if count < 30 else 3 if count < 60 else 4
                outside = key < "2026-05-09" or key > "2026-09-06"
                dx, dy = x + column * 32, y + 36 + row * 27
                parts.append(rect(dx, dy, 27, 22, "white" if outside else palette[level], "#dce3e6" if outside else "none"))
                parts.append(text(dx + 13.5, dy + 15, day, 10, "#a9b4b9" if outside else "white" if level > 2 else INK, anchor="middle"))
    x, y = 540, 345
    parts.append(text(x, y, "Events per date", 14, weight=600))
    for i, label in enumerate(["0 retained", "1-9", "10-29", "30-59", "60+"]):
        parts.append(rect(x, y + 15 + i * 23, 16, 16, palette[i]))
        parts.append(text(x + 25, y + 28 + i * 23, label, 12))
    parts += [text(0, 528, "Calendar coverage: 1,248 dated events; 23 additional events have no usable timestamp.", 12, GRAY),
              text(0, 547, "Outlined dates fall outside the observation window.", 12, GRAY)]
    save("activity-calendar.svg", 565, parts)


def lineage():
    p = [text(0, 24, "Two exports, one retained history", 22, weight=600),
         text(0, 48, "Arrows trace the source history through deduplication, export, and quality labeling.", 13, GRAY)]
    for x, y, w, h, title, lines in [
        (0, 78, 235, 137, "Portable snapshot", ["81 session objects", "1,819 message copies", "19 linked child sessions"]),
        (295, 78, 225, 137, "Event reconstruction", ["1,271 distinct fingerprints", "548 repeated copies removed", "42 dated activity days"]),
        (295, 275, 225, 150, "Canonical training data", ["361 records", "275 conversation records", "86 artifact records"]),
        (585, 275, 215, 150, "Quality labels", ["298 unscored", "53 rejected by rule", "10 accepted by rule"]),
        (0, 275, 235, 150, "Same source history", ["70 represented session IDs", "70 also in portable export", "Shared session provenance"]),
    ]:
        p += [rect(x, y, w, h, "#f0f4f5"), text(x + 14, y + 28, title, 16, weight=600)]
        p += [text(x + 14, y + 56 + i * 23, line, 12) for i, line in enumerate(lines)]
    p += [arrow(238, 142, 290, 142), text(245, 125, "dedup", 10, GRAY),
          arrow(115, 220, 115, 270), text(126, 248, "exported view", 11, GRAY),
          arrow(238, 347, 290, 347), arrow(523, 347, 580, 347),
          rect(0, 475, 800, 93, "#fcf5e9", "#d4b887"),
          text(16, 503, "Partition audit: 20 / 20 validation completions also appear in train.alpaca", 16, weight=600),
          text(16, 529, "Canonical split: 341 train + 20 validation. Compatibility serialization combines partitions.", 12),
          text(16, 550, "Training on that file would invalidate evaluation against those 20 held-out completions.", 12),
          arrow(405, 430, 405, 470)]
    save("training-lineage.svg", 580, p)


def evidence_map():
    p = [text(0, 25, "What the application recorded", 22, weight=600),
         text(0, 49, "Four channels connect the teaching material with feedback and practice.", 13, GRAY)]
    lanes = [
        (90, "MATERIAL", "86 study artifacts", "27 plans · 21 maps · 10 animations · 28 verifications", "Generated instruction", BLUE),
        (190, "FEEDBACK", "51 feedback entries", "8 explicit · 42 inferred · 1 unspecified", "Mixed provenance", TEAL),
        (290, "PRACTICE", "13 question checks", "5 model-graded · 8 pending", "Sparse scored responses", BLUE),
        (390, "REVIEW", "37 card reviews", "Self-ratings; repeated observations of one case", "Reported recall difficulty", TEAL),
    ]
    for y, label, title, detail, meaning, color in lanes:
        p += [text(0, y + 16, label, 11, color, 600), rect(108, y - 7, 445, 73, "#f0f4f5"),
              text(123, y + 18, title, 17, color, 600), text(123, y + 43, detail, 11),
              arrow(558, y + 27, 600, y + 27), text(615, y + 23, meaning, 12)]
    save("evidence-map.svg", 475, p)


def learning_path():
    p = [text(0, 25, "A conceptual change you can see in the dialogue", 21, weight=600),
         text(0, 49, "Static embeddings, 25-26 June UTC. Selected turns, paraphrased from the dialogue.", 12, GRAY)]
    stages = [
        ("Initial model", "Encoder merges all tokens", "into one fixed-size vector.", "Learner · turns 21-23"),
        ("Concrete challenge", "Tutor distinguishes N × D", "token states from pooling.", "Tutor · turns 24-26"),
        ("Reconstruction", "Learner infers 1,000 rows", "and identifies mean pooling.", "Learner · turns 27-29"),
        ("New consequence", "Learner explains context loss", "when fixed vectors replace attention.", "Learner · turn 31"),
        ("Practical reasoning", "Learner infers cheaper gradients;", "states cued dimension-cost benefits.", "Learner · turns 47, 53"),
    ]
    for i, (title, l1, l2, source) in enumerate(stages):
        y = 78 + i * 86
        p += [rect(0, y, 42, 42, BLUE), text(21, y + 28, i + 1, 19, "white", 600, "middle"),
              text(60, y + 19, title, 16, weight=600), text(60, y + 42, l1 + " " + l2, 13),
              text(790, y + 19, source, 11, GRAY, anchor="end")]
        if i < len(stages) - 1: p.append(arrow(21, y + 46, 21, y + 79))
    p += [rect(0, 515, 800, 85, "#fcf5e9"), text(15, 540, "The same episode also exposes a pacing problem", 16, weight=600),
          text(15, 564, "At turn 45 the learner says the contrastive objective is already familiar.", 13),
          text(15, 586, "The retained exchange ends before an answer to the final engineering questions.", 13)]
    save("learning-path.svg", 615, p)


def evolution_timeline():
    p = [text(0, 25, "The creator learns while the application changes", 21, weight=600),
         text(0, 49, "Lesson episodes and repository changes aligned by date; rows use equal spacing.", 12, GRAY),
         text(100, 87, "LESSON / CREATOR EXPERIENCE", 12, TEAL, 600), text(453, 87, "DOCUMENTED DEVELOPMENT", 12, BLUE, 600)]
    rows = [
        ("June 9-15", ["June 14: correct-looking diagnostic", "choices conceal guessed answers."], ["June 9: quiz overhaul + session forks", "June 15: flashcards + reward exports"]),
        ("June 25-28", ["Packaging and debugging lessons:", "concept repair, wrong guidance, UI repair."], ["June 28: model-judged open answers", "with explicit pending-review state"]),
        ("June 30", ["SwiReasoning revisit: creator cannot", "reconstruct the earlier mechanism."], ["June 30: 1.4.1 notes cover grading", "and fine-tune import changes"]),
        ("July 2-7", ["Vulkan: useful analogy and transfer;", "black animation and quiz friction."], ["July 2: animation asset serving fix", "July 7: migrate visuals to Hyperframes"]),
        ("July 15-26", ["Free-will map needs repeated repair;", "cities question cannot submit."], ["July 15: streamed teaching interfaces", "and structured learner-response work"]),
        ("Aug 8", ["", ""], ["Rewrite system prompt for", "autonomous tool use"]),
        ("Sept 6", ["Creator exports the accumulated", "history for this retrospective study."], ["Fresh teaching gates + fixed checks;", "judge selection added in this draft"]),
    ]
    for i, (date, left, right) in enumerate(rows):
        y = 108 + 86 * i
        p += [text(0, y + 19, date, 11, GRAY, 600), rect(448, y, 352, 68, "#eef2f5")]
        if any(left): p.append(rect(93, y, 332, 68, "#edf5f3"))
        for j, line in enumerate(left): p.append(text(107, y + 25 + 22 * j, line, 12))
        for j, line in enumerate(right): p.append(text(462, y + 25 + 22 * j, line, 12))
    save("development-timeline.svg", 722, p)


calendar_figure()
lineage()
evidence_map()
learning_path()
evolution_timeline()
print(f"Wrote five vector figures to {OUT}")
