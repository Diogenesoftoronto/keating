import {
  KEATING_VOICE_TOOL_NAME,
  VOICE_TAGS,
  normalizeVoiceUtterance,
  voiceTagLine
} from "../../../core/speech.js";
import type { KeatingConfig } from "../../../core/config.js";

const speechToolRegistrations = new WeakSet<object>();

function voiceToolParameters(): any {
  return {
    type: "object",
    additionalProperties: false,
    required: ["text"],
    properties: {
      text: {
        type: "string",
        description: "Short learner-facing sentence or question to speak. Keep it conversational and concise."
      },
      voice: {
        type: "string",
        description: "Optional voice identity. Defaults to Keating's configured speech.defaultVoice."
      },
      tags: {
        type: "array",
        description: "Voice tags that describe the teaching move.",
        items: {
          type: "string",
          enum: VOICE_TAGS
        }
      },
      pace: {
        type: "string",
        enum: ["slow", "normal", "quick"],
        description: "Delivery pace."
      },
      affect: {
        type: "string",
        enum: ["warm", "curious", "firm", "celebratory"],
        description: "Conversational affect."
      },
      listenFor: {
        type: "string",
        description: "What the supervising reasoning loop should listen for or verify after this utterance."
      }
    }
  };
}

export function registerSpeechTool(pi: any, config: KeatingConfig): void {
  if (!config.speech.enabled || typeof pi.registerTool !== "function") return;
  if (typeof pi === "object" && pi !== null && speechToolRegistrations.has(pi)) return;

  pi.registerTool({
    name: KEATING_VOICE_TOOL_NAME,
    label: "Keating Voice",
    description: "Emit a concise voice-tagged teaching utterance for an optional conversational speech layer.",
    promptSnippet: "Speak brief learner-facing utterances with voice tags while the normal model continues reasoning, questioning, and verification.",
    promptGuidelines: [
      "Use keating_voice only when speech is useful for a learner-facing sentence, question, redirect, recap, or encouragement.",
      "Use keating_voice for short conversational delivery; keep deeper reasoning, verification, and tool-backed correction in normal text and normal tools.",
      "Use keating_voice tags to mark the teaching move, especially question, verify, redirect, encourage, pause, recap, and explain.",
      "Do not use keating_voice for citations, long derivations, file paths, code blocks, or private reasoning."
    ],
    parameters: voiceToolParameters(),
    async execute(_toolCallId: string, params: any) {
      const utterance = normalizeVoiceUtterance(params, config.speech);
      return {
        content: [{ type: "text", text: voiceTagLine(utterance) }],
        details: {
          provider: "tags-only",
          fastModel: config.speech.fastModel,
          steeringModel: config.speech.steeringModel,
          utterance
        }
      };
    }
  });

  if (typeof pi === "object" && pi !== null) {
    speechToolRegistrations.add(pi);
  }
}
