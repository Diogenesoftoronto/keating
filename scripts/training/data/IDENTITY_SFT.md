# Keating identity and application SFT seed

`identity-sft.json` is the editable source: **36 training examples and 12 reserved
validation examples**. Each answer cites reviewed application-source anchors or
the [Inkling-Small release](https://thinkingmachines.ai/news/inkling-small/).
Examples are authored seed data, not real learner conversations or demonstrations
of successful model behavior.

The public identity requested by the user is **the latest version of Keating Bot**,
served as `keating-bot-latest`. **Inkling-Small is the underlying model from
Thinking Machines Lab**, disclosed when asked about the base model. This is a
deployment label to test through SFT, not an identity instruction added to the
system prompt. Teaching goals, retrieval practice,
tool/context boundaries, and the difference between interactive content and
executed actions supply the application facts. Examples omit prices, deployment
URLs, credentials, account identities, release versions, token limits, current
tool inventories, and claims that live feedback automatically updates weights.

The teaching philosophy explicitly references **generative learning theory**:
the learner selects, organizes, and connects ideas, rather than merely receiving
generated content. See [Fiorella and Mayer's introduction](https://assets.cambridge.org/97811070/69916/excerpt/9781107069916_excerpt.pdf).
The user's teaching design asks for supported challenge at the edge of current
understanding, considering alternatives, justifying reasoning, and applying
learning to real-world scenarios. Those are intended behaviors, not claims that
Keating has already demonstrated improved human learning. Support can include
hints and worked examples; difficulty and answer-withholding are not goals.

## Build

```sh
rtk proxy bun scripts/training/export_system_prompt.ts
rtk proxy env UV_CACHE_DIR=/tmp/keating-uv-cache \
  UV_PROJECT_ENVIRONMENT="$PWD/.keating/training-venv" \
  uv run --project scripts/training --locked python \
  scripts/training/prepare_identity_sft.py \
  --output-dir .keating/outputs/training/identity-sft-v3
```

Output is `.keating/outputs/training/identity-sft-v3/{train,validation}.jsonl` plus a
manifest, with mode 0600. The compiler refuses to overwrite an existing output
directory. Use `--output-dir` for a new revision. It verifies that the prompt
export still matches its application source hashes and that `--model-record`
identifies Inkling-Small. No provider requests or weight updates are made.

Every compiled row has `messages`, the actual exported `tools`, and audit fields
`id`, `family`, and `sources`. The system prompt is copied verbatim from the real
web builder. The FAQ answers belong in assistant targets, not in a new system
prompt. Training code must consume the audit fields as metadata, not prompt text.

## Training contract

Python dependencies are managed by `scripts/training/pyproject.toml` and
`uv.lock`; all Python command interfaces use Typer. Run each command with
`--help` for options. `--no-sync` may be added to `uv run` when using an already
verified environment while another training/serving process is active.

Use the same native `tml_v0` renderer and thinking effort as the deployed adapter.
Insert the exported tools as a `tool_declare` message after the system message.
Render with `TrainOnWhat.LAST_ASSISTANT_MESSAGE` and apply supervised
cross-entropy only to the resulting assistant target tokens. System, user, and
tool-declaration tokens must have zero loss weight. This dataset contains no
tool executions or invented tool results.

Keep this a small component of training; heavy repetition can teach canned
self-descriptions at the expense of normal tutoring. Before activation, compare
the base and candidate on the reserved FAQ questions and on independent tutoring
and tool-use tasks. Check accurate identity, concise relevant answers, unchanged
tool behavior, and the absence of identity boilerplate on unrelated questions.
Score semantic correctness rather than exact wording.

Validation questions use reserved question families but cover the same facts as
training. They check FAQ consistency, not unseen-fact generalization or teaching
effectiveness. Never train on the validation answers when reporting these checks.

The dataset is specific to Inkling-Small. Regenerate identity targets if the
underlying model changes. Mutable session capabilities and learner details
continue to come from the runtime. Fine-tuning makes a learned default; it does
not provide an authoritative live model registry or replace the system prompt.
