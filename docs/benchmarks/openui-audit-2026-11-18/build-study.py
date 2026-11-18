"""Build the showcase data and audit totals offline from scored release receipts."""

import json
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent


def read(name):
    return json.loads((HERE / name).read_text())


def save(name, value):
    (HERE / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


scenarios = {case["id"]: case for case in read("scenarios.json")}
records = read("scored.json")["records"]
primary = [r for r in records if r["cohort"] == "primary"]
assert len({(r["scenario"], r["model"]) for r in primary}) == len(primary) == 20
repeats = [r for r in records if r["cohort"] == "default-repeat"]
raw = {r["id"]: read("evidence/" + r["id"] + ".json") for r in records}


def terminal(s):
    return bool(s and s["stop"] in ("stop", "toolUse"))


def valid(s):
    return bool(terminal(s) and s["components"])


def useful(r):
    f = r["final"]
    if not f or not f["fits"]:
        return False
    if r["scenario"] == "code":
        return any(
            n.get("language") == "python"
            for n in f["nodes"]
            if n["type"] == "coding-challenge"
        )
    return True


def cohort(rows):
    op = [r for r in rows if r["group"] == "opportunity"]
    ctl = [r for r in rows if r["group"] == "control"]
    offered = [r for r in op if r["offered"]]
    paired = [r for r in offered if terminal(r["drafts"][0]) and terminal(r["control"])]
    return {
        "turns": len(rows),
        "opportunities": len(op),
        "markedPrivate": sum(
            any(terminal(d) and d["marked"] for d in r["drafts"]) for r in op
        ),
        "validPrivate": sum(any(valid(d) for d in r["drafts"]) for r in op),
        "validFirst": sum(valid(r["drafts"][0]) for r in op),
        "completedFirst": sum(terminal(r["drafts"][0]) for r in op),
        "validFinal": sum(valid(r["final"]) for r in op),
        "formFit": sum(bool(r["final"] and r["final"]["fits"]) for r in op),
        "requestFit": sum(useful(r) for r in op),
        "questions": sum(
            bool(r["final"] and "Question" in r["final"]["components"]) for r in op
        ),
        "explicitOffers": len(offered),
        "offersMatched": sum(
            bool(r["final"] and r["final"]["matchesOffer"]) for r in offered
        ),
        "offersAnyFinal": sum(valid(r["final"]) for r in offered),
        "generalPractice": sum(bool(r["practiceDirective"]) for r in op),
        "generalPracticeFinal": sum(
            bool(r["practiceDirective"]) and valid(r["final"]) for r in op
        ),
        "noOfferFinal": sum(not r["offered"] and valid(r["final"]) for r in op),
        "pairedOffers": len(paired),
        "pairedMatchesWith": sum(r["drafts"][0]["matchesOffer"] for r in paired),
        "pairedMatchesWithout": sum(r["control"]["matchesOffer"] for r in paired),
        "pairedAnyWith": sum(valid(r["drafts"][0]) for r in paired),
        "pairedAnyWithout": sum(valid(r["control"]) for r in paired),
        "pairedMatchTransitions": dict(
            Counter(
                f"{int(r['drafts'][0]['matchesOffer'])} to {int(r['control']['matchesOffer'])}"
                for r in paired
            )
        ),
        "controls": len(ctl),
        "cleanProse": sum(
            bool(
                r["final"]
                and r["final"]["text"]
                and not r["final"]["marked"]
                and not r["final"]["toolNames"]
            )
            for r in ctl
        ),
        "offersOnControls": sum(bool(r["offered"]) for r in ctl),
        "lostAfterDraft": [
            r["id"]
            for r in op
            if any(valid(d) for d in r["drafts"]) and not valid(r["final"])
        ],
        "gainedAfterFirst": [
            r["id"] for r in op if not valid(r["drafts"][0]) and valid(r["final"])
        ],
        "releasedNative": [
            r["id"] for r in op if r["final"] and r["final"]["toolNames"]
        ],
        "withheld": [r["id"] for r in op if r["phase"] == "withheld"],
        "bestEffort": [r["id"] for r in op if r["unverified"]],
        "finalTypes": dict(
            Counter(
                component
                for r in op
                if r["final"]
                for component in r["final"]["components"]
            )
        ),
    }


names = {
    "gemini-3.1-flash-lite": "Gemini 3.1 Flash-Lite",
    "MiniMax-M2.7-highspeed": "MiniMax M2.7 Highspeed",
}
history = read("history/summary.json")
models = {m: cohort([r for r in primary if r["model"] == m]) for m in names}
stats = cohort(primary)
ledger = read("evidence/budget.json")
cost = {
    "modelCalls": dict(Counter(x["kind"] for x in ledger)),
    "accountedUpperUsd": sum(x["accountedUsd"] for x in ledger),
    "estimatedFromUsageUsd": sum(x["accountedUsd"] for x in ledger if x["measured"]),
    "withoutUsage": sum(not x["measured"] for x in ledger),
    "invoiceUsd": None,
}
repstats = {}
for m in names:
    rs = [r for r in repeats if r["model"] == m]
    repstats[m] = {
        "n": len(rs),
        "firstQuestions": sum(
            valid(r["drafts"][0]) and "Question" in r["drafts"][0]["components"]
            for r in rs
        ),
        "finalQuestions": sum(
            bool(r["final"] and "Question" in r["final"]["components"]) for r in rs
        ),
        "turns": [
            {
                "id": r["id"],
                "selectedAttempt": r["selection"],
                "phase": r["phase"],
                "final": r["final"]["components"] if r["final"] else None,
            }
            for r in rs
        ],
    }
summary = {
    "primary": stats,
    "models": models,
    "defaultPredictionRepeats": repstats,
    "cost": cost,
    "production": read("production.json"),
}
save("summary.json", summary)


def example(r, stage="final", title=None, note=None):
    case = scenarios[r["scenario"]]
    receipt = raw[r["id"]]
    if stage == "draft1":
        f = r["drafts"][0]
        status = "Private draft · rejected"
        segment = "Private draft"
    elif stage == "invalid":
        f = r["drafts"][0]
        status = "Rejected by the compiler"
        segment = "Private draft"
    else:
        f = r["final"]
        segment = "Gate output"
        if f is None:
            status = "Reply withheld"
        elif f["toolNames"]:
            status = "Native tool proposed"
        elif f["components"]:
            status = "Compiled " + " + ".join(f["components"])
        else:
            status = "Prose released"
    if r["offered"]:
        decision = "Offered " + ", ".join(r["offered"]) + "."
    elif r["practiceDirective"]:
        decision = "No component named. The tutor received a separate instruction to provide one OpenUI practice activity."
    else:
        decision = "No component named."
    if not note:
        note = (
            "The release renderer produced markup for this response."
            if f and f["components"]
            else "The released reply used prose."
        )
    if r["unverified"] and stage == "final":
        note += " The gate marked this reply as best effort."
    return {
        "title": title or case["title"],
        "cohort": f"November 18 · {segment}",
        "model": names[r["model"]],
        "prompt": case["prompt"],
        "decision": decision,
        "verdict": status,
        "note": note,
        "text": f["text"] if f else receipt.get("publicText", ""),
        "nodes": f["nodes"] if f else [],
        "receipt": r["id"],
    }


by = {(r["scenario"], r["model"]): r for r in primary}
g, m = names
examples = [
    example(
        by["prediction", g],
        note="The learner can commit to a probability before opening the hint.",
    ),
    example(
        by["prediction", m],
        "draft1",
        "Coin flip · first draft",
        "The question compiled. A sentence after the closing fence violated the rule to stop at the checkpoint.",
    ),
    example(
        by["prediction", m],
        title="Coin flip · released reply",
        note="The second Question had the same trailing-prose problem. The third draft passed with a prose question; the reviewer still flagged the missing control.",
    ),
    example(
        by["variable", g],
        note="At width 5 the two readouts are 20 square units and 18 units. Change width to 10 to get 40 and 28.",
    ),
    example(
        by["variable", m],
        note="The working slider is surrounded by 181 words of prose. Creating an interface and keeping the reply concise are separate outcomes.",
    ),
    example(
        by["recall", g],
        note="The tutor used a single short-answer Question. It gives the learner the requested retrieval practice while choosing another component than the one Jev offered.",
    ),
    example(
        by["recall", m],
        note="A private Flashcards draft compiled. The gate flagged the checkpoint ending and an answer leak, then released a one-line recall prompt.",
    ),
    example(
        by["order", g],
        note="Jev recognized that the steps need ordering. The practice filter removed the targeted Question offer. The general practice directive still produced an ordering control.",
    ),
    example(
        by["order", m],
        note="The second draft contained a valid ordering Question and failed the checkpoint-ending rule. The selected draft lists ten steps for the learner to reorder in chat.",
    ),
    example(
        by["structure", m],
        "invalid",
        "Food web · rejected diagram",
        "All three attempts failed the shared document contract. The harness withheld the reply.",
    ),
    example(
        by["structure", g],
        note="The gate released an interactive_page tool call. The probe ended at tool dispatch, so its resulting page and behavior are unknown.",
    ),
    example(
        by["code", g],
        note="The component compiles and the prose talks about Python. Its editor contains JavaScript. It misses the learner’s requested language.",
    ),
    example(
        by["code", m],
        note="This tutor preserved Python and gave three test inputs in prose. The release’s CodingChallenge accepts JavaScript or TypeScript.",
    ),
    example(
        by["fact", g],
        note="The learner asked only for the value. The entire reply was “24”.",
    ),
    example(
        by["brief", m],
        note="The learner asked for one sentence and no follow-up. The tutor honored both despite the Question offer.",
    ),
]
seen = {(r["model"], r["title"]) for r in examples}
for r in primary:
    x = example(r)
    if (x["model"], x["title"]) not in seen and r["scenario"] not in {
        "prediction",
        "structure",
    }:
        examples.append(x)
for e in history["examples"]:
    if e["id"] not in {
        "fraction-question",
        "fraction-text",
        "fraction-rejected",
        "taxi-simulation",
        "speed-flashcards",
        "coin-graded",
    }:
        continue
    titles = {
        "fraction-question": "More fractions · working Question",
        "fraction-text": "More fractions · prose",
        "fraction-rejected": "More fractions · rejected source",
        "taxi-simulation": "Taxi fare explorer",
        "speed-flashcards": "Speed recall cards",
        "coin-graded": "Coin flip · graded checkpoint",
    }
    examples.append(
        {
            "title": titles[e["id"]],
            "cohort": "September · "
            + ("Frozen CLI" if e["cohort"] == "cli" else "Checkpoint experiment"),
            "model": e["model"],
            "prompt": e["learner"],
            "decision": "This benchmark recorded no Jev component offer.",
            "verdict": e["outcome"].replace("_", " ").capitalize(),
            "note": e["feedback"]
            or "Recorded assistant output from the frozen terminal benchmark.",
            "text": e["reply"],
            "nodes": (e["document"] or {}).get("nodes", []),
        }
    )
view = {
    "headline": "When does Keating give the learner a control?",
    "dek": "Twenty synthetic tutoring turns through the 4.2.0 web draft gate. Compare the models, then try the interfaces they actually wrote.",
    "metrics": [
        {
            "label": "Interface released",
            "n": stats["validFinal"],
            "d": stats["opportunities"],
            "note": "Turns designed for learner action",
        },
        {
            "label": "Specific offer followed",
            "n": stats["offersMatched"],
            "d": stats["explicitOffers"],
            "note": "Offered opportunities, final component",
        },
        {
            "label": "Text requests honored",
            "n": stats["cleanProse"],
            "d": stats["controls"],
            "note": "Direct answers without an interface",
        },
    ],
    "models": [
        {
            "name": names[m],
            "opportunities": s["opportunities"],
            "attempted": s["markedPrivate"],
            "valid": s["validFinal"],
            "matched": s["requestFit"],
            "proseControlCount": s["controls"],
            "cleanProse": s["cleanProse"],
        }
        for m, s in models.items()
    ],
    "modeDescriptions": {
        "attempted": "At least one complete private tutor draft included a recognized OpenUI fence.",
        "valid": "The selected response contains a validated component. It also rendered to static markup with Keating 4.2.0.",
        "matched": "The released component fits the prespecified family and the learner’s explicit language. Gemini’s JavaScript exercise for a Python learner loses one here.",
    },
    "examples": examples,
    "historical": [
        {
            "name": entry["model"],
            "n": entry["turns"],
            "attempted": entry["recognized"],
            "valid": entry["valid"],
        }
        for entry in history["cli"]["models"]
    ],
    "historicalNote": "September 7 · headless Pi/CLI 3.2.0. 804 turn steps in 154 complete episodes. The frozen terminal adapter recognized 344 and presented a valid document on 204. Six of 40 natural requests for another exercise received a valid Question.",
    "production": "Production frequency is unknown. On 4.2.0, PostHog recorded 38 message-sent events, three turn starts and zero turn completions from November 11 through 17 UTC. The events lack Jev offer, compiled component and presentation fields.",
    "reportHref": "REPORT.md",
}
save("study-view.json", view)
print(
    json.dumps(
        {"primary": stats, "repeat": repstats, "cost": cost, "examples": len(examples)},
        indent=2,
    )
)
