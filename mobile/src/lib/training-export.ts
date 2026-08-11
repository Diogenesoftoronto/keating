import type {
  LearnerFeedbackEvent,
  LearnerMessage,
  LearnerSession,
  PortableLearnerData,
} from "@keating/learner-contracts";

export type TrainingMessage = { role: "system" | "user" | "assistant"; content: string };
export type TrainingQualityStatus = "accepted" | "unscored" | "review" | "rejected" | "reference";

export interface CanonicalTrainingRecord {
  schemaVersion: 2;
  id: string;
  split: "train" | "validation";
  task: "supervised-finetuning" | "preference-learning" | "reference";
  source: {
    type: "artifact" | "session";
    kind: string;
    topic?: string;
    sessionId?: string;
    sessionTitle?: string;
    messageTimestamp?: number;
    model?: { provider: string; id: string; name?: string };
  };
  messages: TrainingMessage[];
  prompt: TrainingMessage[];
  completion: string;
  quality: {
    status: TrainingQualityStatus;
    recommendedForSft: boolean;
    scored: boolean;
    reward?: number;
    signals?: Record<string, unknown>;
  };
  metrics: {
    promptCharacters: number;
    completionCharacters: number;
    messageCount: number;
  };
}

export interface NativeFineTuneExportResult {
  canonicalJsonl: string;
  chatmlJsonl: string;
  alpacaJsonl: string;
  rewardedJsonl?: string;
  ktoJsonl?: string;
  preferenceJsonl?: string;
  dpoTextJsonl?: string;
  grpoPromptsJsonl?: string;
  manifestJson: string;
  recordCount: number;
  exampleCount: number;
  skippedCount: number;
  redactionCount: number;
}

export interface NativeFineTuneExportOptions {
  redact?: boolean;
  minimumAssistantCharacters?: number;
  now?: Date;
}

export const MAX_NATIVE_TRAINING_SOURCE_CHARACTERS = 2_000_000;
export const MAX_NATIVE_TRAINING_MESSAGES = 20_000;

export class NativeTrainingExportTooLargeError extends Error {
  constructor() {
    super("This learning history is too large to package safely on this device. Export it from the Keating web app or desktop app instead.");
    this.name = "NativeTrainingExportTooLargeError";
  }
}

interface Candidate {
  id: string;
  source: CanonicalTrainingRecord["source"];
  messages: TrainingMessage[];
  quality: CanonicalTrainingRecord["quality"];
}

const SECRET_PATTERNS: RegExp[] = [
  /\bsk-ant-[A-Za-z0-9_-]{12,}\b/g,
  /\bsk-[A-Za-z0-9_-]{12,}\b/g,
  /\bAIza[A-Za-z0-9_-]{16,}\b/g,
  /\bghp_[A-Za-z0-9_]{12,}\b/g,
  /\bBearer\s+[A-Za-z0-9._-]{12,}\b/gi,
  /^[A-Z][A-Z0-9_]*_API_KEY\s*=\s*.+$/gm,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
];

function stableHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function safeId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "item";
}

function toJsonl(values: readonly unknown[]): string {
  return values.length ? `${values.map((value) => JSON.stringify(value)).join("\n")}\n` : "";
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

function artifactInstruction(kind: string, title: string): string {
  switch (kind) {
    case "study-plan": return `Create a Keating-style Socratic lesson plan for ${title}.`;
    case "lesson-map": return `Create a Mermaid concept map for ${title}.`;
    case "quiz": return `Create retrieval practice and an answer key for ${title}.`;
    case "animation": return `Create a teaching animation storyboard for ${title}.`;
    case "verification": return `Create a verification checklist before teaching ${title}.`;
    default: return `Create a Keating teaching artifact for ${title}.`;
  }
}

function feedbackByMessage(events: readonly LearnerFeedbackEvent[]): Map<string, LearnerFeedbackEvent> {
  const result = new Map<string, LearnerFeedbackEvent>();
  for (const event of events) {
    const prior = result.get(event.messageId);
    if (!prior || prior.createdAt < event.createdAt || (prior.createdAt === event.createdAt && prior.id < event.id)) {
      result.set(event.messageId, event);
    }
  }
  return result;
}

function qualityForFeedback(event?: LearnerFeedbackEvent): CanonicalTrainingRecord["quality"] {
  if (!event) return { status: "unscored", recommendedForSft: false, scored: false };
  const accepted = event.rating === "helpful";
  return {
    status: accepted ? "accepted" : "rejected",
    recommendedForSft: accepted,
    scored: true,
    reward: accepted ? 1 : 0,
    signals: { explicit: { feedbackId: event.id, rating: event.rating } },
  };
}

function sessionCandidates(
  session: LearnerSession,
  sessionTitle: string,
  latestFeedback: ReadonlyMap<string, LearnerFeedbackEvent>,
  minimumAssistantCharacters: number,
  redact: boolean,
  counters: { skipped: number; redactions: number },
): Candidate[] {
  const candidates: Candidate[] = [];
  const relevant = session.messages.filter((message) => message.role === "user" || message.role === "assistant");
  for (let index = 0; index < relevant.length - 1; index += 1) {
    const user = relevant[index];
    const assistant = relevant[index + 1];
    if (user?.role !== "user" || assistant?.role !== "assistant") continue;
    if (!user.content.trim() || assistant.content.trim().length < minimumAssistantCharacters) {
      counters.skipped += 1;
      continue;
    }
    const redactedUser = redactText(user.content.trim(), redact);
    const redactedAssistant = redactText(assistant.content.trim(), redact);
    counters.redactions += redactedUser.count + redactedAssistant.count;
    candidates.push({
      id: `session-${safeId(session.id)}-${safeId(assistant.id)}`,
      source: {
        type: "session",
        kind: "conversation",
        topic: sessionTitle,
        sessionId: session.id,
        sessionTitle,
        messageTimestamp: Date.parse(assistant.createdAt),
        model: session.model,
      },
      messages: [
        { role: "user", content: redactedUser.text },
        { role: "assistant", content: redactedAssistant.text },
      ],
      quality: qualityForFeedback(latestFeedback.get(assistant.id)),
    });
  }
  return candidates;
}

function assertNativeExportBound(data: PortableLearnerData): void {
  let messages = 0;
  let characters = 0;
  for (const artifact of data.artifacts) {
    characters += artifact.title.length + (artifact.content?.length ?? 0);
    if (characters > MAX_NATIVE_TRAINING_SOURCE_CHARACTERS) throw new NativeTrainingExportTooLargeError();
  }
  for (const session of data.sessions) {
    messages += session.messages.length;
    if (messages > MAX_NATIVE_TRAINING_MESSAGES) throw new NativeTrainingExportTooLargeError();
    characters += session.title.length;
    for (const message of session.messages) {
      characters += message.content.length;
      if (characters > MAX_NATIVE_TRAINING_SOURCE_CHARACTERS) throw new NativeTrainingExportTooLargeError();
    }
  }
}

function canonicalRecord(candidate: Candidate): CanonicalTrainingRecord {
  const completion = candidate.messages.at(-1)?.content ?? "";
  const prompt = candidate.messages.slice(0, -1);
  const fingerprint = JSON.stringify([
    ...prompt.map((message) => [message.role, message.content.trim()]),
    ["assistant", completion.trim()],
  ]);
  const sourceGroup = candidate.source.sessionId ?? candidate.id;
  return {
    schemaVersion: 2,
    id: `${candidate.id}-${stableHash(fingerprint).toString(36)}`,
    split: stableHash(sourceGroup) % 10 === 0 ? "validation" : "train",
    task: candidate.quality.status === "rejected" ? "preference-learning" : "supervised-finetuning",
    source: candidate.source,
    messages: candidate.messages,
    prompt,
    completion,
    quality: candidate.quality,
    metrics: {
      promptCharacters: prompt.reduce((sum, message) => sum + message.content.length, 0),
      completionCharacters: completion.length,
      messageCount: candidate.messages.length,
    },
  };
}

function dedupeCandidates(candidates: readonly Candidate[]): { records: CanonicalTrainingRecord[]; duplicateCount: number } {
  const seen = new Set<string>();
  const records: CanonicalTrainingRecord[] = [];
  let duplicateCount = 0;
  for (const candidate of candidates) {
    const record = canonicalRecord(candidate);
    const fingerprint = JSON.stringify(record.messages.map((message) => [message.role, message.content.trim()]));
    if (seen.has(fingerprint)) {
      duplicateCount += 1;
      continue;
    }
    seen.add(fingerprint);
    records.push(record);
  }
  return { records, duplicateCount };
}

function preferencePairs(records: readonly CanonicalTrainingRecord[]) {
  const groups = new Map<string, CanonicalTrainingRecord[]>();
  for (const record of records) {
    if (!record.quality.scored || record.source.type !== "session") continue;
    const key = JSON.stringify(record.prompt);
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  const pairs: Array<{ prompt: TrainingMessage[]; chosen: string; rejected: string }> = [];
  for (const group of groups.values()) {
    const accepted = group.filter((record) => record.quality.status === "accepted");
    const rejected = group.filter((record) => record.quality.status === "rejected");
    for (const chosen of accepted) {
      for (const bad of rejected) pairs.push({ prompt: chosen.prompt, chosen: chosen.completion, rejected: bad.completion });
    }
  }
  return pairs;
}

function fullConversation(
  session: LearnerSession,
  latestFeedback: ReadonlyMap<string, LearnerFeedbackEvent>,
  minimumAssistantCharacters: number,
  redact: boolean,
): TrainingMessage[] {
  const messages: TrainingMessage[] = [];
  let pendingUser: LearnerMessage | undefined;
  for (const message of session.messages) {
    if (message.role === "system" && message.content.trim()) {
      messages.push({ role: "system", content: redactText(message.content.trim(), redact).text });
    } else if (message.role === "user") {
      pendingUser = message;
    } else if (message.role === "assistant" && pendingUser) {
      const quality = qualityForFeedback(latestFeedback.get(message.id));
      if (message.content.trim().length >= minimumAssistantCharacters && quality.status !== "rejected") {
        messages.push(
          { role: "user", content: redactText(pendingUser.content.trim(), redact).text },
          { role: "assistant", content: redactText(message.content.trim(), redact).text },
        );
      }
      pendingUser = undefined;
    }
  }
  return messages;
}

export function buildNativeFineTuneExport(
  data: PortableLearnerData,
  options: NativeFineTuneExportOptions = {},
): NativeFineTuneExportResult {
  assertNativeExportBound(data);
  const redact = options.redact ?? true;
  const minimumAssistantCharacters = Math.max(1, Math.floor(options.minimumAssistantCharacters ?? 24));
  const now = options.now ?? new Date();
  const counters = { skipped: 0, redactions: 0 };
  const candidates: Candidate[] = [];
  const latestFeedback = feedbackByMessage(data.feedbackEvents);
  const sessionTitles = new Map<string, string>();
  for (const session of data.sessions) {
    const title = redactText(session.title, redact);
    counters.redactions += title.count;
    sessionTitles.set(session.id, title.text);
  }

  for (const artifact of data.artifacts) {
    const content = artifact.content?.trim();
    if (!content) {
      counters.skipped += 1;
      continue;
    }
    const redacted = redactText(content, redact);
    counters.redactions += redacted.count;
    const title = redactText(artifact.title, redact);
    counters.redactions += title.count;
    const instruction = artifactInstruction(artifact.kind, title.text);
    candidates.push({
      id: `artifact-${safeId(artifact.kind)}-${safeId(artifact.id)}`,
      source: { type: "artifact", kind: artifact.kind, topic: title.text },
      messages: [{ role: "user", content: instruction }, { role: "assistant", content: redacted.text }],
      quality: { status: "unscored", recommendedForSft: false, scored: false },
    });
  }
  for (const session of data.sessions) {
    candidates.push(...sessionCandidates(session, sessionTitles.get(session.id)!, latestFeedback, minimumAssistantCharacters, redact, counters));
  }

  const deduplicated = dedupeCandidates(candidates);
  const records = deduplicated.records;
  const sft = records.filter((record) => record.quality.status !== "rejected" && record.quality.status !== "reference");
  const scored = records.filter((record) => record.source.type === "session" && record.quality.scored);
  const pairs = preferencePairs(records);
  const chatml: Array<{
    messages: TrainingMessage[];
    keating: {
      source: string;
      title: string;
      sessionId?: string;
      model?: LearnerSession["model"];
      training: { id: string; kind: string; topic?: string };
    };
  }> = data.sessions.flatMap((session) => {
    const messages = fullConversation(session, latestFeedback, minimumAssistantCharacters, redact);
    if (!messages.some((message) => message.role === "user") || !messages.some((message) => message.role === "assistant")) return [];
    return [{
      messages,
      keating: {
        source: "keating-session-export",
        title: sessionTitles.get(session.id)!,
        sessionId: session.id,
        model: session.model,
        training: { id: `session-${safeId(session.id)}`, kind: "conversation", topic: sessionTitles.get(session.id)! },
      },
    }];
  });
  for (const record of sft.filter((candidate) => candidate.source.type === "artifact")) {
    chatml.push({
      messages: record.messages,
      keating: {
        source: "keating-training-export",
        title: record.source.topic ?? record.source.kind,
        training: { id: record.id, kind: record.source.kind, topic: record.source.topic },
      },
    });
  }

  const quality = { accepted: 0, unscored: 0, review: 0, rejected: 0, reference: 0 };
  for (const record of records) quality[record.quality.status] += 1;
  const trainRecords = records.filter((record) => record.split === "train").length;
  const kto = scored.map((record) => ({ prompt: record.prompt, completion: record.completion, label: record.quality.status === "accepted" }));
  const grpo = [...new Map(records.map((record) => [JSON.stringify(record.prompt), { prompt: record.prompt }])).values()];
  const manifest = {
    schemaVersion: 2,
    mode: "finetune",
    generatedAt: now.toISOString(),
    source: "all",
    format: "both",
    redactionEnabled: redact,
    minimumAssistantCharacters,
    judgeScoringEnabled: false,
    recommendedDataset: "data/keating.training.jsonl",
    splitStrategy: "Stable source-group hash (90% train / 10% validation)",
    counts: {
      artifactsRead: data.artifacts.length,
      sessionsRead: data.sessions.length,
      sandboxFilesRead: 0,
      sandboxCommitsRead: 0,
      examplesWritten: sft.length,
      canonicalRecords: records.length,
      trainRecords,
      validationRecords: records.length - trainRecords,
      sftExcluded: records.length - sft.length,
      duplicatesRemoved: deduplicated.duplicateCount,
      skipped: counters.skipped,
      redactions: counters.redactions,
      rewardedLines: scored.length,
      ktoLines: kto.length,
      preferenceLines: pairs.length,
      dpoTextLines: pairs.length,
      grpoPromptLines: grpo.length,
    },
    quality,
    rewardStats: {
      scored: scored.length,
      unscored: records.filter((record) => record.source.type === "session" && !record.quality.scored).length,
      bySource: { explicit: scored.length, inferred: 0, quiz: 0, judge: 0 },
    },
    warnings: [
      ...(sft.length === 0 ? ["No supervised fine-tuning examples were generated."] : []),
      ...(quality.unscored > 0 ? [`${quality.unscored} captured responses have no quality signal; review them before high-stakes training.`] : []),
      ...(pairs.length === 0 ? ["No explicit chosen/rejected response pairs were available, so DPO files are omitted."] : []),
      "Pattern-based redaction cannot guarantee removal of every personal or confidential value; inspect the canonical dataset before sharing.",
    ],
  };

  return {
    canonicalJsonl: toJsonl(records),
    chatmlJsonl: toJsonl(chatml),
    alpacaJsonl: toJsonl(sft.map((record) => ({
      instruction: record.prompt.at(-1)?.content ?? "",
      input: "",
      output: record.completion,
    }))),
    rewardedJsonl: toJsonl(scored.map((record) => ({
      id: record.id,
      sessionId: record.source.sessionId,
      topic: record.source.topic,
      messageTimestamp: record.source.messageTimestamp,
      messages: record.messages,
      reward: record.quality.reward,
      signals: record.quality.signals,
      scored: true,
    }))),
    ktoJsonl: toJsonl(kto),
    preferenceJsonl: toJsonl(pairs),
    dpoTextJsonl: toJsonl(pairs.map((pair) => ({
      prompt: pair.prompt.map((message) => `${message.role}: ${message.content}`).join("\n\n"),
      chosen: pair.chosen,
      rejected: pair.rejected,
    }))),
    grpoPromptsJsonl: toJsonl(grpo),
    manifestJson: `${JSON.stringify(manifest, null, 2)}\n`,
    recordCount: records.length,
    exampleCount: sft.length,
    skippedCount: counters.skipped,
    redactionCount: counters.redactions,
  };
}
