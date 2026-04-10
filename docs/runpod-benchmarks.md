# Running Keating Benchmarks on RunPod

This guide explains how to deploy and execute Keating's pedagogical benchmarks on a RunPod cloud instance. Because the internal synthetic benchmark evaluates the underlying LLM's teaching capacity directly (by simulating conversations across thousands of topics and learner profiles), running it locally can be exceptionally slow. A RunPod serverless or GPU pod is highly recommended for accelerated evaluation.

## 1. Provision a Pod

1. Log into your [RunPod Console](https://www.runpod.io/console/pods).
2. Click **Deploy** to spin up a new Pod exactly as you would for any heavy ML workload.
3. **Select your GPU**: Depending on the underlying model you are running via the `pi` CLI, we recommend at least an RTX 3090 or A4000. For API-based models (like Gemini), a basic CPU pod is sufficient.
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

## 4. Setting up the `pi` Agent

Keating requires the `@mariozechner/pi-coding-agent` runtime CLI to talk to the LLMs.
If you have not already configured it, install it globally:

```bash
npm install -g @mariozechner/pi-coding-agent

# Run a quick check to configure your API keys or local model server details
pi -p "Say hello"
```
*Note: If you are using a local model on your RunPod GPU (like vLLM or Ollama), verify that your `pi` configuration points to your localhost inference port before starting.*

## 5. Running the Benchmarks

Keating's benchmarks evaluate 14 core topics mapped across 18 unique learner profile profiles (or 3 profiles during rapid evaluations).

To run the primary study analysis benchmark suite interactively:

```bash
node scripts/study-analysis.mjs
```

### Additional Benchmark Commands
If you wish to test a targeted pedagogical topic, use the compiled `pi` extension command:

```bash
# Run a targeted benchmark for a specific topic
pi eval "Provide the hyperteacher interface" --bench="derivative"
```

## 6. Accessing Artifacts
After the benchmark concludes, reports and JSON traces are emitted to the `benchmarks/` directory inside your Keating installation. You can pull these via SCP/SFTP, or just view the markdown tables using standard terminal tools:

```bash
cat /workspace/keating/benchmarks/core-suite.md
```
