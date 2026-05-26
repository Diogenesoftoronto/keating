# Keating Hyperteacher Tutorial

> *"Identity exists; the powerful play goes on. What will your verse be?"*

Keating is a hyperteacher scaffold designed to ensure that technology serves as a bridge to independent human understanding, not a shortcut to rote agreement. This guide will help you set up the environment and use Keating from both a teacher's and a student's perspective.

---

## 1. Prerequisites & Installation

Keating runs on top of the **Pi agent**. 

### Install Pi
The recommended way to install Pi is via `npm` or `bun`:

```bash
# Using npm
npm install -g @earendil-works/pi-coding-agent

# Or using bun
bun add -g @earendil-works/pi-coding-agent
```

### Install Keating
Install via npm or use the curl installer:

```bash
# Using npm
npm install -g keating

# Or via curl installer (macOS/Linux)
curl -fsSL https://raw.githubusercontent.com/Diogenesoftoronto/keating/main/scripts/install/install.sh | bash
```

Or clone and build from source:

Or clone and build from source:
```bash
git clone https://github.com/Diogenesoftoronto/keating.git
cd keating
bun install
```

### API Keys
Keating requires an API key for the "Smart Teacher" logic (defaults to Gemini). You can set this in a `.env` file or use the `skate` secret manager if available.

```bash
echo "GEMINI_API_KEY=your_key_here" > .env
```

In the web app, open **Settings -> Providers & Models** and paste the key beside the provider. If you do not have one yet:

- Gemini: <https://aistudio.google.com/app/apikey>
- OpenAI: <https://platform.openai.com/api-keys>
- Anthropic: <https://console.anthropic.com/>

---

## 2. Teacher's Objective: Building the Scaffold

As a teacher, your goal is to generate high-quality, deterministic artifacts that ground the student's learning session.

### Generating Artifacts
Use the Keating CLI to build the foundations for a topic:

```bash
# 1. Generate a lesson plan
mise run plan -- "Special Relativity"

# 2. Generate a meaning map (visual diagram)
mise run map -- "Special Relativity"

# 3. Generate an animated teaching artifact
mise run animate -- "Special Relativity"
```

These artifacts are stored in `.keating/outputs/`. You can inspect them to ensure the "intuition first" logic is sound before the student starts.

### Verifying Knowledge
Before teaching, ensure the AI's claims are verified:
```bash
mise run verify -- "Special Relativity"
```
This runs a **Chain-of-Verification (CoVe)** loop to fact-check the topic's core claims.

---

## 3. Student's Objective: Finding the Voice

As a student, you use Keating to move beyond surface understanding. The teacher will explicitly penalize you if you just repeat its words.

### Starting a Session
Launch the interactive Pi shell with the Keating extension loaded:

```bash
mise run shell
```

Inside the shell, you can use specialized slash-commands:

- `/learn <topic>`: Start an adaptive lesson.
- `/map <topic>`: View the visual map of the concept.
- `/quiz <topic>`: Test your reconstruction of the idea.
- `/feedback <up|down|confused>`: Tell the system how the pedagogy is working for you.

### The Mandate of Divergence
When Keating explains something, **do not just say "I understand."**
Instead:
- Explain it back using a completely different analogy.
- Connect it to your own life or a different field of study.
- If you use the AI's exact phrasing, it will ask you to "say it again, but in your own voice."

---

## 4. Advanced Setup: Web UI

If you prefer a visual chat interface over the terminal, you can use Pi's web capabilities.

1. **Local Web Server:** Some versions of Pi support a `--web` flag to launch a local UI.
2. **Hosted Pi:** If you are using a hosted version of the Pi runtime, ensure you upload the `pi/skills/` and `pi/prompts/` directories from this repo to your agent configuration.

---

## 5. Improving the Teacher

Keating is a self-improving system. If you find a certain topic isn't being taught well:

```bash
# Run the synthetic benchmark to find weaknesses
mise run bench

# Evolve the teaching policy to optimize for better outcomes
mise run evolve
```

The system will mutate its internal parameters (analogy density, Socratic ratio, etc.) until it finds a policy that better empowers the human voice.

---

## 6. Exporting Keating Data for Fine-Tuning

Keating can export its teaching artifacts and saved tutoring sessions as training-ready JSONL.

```bash
keating export --finetune
keating export --finetune --source=artifacts --format=chatml
keating export --finetune --source=sessions --format=alpaca --out=.keating/exports/session-run
```

Options:

- `--source=all|artifacts|sessions`
- `--format=chatml|alpaca|both`
- `--no-redact` to disable secret redaction
- `--min-assistant-chars=N` to skip short assistant replies

The export writes:

```text
.keating/outputs/exports/<timestamp>/
  manifest.json
  train.chatml.jsonl
  train.alpaca.jsonl
  corpus.md
  requirements.txt
  unsloth_train.py
  runpod/
    README.md
    start.sh
```

The web app exposes the same workflow from **Usage -> Fine-tune export**. Choose ChatML, Alpaca, or both, then download the generated dataset and manifest.

### Unsloth Studio

Use Unsloth Studio when you want a visual training workflow:

```bash
pip install unsloth
unsloth studio -H 0.0.0.0 -p 8888
```

Docs: <https://unsloth.ai/docs>

### RunPod

For cloud GPU experiments, upload the export directory to a RunPod pod and run:

```bash
pip install -r requirements.txt
python unsloth_train.py --data train.chatml.jsonl --out keating-lora
```

The generated `runpod/start.sh` wraps this command. Tune the base model, sequence length, and batch size for the GPU you rent.

### Doc-to-LoRA and Feynman

Doc-to-LoRA is an advanced research path for turning documents into LoRA adapters: <https://pub.sakana.ai/doc-to-lora/>.

Feynman can be used alongside Keating as a research and replication harness for literature review, recipes, and training checks: <https://feynman.is>.
