import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, extname, join, relative } from "node:path";

import {
  benchmarksDir,
  evolutionDir,
  exportsDir,
  mapsDir,
  plansDir,
  promptEvolutionDir,
  quizDir,
  sessionsDir,
  tracesDir,
  verificationsDir
} from "./paths.js";
import { slugify } from "./util.js";

export type ExportMode = "finetune";
export type ExportSource = "all" | "artifacts" | "sessions";
export type FineTuneFormat = "chatml" | "alpaca" | "both";

export interface KeatingExportOptions {
  mode: ExportMode;
  source: ExportSource;
  format: FineTuneFormat;
  outDir?: string;
  redact: boolean;
  minAssistantChars: number;
}

export interface KeatingExportManifest {
  schemaVersion: 1;
  mode: ExportMode;
  generatedAt: string;
  source: ExportSource;
  format: FineTuneFormat;
  counts: {
    artifactsRead: number;
    sessionsRead: number;
    examplesWritten: number;
    skipped: number;
    redactions: number;
  };
  files: string[];
  warnings: string[];
}

interface FineTuneExample {
  id: string;
  source: "artifact" | "session";
  kind: string;
  instruction: string;
  input?: string;
  output: string;
  messages?: Array<{ role: "user" | "assistant"; content: string }>;
}

interface BuildResult {
  examples: FineTuneExample[];
  corpusSections: string[];
  artifactsRead: number;
  sessionsRead: number;
  skipped: number;
  redactions: number;
  warnings: string[];
}

const DEFAULT_OPTIONS: KeatingExportOptions = {
  mode: "finetune",
  source: "all",
  format: "both",
  redact: true,
  minAssistantChars: 80,
};

const SECRET_PATTERNS: RegExp[] = [
  /\bsk-ant-[A-Za-z0-9_-]{12,}\b/g,
  /\bsk-[A-Za-z0-9_-]{12,}\b/g,
  /\bAIza[A-Za-z0-9_-]{16,}\b/g,
  /\bghp_[A-Za-z0-9_]{12,}\b/g,
  /\bBearer\s+[A-Za-z0-9._-]{12,}\b/gi,
  /^[A-Z][A-Z0-9_]*_API_KEY\s*=\s*.+$/gm,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
];

function normalizeOptions(options: KeatingExportOptions): KeatingExportOptions {
  return {
    ...DEFAULT_OPTIONS,
    ...options,
    minAssistantChars: Math.max(1, Math.floor(options.minAssistantChars || DEFAULT_OPTIONS.minAssistantChars)),
  };
}

function redactText(input: string, enabled: boolean): { text: string; count: number } {
  if (!enabled) return { text: input, count: 0 };
  let text = input;
  let count = 0;
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, () => {
      count += 1;
      return "[REDACTED]";
    });
  }
  return { text, count };
}

async function collectFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(full));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files.sort();
}

function titleFromPath(path: string): string {
  return basename(path, extname(path)).replace(/-/g, " ");
}

function artifactInstruction(kind: string, topic: string): string {
  switch (kind) {
    case "plan":
      return `Create a Keating-style Socratic lesson plan for ${topic}.`;
    case "quiz":
      return `Create retrieval practice and an answer key for ${topic}.`;
    case "map":
      return `Create a Mermaid concept map for ${topic}.`;
    case "verification":
      return `Create a verification checklist before teaching ${topic}.`;
    default:
      return `Create a Keating teaching artifact for ${topic}.`;
  }
}

function parseMessageText(message: any): string {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.map((part) => {
    if (typeof part === "string") return part;
    if (part?.type === "text" && typeof part.text === "string") return part.text;
    if (typeof part?.text === "string") return part.text;
    if (part?.type === "file" && typeof part.filename === "string") return `[Attachment: ${part.filename}]`;
    return "";
  }).filter(Boolean).join("\n");
}

function isBadAssistantText(text: string, message: any): boolean {
  if (message?.stopReason === "error") return true;
  return /__KEATING_ERROR__|authentication failed|no api key|stack trace|^\s*error:/i.test(text);
}

function sessionExamplesFromMessages(
  sessionId: string,
  messages: any[],
  options: KeatingExportOptions
): { examples: FineTuneExample[]; skipped: number; redactions: number; corpus: string } {
  const chatMessages: Array<{ role: "user" | "assistant"; content: string }> = [];
  let skipped = 0;
  let redactions = 0;

  for (const message of messages) {
    const rawRole = message?.role;
    const role = rawRole === "user" || rawRole === "user-with-attachments"
      ? "user"
      : rawRole === "assistant"
        ? "assistant"
        : null;
    if (!role) {
      skipped += 1;
      continue;
    }
    const rawText = parseMessageText(message).trim();
    if (!rawText) {
      skipped += 1;
      continue;
    }
    if (role === "assistant" && isBadAssistantText(rawText, message)) {
      skipped += 1;
      continue;
    }
    if (role === "assistant" && rawText.length < options.minAssistantChars) {
      skipped += 1;
      continue;
    }
    const redacted = redactText(rawText, options.redact);
    redactions += redacted.count;
    chatMessages.push({ role, content: redacted.text });
  }

  const examples: FineTuneExample[] = [];
  let pairIndex = 0;
  for (let i = 0; i < chatMessages.length - 1; i += 1) {
    const user = chatMessages[i];
    const assistant = chatMessages[i + 1];
    if (user?.role !== "user" || assistant?.role !== "assistant") continue;
    examples.push({
      id: `session-${slugify(sessionId)}-${pairIndex++}`,
      source: "session",
      kind: "conversation",
      instruction: user.content,
      output: assistant.content,
      messages: [user, assistant],
    });
  }

  const corpus = chatMessages.length
    ? [`## Session ${sessionId}`, ...chatMessages.map((m) => `**${m.role}:** ${m.content}`)].join("\n\n")
    : "";
  return { examples, skipped, redactions, corpus };
}

async function buildArtifactExamples(cwd: string, options: KeatingExportOptions): Promise<BuildResult> {
  const examples: FineTuneExample[] = [];
  const corpusSections: string[] = [];
  const warnings: string[] = [];
  let artifactsRead = 0;
  let skipped = 0;
  let redactions = 0;

  const artifactRoots = [
    { kind: "plan", root: plansDir(cwd), include: (path: string) => path.endsWith(".md") },
    { kind: "quiz", root: quizDir(cwd), include: (path: string) => path.endsWith(".md") },
    { kind: "map", root: mapsDir(cwd), include: (path: string) => path.endsWith(".mmd") },
    { kind: "verification", root: verificationsDir(cwd), include: (path: string) => path.endsWith(".md") },
  ];

  for (const { kind, root, include } of artifactRoots) {
    for (const file of (await collectFiles(root)).filter(include)) {
      const raw = await readFile(file, "utf8").catch(() => "");
      artifactsRead += 1;
      if (!raw.trim()) {
        skipped += 1;
        continue;
      }
      const topic = titleFromPath(file).replace(/\s+answers$/i, "");
      const redacted = redactText(raw.trim(), options.redact);
      redactions += redacted.count;
      examples.push({
        id: `${kind}-${slugify(relative(cwd, file))}`,
        source: "artifact",
        kind,
        instruction: artifactInstruction(kind, topic),
        output: redacted.text,
        messages: [
          { role: "user", content: artifactInstruction(kind, topic) },
          { role: "assistant", content: redacted.text },
        ],
      });
      corpusSections.push(`## ${kind}: ${relative(cwd, file)}\n\n${redacted.text}`);
    }
  }

  for (const root of [benchmarksDir(cwd), evolutionDir(cwd), promptEvolutionDir(cwd), tracesDir(cwd)]) {
    for (const file of await collectFiles(root)) {
      const info = await stat(file).catch(() => null);
      if (!info || info.size > 512_000) continue;
      const raw = await readFile(file, "utf8").catch(() => "");
      if (raw.trim()) {
        const redacted = redactText(raw.trim(), options.redact);
        redactions += redacted.count;
        corpusSections.push(`## Reference: ${relative(cwd, file)}\n\n${redacted.text}`);
      }
    }
  }

  return { examples, corpusSections, artifactsRead, sessionsRead: 0, skipped, redactions, warnings };
}

async function buildSessionExamples(cwd: string, options: KeatingExportOptions): Promise<BuildResult> {
  const examples: FineTuneExample[] = [];
  const corpusSections: string[] = [];
  const warnings: string[] = [];
  let sessionsRead = 0;
  let skipped = 0;
  let redactions = 0;

  for (const file of (await collectFiles(sessionsDir(cwd))).filter((path) => path.endsWith(".json"))) {
    const raw = await readFile(file, "utf8").catch(() => "");
    if (!raw.trim()) continue;
    try {
      const parsed = JSON.parse(raw);
      const messages = Array.isArray(parsed?.messages) ? parsed.messages : Array.isArray(parsed) ? parsed : [];
      if (!messages.length) {
        skipped += 1;
        continue;
      }
      sessionsRead += 1;
      const sessionId = typeof parsed?.id === "string" ? parsed.id : basename(file, ".json");
      const converted = sessionExamplesFromMessages(sessionId, messages, options);
      examples.push(...converted.examples);
      skipped += converted.skipped;
      redactions += converted.redactions;
      if (converted.corpus) corpusSections.push(converted.corpus);
    } catch {
      warnings.push(`Skipped invalid session JSON: ${relative(cwd, file)}`);
      skipped += 1;
    }
  }

  return { examples, corpusSections, artifactsRead: 0, sessionsRead, skipped, redactions, warnings };
}

function toChatMlJsonl(examples: FineTuneExample[]): string {
  return examples.map((example) => JSON.stringify({
    messages: example.messages ?? [
      { role: "user", content: example.instruction },
      { role: "assistant", content: example.output },
    ],
  })).join("\n") + (examples.length ? "\n" : "");
}

function toAlpacaJsonl(examples: FineTuneExample[]): string {
  return examples.map((example) => JSON.stringify({
    instruction: example.instruction,
    input: example.input ?? "",
    output: example.output,
  })).join("\n") + (examples.length ? "\n" : "");
}

function timestampSlug(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

function requirementsText(): string {
  return [
    "unsloth",
    "transformers",
    "datasets",
    "trl",
    "accelerate",
    "bitsandbytes",
    "peft",
    "",
  ].join("\n");
}

function unslothTrainScript(): string {
  return `#!/usr/bin/env python3
import argparse
from datasets import load_dataset
from trl import SFTTrainer, SFTConfig
from unsloth import FastLanguageModel

parser = argparse.ArgumentParser(description="Fine-tune a model on Keating export data with Unsloth.")
parser.add_argument("--data", default="train.chatml.jsonl")
parser.add_argument("--model", default="unsloth/gemma-3-4b-it")
parser.add_argument("--out", default="keating-lora")
parser.add_argument("--max-seq-length", type=int, default=4096)
parser.add_argument("--epochs", type=float, default=1)
args = parser.parse_args()

model, tokenizer = FastLanguageModel.from_pretrained(
    model_name=args.model,
    max_seq_length=args.max_seq_length,
    load_in_4bit=True,
)

model = FastLanguageModel.get_peft_model(
    model,
    r=16,
    target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
    lora_alpha=16,
    lora_dropout=0,
    bias="none",
)

dataset = load_dataset("json", data_files=args.data, split="train")

def render(example):
    if "messages" in example:
        return {"text": tokenizer.apply_chat_template(example["messages"], tokenize=False)}
    instruction = example.get("instruction", "")
    input_text = example.get("input", "")
    output = example.get("output", "")
    prompt = f"### Instruction:\\n{instruction}\\n\\n### Input:\\n{input_text}\\n\\n### Response:\\n{output}"
    return {"text": prompt}

dataset = dataset.map(render, remove_columns=dataset.column_names)

trainer = SFTTrainer(
    model=model,
    tokenizer=tokenizer,
    train_dataset=dataset,
    args=SFTConfig(
        output_dir=args.out,
        per_device_train_batch_size=2,
        gradient_accumulation_steps=4,
        num_train_epochs=args.epochs,
        learning_rate=2e-4,
        logging_steps=10,
        max_seq_length=args.max_seq_length,
    ),
)
trainer.train()
model.save_pretrained(args.out)
tokenizer.save_pretrained(args.out)
`;
}

function runpodReadme(): string {
  return `# Keating Fine-Tune Export on RunPod

1. Create a RunPod GPU pod with a CUDA/PyTorch image.
2. Upload this export directory to the pod.
3. Run:

\`\`\`bash
pip install -r requirements.txt
python unsloth_train.py --data train.chatml.jsonl --out keating-lora
\`\`\`

Use \`train.alpaca.jsonl\` if you exported Alpaca format only. Tune batch size, sequence length, and base model for your GPU memory.
`;
}

function runpodStartScript(): string {
  return `#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
pip install -r requirements.txt
python unsloth_train.py --data train.chatml.jsonl --out keating-lora
`;
}

export async function exportFineTuneDataset(
  cwd: string,
  inputOptions: KeatingExportOptions
): Promise<{ manifestPath: string; outDir: string; manifest: KeatingExportManifest }> {
  const options = normalizeOptions(inputOptions);
  if (options.mode !== "finetune") throw new Error(`Unsupported export mode: ${options.mode}`);

  const outDir = options.outDir ?? join(exportsDir(cwd), timestampSlug());
  await mkdir(join(outDir, "runpod"), { recursive: true });

  const parts: BuildResult[] = [];
  if (options.source === "all" || options.source === "artifacts") {
    parts.push(await buildArtifactExamples(cwd, options));
  }
  if (options.source === "all" || options.source === "sessions") {
    parts.push(await buildSessionExamples(cwd, options));
  }

  const examples = parts.flatMap((part) => part.examples);
  const warnings = parts.flatMap((part) => part.warnings);
  const skipped = parts.reduce((sum, part) => sum + part.skipped, 0);
  const redactions = parts.reduce((sum, part) => sum + part.redactions, 0);
  const artifactsRead = parts.reduce((sum, part) => sum + part.artifactsRead, 0);
  const sessionsRead = parts.reduce((sum, part) => sum + part.sessionsRead, 0);

  if (examples.length === 0) {
    throw new Error("No fine-tuning examples found. Run keating plan, quiz, verify, or use Keating chat sessions first.");
  }

  const files: string[] = [];
  if (options.format === "chatml" || options.format === "both") {
    const path = join(outDir, "train.chatml.jsonl");
    await writeFile(path, toChatMlJsonl(examples), "utf8");
    files.push(relative(cwd, path));
  }
  if (options.format === "alpaca" || options.format === "both") {
    const path = join(outDir, "train.alpaca.jsonl");
    await writeFile(path, toAlpacaJsonl(examples), "utf8");
    files.push(relative(cwd, path));
  }

  const corpusPath = join(outDir, "corpus.md");
  await writeFile(corpusPath, parts.flatMap((part) => part.corpusSections).join("\n\n---\n\n"), "utf8");
  files.push(relative(cwd, corpusPath));

  const requirementsPath = join(outDir, "requirements.txt");
  await writeFile(requirementsPath, requirementsText(), "utf8");
  files.push(relative(cwd, requirementsPath));

  const trainPath = join(outDir, "unsloth_train.py");
  await writeFile(trainPath, unslothTrainScript(), "utf8");
  files.push(relative(cwd, trainPath));

  const runpodReadmePath = join(outDir, "runpod", "README.md");
  await writeFile(runpodReadmePath, runpodReadme(), "utf8");
  files.push(relative(cwd, runpodReadmePath));

  const runpodStartPath = join(outDir, "runpod", "start.sh");
  await writeFile(runpodStartPath, runpodStartScript(), "utf8");
  files.push(relative(cwd, runpodStartPath));

  const manifest: KeatingExportManifest = {
    schemaVersion: 1,
    mode: "finetune",
    generatedAt: new Date().toISOString(),
    source: options.source,
    format: options.format,
    counts: {
      artifactsRead,
      sessionsRead,
      examplesWritten: examples.length,
      skipped,
      redactions,
    },
    files,
    warnings,
  };

  const manifestPath = join(outDir, "manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  manifest.files.unshift(relative(cwd, manifestPath));
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  return { manifestPath, outDir, manifest };
}
