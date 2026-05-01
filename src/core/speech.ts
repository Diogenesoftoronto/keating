import type { KeatingConfig } from "./config.js";

export const KEATING_VOICE_TOOL_NAME = "keating_voice";

export const VOICE_TAGS = [
  "explain",
  "question",
  "verify",
  "redirect",
  "encourage",
  "pause",
  "recap"
] as const;

export type VoiceTag = (typeof VOICE_TAGS)[number];

export interface VoiceUtteranceInput {
  text: string;
  voice?: string;
  tags?: string[];
  pace?: "slow" | "normal" | "quick";
  affect?: "warm" | "curious" | "firm" | "celebratory";
  listenFor?: string;
}

export interface VoiceUtterance {
  text: string;
  voice: string;
  tags: VoiceTag[];
  pace: "slow" | "normal" | "quick";
  affect: "warm" | "curious" | "firm" | "celebratory";
  listenFor?: string;
}

const DEFAULT_TAGS: VoiceTag[] = ["explain"];
const DEFAULT_PACE: VoiceUtterance["pace"] = "normal";
const DEFAULT_AFFECT: VoiceUtterance["affect"] = "warm";

function isVoiceTag(value: string): value is VoiceTag {
  return (VOICE_TAGS as readonly string[]).includes(value);
}

function cleanText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function normalizeVoiceUtterance(
  input: VoiceUtteranceInput,
  speech: KeatingConfig["speech"]
): VoiceUtterance {
  const text = cleanText(input.text);
  if (!text) {
    throw new Error("keating_voice requires non-empty text.");
  }

  const tags = (input.tags ?? [])
    .map(tag => cleanText(tag).toLowerCase())
    .filter(isVoiceTag);

  return {
    text,
    voice: cleanText(input.voice) || speech.defaultVoice,
    tags: tags.length > 0 ? tags : DEFAULT_TAGS,
    pace: input.pace ?? DEFAULT_PACE,
    affect: input.affect ?? DEFAULT_AFFECT,
    listenFor: input.listenFor ? cleanText(input.listenFor) : undefined
  };
}

export function voiceTagLine(utterance: VoiceUtterance): string {
  const attrs = [
    `voice=${utterance.voice}`,
    `tags=${utterance.tags.join(",")}`,
    `pace=${utterance.pace}`,
    `affect=${utterance.affect}`,
    utterance.listenFor ? `listen_for=${utterance.listenFor}` : undefined
  ].filter(Boolean);

  return `[voice ${attrs.join(" ")}] ${utterance.text}`;
}

export function speechStrategySummary(speech: KeatingConfig["speech"]): string {
  return [
    `speech=${speech.enabled ? "enabled" : "disabled"}`,
    `voice=${speech.defaultVoice}`,
    `fast_model=${speech.fastModel ?? "unset"}`,
    `steering_model=${speech.steeringModel ?? "default"}`
  ].join("\n");
}
