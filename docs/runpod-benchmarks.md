# Running Keating Analysis on RunPod

This guide explains how to deploy Keating on a RunPod cloud instance for remote analysis or development. The paper's quantitative study does **not** require a GPU: `scripts/study-analysis.mjs` forces the deterministic synthetic fallback, evaluates 14 topics with three simulated learners per topic, and normally completes locally in seconds. The product CLI benchmark likewise uses recorded learner evidence rather than the optional LLM judge. A GPU is useful only for separate model-assisted experiments or when another Keating workflow uses a provider hosted on the pod.

## 1. Provision a Pod

1. Log into your [RunPod Console](https://www.runpod.io/console/pods).
2. Click **Deploy** to spin up a new Pod exactly as you would for any heavy ML workload.
3. **Select compute**: A basic CPU pod is sufficient for the documented paper analysis and product benchmark. Choose a GPU only if a separate workflow will run a local model through Pi, vLLM, or Ollama.
4. **Template**: Choose the **RunPod PyTorch** base image (which sits atop Ubuntu and includes useful build tools) or the standard **Ubuntu 22.04** image.
5. Deploy and expose any storage volume sizes you need. 

## 2. Environment Setup

Once your Pod is running, connect via the Web Terminal or SSH and set up the Node/Bun environment.

```bash
# Update base repositories
apt-get update && apt-get install -y curl git unzip

# Install Bun (for fast dependencies and building)
curl -fsSL https://bun.sh/install | bash
source ~/.bashrc

# Install Node.js (v20+ recommended for pi-agent dependencies)
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
```

## 3. Clone and Build Keating

Clone the repository directly into your workspace:

```bash
cd /workspace
git clone https://github.com/Diogenesoftoronto/keating.git
cd keating

# Install dependencies using Bun
bun install

# Build the core extensions and web UI
bun run build
```

## 4. Optional: Setting up the `pi` Agent

Keating requires the `@earendil-works/pi-coding-agent` runtime CLI to talk to the LLMs.
If you have not already configured it, install it globally:

```bash
npm install -g @earendil-works/pi-coding-agent

# Run a quick check to configure your API keys or local model server details
pi -p "Say hello"
```
*Note: If you are using a local model on your RunPod GPU (like vLLM or Ollama), verify that your `pi` configuration points to your localhost inference port before starting.*

## 5. Running the Benchmarks

To reproduce the paper's deterministic analysis on the minimal Bun-based pod configured above, run:

```bash
bun scripts/study-analysis.mjs
```

The script evaluates 14 core topics with three deterministic synthetic learners per topic. It does not call an LLM, even if model credentials are present. The canonical `keating:study-analysis` and `keating:paper` tasks additionally require the repository's declared devenv environment, which supplies Typst; build the PDF there after pulling the generated artifacts back from the pod.

For an ordinary product benchmark, use the CLI. Keating evaluates recorded learner outcomes when they are available and reports insufficient or missing learner evidence when they are not; the CLI does not silently substitute the paper's synthetic fallback:

```bash
bun src/cli/main.ts bench
bun src/cli/main.ts bench derivative
```

## 6. Accessing Artifacts

Paper analysis outputs are written to `docs/generated/`. Product benchmark reports are written to `.keating/outputs/benchmarks/` in the working project. You can pull these via SCP/SFTP or inspect them in the terminal:

```bash
cat /workspace/keating/docs/generated/study-analysis.md
ls /workspace/keating/.keating/outputs/benchmarks
```
