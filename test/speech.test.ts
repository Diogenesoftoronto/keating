import { test, expect } from "bun:test";

import { DEFAULT_KEATING_CONFIG } from "../src/core/config.js";
import {
  normalizeVoiceUtterance,
  speechStrategySummary,
  voiceTagLine
} from "../src/core/speech.js";

test("speech utterance normalizes text, voice, and valid tags", () => {
  const utterance = normalizeVoiceUtterance(
    {
      text: "  What do you think happens next?  ",
      tags: ["question", "verify", "not-real"],
      pace: "quick",
      affect: "curious",
      listenFor: "learner predicts the sign change"
    },
    DEFAULT_KEATING_CONFIG.speech
  );

  expect(utterance).toEqual({
    text: "What do you think happens next?",
    voice: "conversational",
    tags: ["question", "verify"],
    pace: "quick",
    affect: "curious",
    listenFor: "learner predicts the sign change"
  });
});

test("speech utterance renders a stable voice tag line", () => {
  const utterance = normalizeVoiceUtterance(
    {
      text: "Try saying that in your own words.",
      voice: "coach",
      tags: ["redirect"],
      affect: "firm"
    },
    DEFAULT_KEATING_CONFIG.speech
  );

  expect(voiceTagLine(utterance)).toBe(
    "[voice voice=coach tags=redirect pace=normal affect=firm] Try saying that in your own words."
  );
});

test("speech summary exposes optional fast and steering models", () => {
  expect(speechStrategySummary({
    enabled: true,
    defaultVoice: "coach",
    fastModel: "fast-voice",
    steeringModel: "standard-verifier"
  })).toContain("fast_model=fast-voice");
});

test("speech utterance rejects empty text", () => {
  expect(() => normalizeVoiceUtterance({ text: "   " }, DEFAULT_KEATING_CONFIG.speech)).toThrow(
    "keating_voice requires non-empty text."
  );
});
