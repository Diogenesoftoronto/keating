# /// script
# requires-python = ">=3.12"
# dependencies = [
#     "numpy>=2,<3",
#     "pandas==2.*",
#     "marimo==0.23.1",
#     "matplotlib==3.10.*",
#     "typer>=0.12",
# ]
# ///
"""The training pipeline, read-only: what a run would do before it does it.

Imports the planning functions from run_tinker.py and the request validators
from serve_pilot.py. Declares neither torch nor tinker, so the sampling and
training code paths are unreachable from here. Nothing is dispatched, nothing
is reserved, and nothing on disk is written outside a scratch temp directory.
"""

import marimo

__generated_with = "0.23.1"
app = marimo.App(width="medium")


@app.cell
def _():
    import hashlib
    import json
    import sys
    import tempfile
    from pathlib import Path

    import marimo as mo
    import matplotlib.pyplot as plt

    ROOT = Path(__file__).resolve().parents[1]
    sys.path.insert(0, str(ROOT / "scripts" / "training"))

    import run_tinker as rt
    import serve_pilot as sp
    from pilot_budget import PilotBudget

    # House palette, matching scripts/render-case-study-charts.py.
    INK, MUTED, GRID = "#254e63", "#536570", "#dce4e8"
    BLUE, TEAL, ORANGE = "#0072B2", "#00836B", "#C97900"
    PURPLE, GRAY = "#93679F", "#89969C"
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
        "svg.hashsalt": "keating-training-pipeline-notebook-v1",
    })
    return (BLUE, GRAY, INK, ORANGE, PURPLE, PilotBudget, Path, TEAL, hashlib,
            json, mo, plt, rt, sp, sys, tempfile)


@app.cell
def _(mo):
    mo.md(
        """
        # The training pipeline, read-only

        `run_tinker.py` is the SDPO-inspired PPO driver: it reads a frozen seed,
        builds student and teacher prompts, samples rollouts, and applies updates
        against a real budget. This notebook imports **only the part of it that
        decides what to do** — the planning and validation functions, which are pure
        and stdlib-only — and shows you what a run *would* do.

        **This notebook cannot dispatch.** Not by policy, by construction:

        - Every heavy import in the pipeline (`torch`, `tinker`, `tinker_cookbook`)
          happens *inside* `main()`, never at module scope. Importing `run_tinker`
          therefore loads typer, stdlib, and three local modules — nothing else.
        - This notebook's PEP-723 header declares neither torch nor tinker, so those
          packages are not even present in the sandbox uv builds for it.
        - No cell calls `PilotBudget.reserve()`. The budget file is never opened.

        The next cell proves the first point rather than asserting it.

        Live runs go through the CLI, which is the only path that can spend:
        `run_tinker.py --dry-run` first, then a real invocation that reserves against
        the authorized cap before it dispatches.
        """
    )
    return


@app.cell
def _(mo, sys):
    _watched = ("torch", "tinker", "tinker_cookbook", "httpx", "requests")
    _loaded = {name: name in sys.modules for name in _watched}
    _clean = not any(_loaded.values())
    _rows = "\n".join(
        f"| `{name}` | {'**LOADED**' if state else 'not loaded'} |"
        for name, state in _loaded.items()
    )
    mo.md(
        f"""
        ### Isolation check

        | module | status in this kernel |
        |---|---|
        {_rows}

        {"✅ No sampling or training dependency is loaded. Nothing here can reach the provider."
         if _clean else
         "⚠️ Something pulled a heavy dependency into this kernel. Stop and find out what."}
        """
    )
    return


@app.cell
def _(mo):
    mo.md(
        """
        ## 1. The seed

        `read_seed` expects a directory holding `train.jsonl`, `validation.jsonl`, and
        a `manifest.json` whose `output_sha256` maps each filename to its digest. It
        enforces three things, and refuses the run if any fails:

        1. **Each split's bytes hash to the manifest entry** — a seed cannot drift
           after it is frozen.
        2. **Every row's `split` field matches the file it came from** — no silently
           mislabeled rows.
        3. **No `family_id` appears in both splits** — the leak check. Families group
           sessions from the same subject, so one family on both sides would let the
           model be validated on what it trained on.

        The real seeds live under `.keating/outputs/training/`, which is gitignored —
        so this notebook builds its own. That is the honest choice: the code below
        runs the same `read_seed` you would run in production, against data you can
        see and change.
        """
    )
    return


@app.cell
def _(Path, hashlib, json, tempfile):
    def synth_row(index, split, family, turns=5):
        """A row shaped exactly like the real seed: see the schema in the manifest."""
        prompt = []
        for turn in range(turns):
            prompt.append({"role": "user", "content": f"Learner turn {turn} of case {index}."})
            if turn < turns - 1:
                prompt.append({"role": "assistant", "content": f"Teacher reply {turn}."})
        return {
            "id": hashlib.sha256(f"{split}-{index}".encode()).hexdigest(),
            "split": split,
            "family_id": hashlib.sha256(f"family-{family}".encode()).hexdigest(),
            "prompt": prompt,
            "historical_response": f"A historical answer for case {index}, plausible but unchecked.",
            "hint": "the teacher never asked me to show I understood it.",
            "provenance": {"feedback_signal": "negative", "synthetic": True},
        }

    def write_seed(rows_by_split):
        """Write a seed directory read_seed will accept, with real digests."""
        directory = Path(tempfile.mkdtemp(prefix="keating-notebook-seed-"))
        checksums = {}
        for split, rows in rows_by_split.items():
            path = directory / f"{split}.jsonl"
            body = ("\n".join(json.dumps(row) for row in rows) + "\n").encode()
            path.write_bytes(body)
            checksums[path.name] = hashlib.sha256(body).hexdigest()
        (directory / "manifest.json").write_text(json.dumps({
            "schema_version": 1,
            "method": "synthetic-notebook-seed",
            "records": sum(len(rows) for rows in rows_by_split.values()),
            "split_counts": {split: len(rows) for split, rows in rows_by_split.items()},
            "output_sha256": checksums,
            "limitations": ["Synthetic notebook fixture. Not training data."],
        }, indent=2))
        return directory

    class Prompt:
        """Stand-in for a rendered prompt: planned_reservation only reads .length."""
        def __init__(self, length):
            self.length = length

    return Prompt, synth_row, write_seed


@app.cell
def _(rt, synth_row, write_seed):
    seed_dir = write_seed({
        "train": [synth_row(i, "train", family=i) for i in range(4)],
        "validation": [synth_row(i, "validation", family=100 + i) for i in range(2)],
    })
    seed_splits, seed_manifest = rt.read_seed(seed_dir)
    return seed_dir, seed_manifest, seed_splits


@app.cell
def _(mo, seed_manifest, seed_splits):
    mo.md(
        f"""
        `read_seed` accepted the seed: **{len(seed_splits["train"])} train**,
        **{len(seed_splits["validation"])} validation** rows, all digests matching,
        no family on both sides.

        Manifest `output_sha256`:

        {chr(10).join(f"- `{name}` → `{digest[:24]}…`"
                      for name, digest in seed_manifest["output_sha256"].items())}
        """
    )
    return


@app.cell
def _(Path, mo, rt, seed_dir):
    # Flip one byte of a frozen split and confirm the integrity check fires.
    _tampered = Path(str(seed_dir) + "-tampered")
    _tampered.mkdir(exist_ok=True)
    for _name in ("train.jsonl", "validation.jsonl", "manifest.json"):
        (_tampered / _name).write_bytes((seed_dir / _name).read_bytes())
    _body = (_tampered / "train.jsonl").read_bytes()
    (_tampered / "train.jsonl").write_bytes(_body.replace(b"Learner turn 0", b"Learner turn X", 1))

    try:
        rt.read_seed(_tampered)
        _outcome = "⚠️ The tampered seed was accepted. That would be a bug."
    except ValueError as error:
        _outcome = f"✅ Rejected: **{error}**"

    mo.md(
        f"""
        ### What happens when a frozen seed changes

        One byte of `train.jsonl` edited, manifest left alone:

        {_outcome}

        This is why a seed can be quoted in a writeup by its digest. If the bytes
        move, the run stops instead of quietly training on different data.
        """
    )
    return


@app.cell
def _(mo):
    mo.md(
        """
        ## 2. Student and teacher prompts

        The SDPO idea in one function. `messages_for` builds the prompt twice from the
        same row:

        - the **student** sees the conversation as it happened,
        - the **teacher** sees the same conversation *plus* a retrospective note
          containing the historical response and the feedback it later received.

        The system message is byte-identical for both. The teacher's advantage is
        strictly the extra context, which is what makes the per-token difference
        between them a usable learning signal. Toggle the hint below and watch a
        single message appear.
        """
    )
    return


@app.cell
def _(mo):
    hint_toggle = mo.ui.switch(value=True, label="Teacher view (include retrospective hint)")
    tools_toggle = mo.ui.switch(value=False, label="Declare a tool")
    system_prompt_box = mo.ui.text(
        value="You are Keating. Draw understanding out; do not hand over answers.",
        label="System prompt", full_width=True,
    )
    mo.vstack([system_prompt_box, hint_toggle, tools_toggle])
    return hint_toggle, system_prompt_box, tools_toggle


@app.cell
def _(hint_toggle, rt, seed_splits, system_prompt_box, tools_toggle):
    built_messages = rt.messages_for(
        seed_splits["train"][0],
        system_prompt_box.value,
        hinted=hint_toggle.value,
        tools=[{"name": "record_feedback", "parameters": {"type": "object", "properties": {}}}]
        if tools_toggle.value else None,
    )
    return (built_messages,)


@app.cell
def _(built_messages, mo):
    _lines = []
    for _index, _message in enumerate(built_messages):
        _text = _message["content"]
        _shown = _text if len(_text) <= 180 else _text[:180] + "…"
        _lines.append(f"| {_index} | `{_message['role']}` | {_shown} |")
    mo.md(
        f"""
        **{len(built_messages)} messages**

        | # | role | content |
        |---|---|---|
        {chr(10).join(_lines)}

        Note the `tool_declare` role when tools are on — this renderer takes tools as
        a message, not as a separate API field.
        """
    )
    return


@app.cell
def _(mo):
    mo.md(
        """
        ## 3. Rollouts

        `rollout_batches` splits the requested updates into batches. Its bounds are
        not stylistic — it refuses anything outside **1–32 updates** and a batch size
        above **4**, because this is a pilot with a fixed cap, and an accidental extra
        zero would be expensive rather than merely wrong.
        """
    )
    return


@app.cell
def _(mo):
    steps_slider = mo.ui.slider(1, 32, value=10, label="Updates (steps)")
    batch_slider = mo.ui.slider(1, 4, value=4, label="Rollout batch size")
    mo.vstack([steps_slider, batch_slider])
    return batch_slider, steps_slider


@app.cell
def _(batch_slider, rt, steps_slider):
    batches = rt.rollout_batches(int(steps_slider.value), int(batch_slider.value))
    return (batches,)


@app.cell
def _(BLUE, ORANGE, batches, mo, plt):
    _fig, _ax = plt.subplots(figsize=(9, max(2.2, 0.42 * len(batches) + 1.0)))
    for _row, _batch in enumerate(batches):
        _full = len(_batch) == len(batches[0])
        _ax.barh(_row, len(_batch), left=_batch[0], height=0.62,
                 color=BLUE if _full else ORANGE)
        _ax.text(_batch[0] + len(_batch) / 2, _row, f"{len(_batch)}",
                 ha="center", va="center", color="white", fontweight="bold", fontsize=9)
    _ax.set_yticks(range(len(batches)))
    _ax.set_yticklabels([f"batch {i}" for i in range(len(batches))], fontsize=9)
    _ax.invert_yaxis()
    _ax.set_xlabel("Update index")
    _ax.set_title(f"{len(batches)} batches covering {sum(len(b) for b in batches)} updates")
    _fig.tight_layout()
    mo.vstack([_fig, mo.md(
        "Orange marks a short final batch — the remainder when updates do not divide "
        "evenly. Every update still runs; the last batch is just smaller."
    )])
    return


@app.cell
def _(mo):
    mo.md(
        """
        ## 4. What a run would reserve

        `planned_reservation` prices the whole run **before** anything is dispatched,
        at undiscounted rates and with a safety factor applied. It is deliberately
        pessimistic: the pilot reserves the worst case, and refunds the difference,
        rather than discovering mid-run that it has overspent.

        Per update it charges three things — sampling the student completion,
        prefilling student *and* teacher to score it, and the training pass itself.
        Validation adds two samples plus a scoring prefill per row, and a final
        evaluation charge (seven prompts with a parent comparison, one without).
        """
    )
    return


@app.cell
def _(mo):
    student_len_slider = mo.ui.slider(256, 8192, step=128, value=2048,
                                      label="Student prompt tokens")
    teacher_extra_slider = mo.ui.slider(0, 4096, step=64, value=512,
                                        label="Teacher extra tokens (the hint)")
    max_tokens_slider = mo.ui.slider(128, 2048, step=64, value=1024,
                                     label="Max completion tokens")
    parent_toggle = mo.ui.switch(value=True, label="Compare against parent checkpoint")
    cap_input = mo.ui.number(10, 1000, value=100, label="Authorized cap (USD)")
    mo.vstack([student_len_slider, teacher_extra_slider, max_tokens_slider,
               parent_toggle, cap_input])
    return (cap_input, max_tokens_slider, parent_toggle, student_len_slider,
            teacher_extra_slider)


@app.cell
def _(Prompt, max_tokens_slider, parent_toggle, rt, seed_splits,
      student_len_slider, steps_slider, teacher_extra_slider):
    reservation_rows = {split: [{"id": row["id"]} for row in rows]
                        for split, rows in seed_splits.items()}
    reservation_prompts = {
        row["id"]: (Prompt(int(student_len_slider.value)),
                    Prompt(int(student_len_slider.value) + int(teacher_extra_slider.value)))
        for rows in seed_splits.values() for row in rows
    }
    reservation_total = rt.planned_reservation(
        reservation_prompts, reservation_rows, int(steps_slider.value),
        int(max_tokens_slider.value), parent_toggle.value,
    )
    reservation_curve = [
        (step, rt.planned_reservation(reservation_prompts, reservation_rows, step,
                                      int(max_tokens_slider.value), parent_toggle.value))
        for step in range(1, 33)
    ]
    return reservation_curve, reservation_total


@app.cell
def _(PilotBudget, cap_input, mo, reservation_total, steps_slider):
    _cap = float(cap_input.value)
    _share = reservation_total / _cap
    mo.md(
        f"""
        ### Reserved: **${reservation_total:,.2f}** for {int(steps_slider.value)} updates

        That is **{_share:.1%}** of a ${_cap:,.0f} cap — {"comfortable" if _share < 0.5
        else "tight; a second run would not fit" if _share < 1.0
        else "**over the cap. This run would be refused.**"}

        Rates in use, from `PilotBudget` (USD per million tokens):

        | | rate |
        |---|---|
        | prefill | ${PilotBudget.PREFILL} |
        | sample | ${PilotBudget.SAMPLE} |
        | train | ${PilotBudget.TRAIN} |
        | safety factor | {PilotBudget.SAFETY_FACTOR}× |

        The reservation also carries a flat **$1.00** base charge, which is why the
        curve below does not start at zero.
        """
    )
    return


@app.cell
def _(BLUE, GRAY, ORANGE, cap_input, plt, reservation_curve, steps_slider):
    _steps = [step for step, _ in reservation_curve]
    _costs = [cost for _, cost in reservation_curve]
    _cap = float(cap_input.value)

    _fig, _ax = plt.subplots(figsize=(9, 4.4))
    _ax.plot(_steps, _costs, color=BLUE, linewidth=2)
    _ax.axhline(_cap, color=ORANGE, linestyle="--", linewidth=1.4)
    _ax.text(1, _cap, f" cap ${_cap:,.0f}", color=ORANGE, va="bottom", fontsize=9)
    _current = int(steps_slider.value)
    _ax.scatter([_current], [_costs[_current - 1]], color=BLUE, s=70, zorder=5)
    _ax.axvline(_current, color=GRAY, linestyle=":", linewidth=1)
    _ax.set_xlabel("Updates")
    _ax.set_ylabel("USD reserved")
    _ax.set_title("Reservation grows linearly in updates")
    _fig.tight_layout()
    _fig
    return


@app.cell
def _(mo):
    mo.md(
        """
        ## 5. Alignment guards

        `completion_lps` slices the completion's log probabilities out of a full
        sequence and refuses anything suspicious. Every rejection here is a real
        failure mode: a positive log probability is impossible, a `None` means the
        provider omitted a token, and a short slice means the prompt length and the
        returned sequence disagree — which would silently misalign every advantage
        downstream.
        """
    )
    return


@app.cell
def _(mo, rt):
    _cases = [
        ("Aligned slice", [-0.1, -0.2, -0.3, -0.4, -0.5], 2, 3),
        ("Slice runs past the end", [-0.1, -0.2, -0.3], 2, 3),
        ("Missing log probability", [-0.1, -0.2, None, -0.4, -0.5], 2, 3),
        ("Positive log probability", [-0.1, -0.2, 0.5, -0.4, -0.5], 2, 3),
        ("Non-finite value", [-0.1, -0.2, float("inf"), -0.4, -0.5], 2, 3),
    ]
    _rows = []
    for _label, _values, _prompt_length, _count in _cases:
        try:
            _result = rt.completion_lps(_values, _prompt_length, _count)
            _outcome = f"✅ `{_result}`"
        except ValueError as error:
            _outcome = f"❌ {error}"
        _rows.append(f"| {_label} | `{_values}` | {_outcome} |")
    mo.md(
        f"""
        | case | sequence | result |
        |---|---|---|
        {chr(10).join(_rows)}
        """
    )
    return


@app.cell
def _(mo, sp):
    mo.md(
        f"""
        ## 6. The request validators

        `serve_pilot.py` exposes the trained checkpoint behind an OpenAI-compatible
        endpoint. Its validators are strict by design — the pilot holds one
        generation lock and a fixed budget, so a malformed or oversized request is
        refused before it costs anything.

        Limits: prompt ≤ **{sp.MAX_PROMPT:,}** tokens, completion ≤
        **{sp.MAX_COMPLETION:,}**, context ≤ **{sp.MAX_CONTEXT:,}**, body ≤
        **{sp.MAX_BODY // 1024} KiB**. The model alias is `{sp.MODEL_ALIAS}`.

        Edit the payload below — it is passed to the real `validate_request`.
        """
    )
    return


@app.cell
def _(mo):
    payload_box = mo.ui.text_area(
        value="""{
  "model": "keating-pilot",
  "messages": [
    {"role": "system", "content": "You are Keating."},
    {"role": "user", "content": "Why do gear ratios change?"}
  ],
  "max_tokens": 512,
  "temperature": 0.7
}""",
        label="Request body", rows=12, full_width=True,
    )
    payload_box
    return (payload_box,)


@app.cell
def _(json, mo, payload_box, sp):
    try:
        _body = json.loads(payload_box.value)
    except json.JSONDecodeError as error:
        _verdict = f"❌ Not valid JSON: {error}"
    else:
        try:
            _messages, _tools, _limit, _temperature = sp.validate_request(_body)
            _verdict = (
                f"✅ Accepted — {len(_messages)} messages, {len(_tools)} tools, "
                f"completion limit {_limit}, temperature {_temperature}."
            )
        except sp.RequestError as error:
            _verdict = f"❌ **{error.status}** — {error.message}"
    mo.md(_verdict)
    return


@app.cell
def _(json, mo, sp):
    _variants = [
        ("Wrong model alias", {"model": "gpt-4"}),
        ("Unknown field", {"reasoning_effort": "high"}),
        ("Both completion limits", {"max_completion_tokens": 256}),
        ("Completion limit too large", {"max_tokens": 99999}),
        ("Temperature out of range", {"temperature": 3.0}),
        ("Conversation storage requested", {"store": True}),
        ("Constrained tool decoding", {"tools": [{"type": "function", "function": {
            "name": "f", "parameters": {"type": "object"}, "strict": True}}]}),
        ("Tool result with no pending call", {"messages": [
            {"role": "user", "content": "hi"},
            {"role": "tool", "tool_call_id": "nope", "content": "result"}]}),
        ("No user message", {"messages": [{"role": "system", "content": "hi"}]}),
    ]
    _base = {
        "model": sp.MODEL_ALIAS,
        "messages": [{"role": "user", "content": "Why do gear ratios change?"}],
        "max_tokens": 512,
    }
    _rows = []
    for _label, _patch in _variants:
        try:
            sp.validate_request({**_base, **_patch})
            _outcome = "⚠️ accepted"
        except sp.RequestError as error:
            _outcome = f"{error.status} — {error.message}"
        _rows.append(f"| {_label} | `{json.dumps(_patch)[:60]}` | {_outcome} |")
    mo.md(
        f"""
        ### Every rejection rule, exercised

        | what was changed | patch | response |
        |---|---|---|
        {chr(10).join(_rows)}

        The tool-result rule is the subtle one: `validate_messages` tracks pending
        tool call IDs and requires every one to be resolved, in order, before a
        non-tool message follows. A transcript that references a call that never
        happened is rejected rather than silently dropped.
        """
    )
    return


@app.cell
def _(mo):
    mo.md(
        """
        ## Running it for real

        Nothing above spends. When you do want a run:

        ```bash
        # 1. Plan only. Prints the reservation and exits without dispatching.
        uv run --project scripts/training run_tinker.py --dry-run

        # 2. The real thing. Reserves against the cap first, refuses if it will not fit.
        uv run --project scripts/training run_tinker.py
        ```

        The CLI reserves pessimistically under a file lock before the first request,
        so two concurrent runs cannot both believe they have the budget. That
        reservation is the single point where money is committed — and it is not
        reachable from this notebook.
        """
    )
    return


if __name__ == "__main__":
    app.run()
