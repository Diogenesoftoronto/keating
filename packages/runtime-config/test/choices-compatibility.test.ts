/** Preserve the shipped selectable menus, labels, hints and live-session metadata. */
import { expect, test } from "bun:test";
import { DEFAULT_MODELS, LIVE_MODEL_CHOICES, MODEL_CHOICES } from "../src/index.js";
import * as runtimeConfig from "../src/index.js";
const shipped = {
  "cliSetup": {
    "notorganic": [
      {
        "label": "Balanced",
        "value": "balanced",
        "hint": "Five-minute device-bound capability"
      }
    ],
    "zyphra": [
      {
        "label": "ZAYA1-8B",
        "value": "zyphra/ZAYA1-8B",
        "hint": "Recommended"
      },
      {
        "label": "Custom",
        "value": "custom",
        "hint": "Type a model name"
      }
    ],
    "openrouter": [
      {
        "label": "Poolside Laguna M.1 (free)",
        "value": "poolside/laguna-m.1:free",
        "hint": "Recommended"
      },
      {
        "label": "Poolside Laguna XS.2 (free)",
        "value": "poolside/laguna-xs.2:free",
        "hint": "Faster/smaller"
      },
      {
        "label": "OpenAI GPT-OSS 120B (free)",
        "value": "openai/gpt-oss-120b:free"
      },
      {
        "label": "DeepSeek V4 Flash (free)",
        "value": "deepseek/deepseek-v4-flash:free"
      },
      {
        "label": "Google Gemma 4 31B (free)",
        "value": "google/gemma-4-31b-it:free"
      },
      {
        "label": "Nvidia Nemotron 120B (free)",
        "value": "nvidia/nemotron-3-super-120b-a12b:free"
      },
      {
        "label": "MoonshotAI Kimi K2.6 (free)",
        "value": "moonshotai/kimi-k2.6:free"
      },
      {
        "label": "Custom",
        "value": "custom",
        "hint": "Type a model name"
      }
    ],
    "google": [
      {
        "label": "Gemini 3.1 Pro Preview",
        "value": "gemini-3.1-pro-preview",
        "hint": "Recommended"
      },
      {
        "label": "Gemini 3.5 Flash",
        "value": "gemini-3.5-flash",
        "hint": "Faster"
      },
      {
        "label": "Gemma 31b",
        "value": "gemma-31b-it",
        "hint": "Free"
      },
      {
        "label": "Custom",
        "value": "custom",
        "hint": "Type a model name"
      }
    ],
    "openai": [
      {
        "label": "GPT-5.5",
        "value": "gpt-5.5",
        "hint": "Recommended"
      },
      {
        "label": "GPT-5.5 Pro",
        "value": "gpt-5.5-pro"
      },
      {
        "label": "GPT-5.4",
        "value": "gpt-5.4"
      },
      {
        "label": "Custom",
        "value": "custom",
        "hint": "Type a model name"
      }
    ],
    "anthropic": [
      {
        "label": "Claude Sonnet 5",
        "value": "claude-sonnet-5",
        "hint": "Recommended"
      },
      {
        "label": "Claude Opus 4.8",
        "value": "claude-opus-4-8"
      },
      {
        "label": "Claude Fable 5",
        "value": "claude-fable-5"
      },
      {
        "label": "Claude Haiku 4.5",
        "value": "claude-haiku-4-5",
        "hint": "Faster"
      },
      {
        "label": "Custom",
        "value": "custom",
        "hint": "Type a model name"
      }
    ],
    "custom": [
      {
        "label": "Custom",
        "value": "custom",
        "hint": "Type a model name"
      }
    ]
  },
  "piSetup": {
    "zyphra": [
      {
        "label": "ZAYA1-8B",
        "value": "zyphra/ZAYA1-8B",
        "hint": "Recommended"
      },
      {
        "label": "Custom",
        "value": "custom",
        "hint": "Type a model name"
      }
    ],
    "openrouter": [
      {
        "label": "Poolside Laguna M.1 (free)",
        "value": "poolside/laguna-m.1:free",
        "hint": "Recommended"
      },
      {
        "label": "Poolside Laguna XS.2 (free)",
        "value": "poolside/laguna-xs.2:free",
        "hint": "Faster/smaller"
      },
      {
        "label": "OpenAI GPT-OSS 120B (free)",
        "value": "openai/gpt-oss-120b:free"
      },
      {
        "label": "DeepSeek V4 Flash (free)",
        "value": "deepseek/deepseek-v4-flash:free"
      },
      {
        "label": "Google Gemma 4 31B (free)",
        "value": "google/gemma-4-31b-it:free"
      },
      {
        "label": "Nvidia Nemotron 120B (free)",
        "value": "nvidia/nemotron-3-super-120b-a12b:free"
      },
      {
        "label": "MoonshotAI Kimi K2.6 (free)",
        "value": "moonshotai/kimi-k2.6:free"
      },
      {
        "label": "Custom",
        "value": "custom",
        "hint": "Type a model name"
      }
    ],
    "google": [
      {
        "label": "Gemini 3.1 Pro Preview",
        "value": "gemini-3.1-pro-preview",
        "hint": "Recommended"
      },
      {
        "label": "Gemini 3.5 Flash",
        "value": "gemini-3.5-flash",
        "hint": "Faster"
      },
      {
        "label": "Gemini 3 Pro Preview",
        "value": "gemini-3-pro-preview"
      },
      {
        "label": "Custom",
        "value": "custom",
        "hint": "Type a model name"
      }
    ],
    "openai": [
      {
        "label": "GPT-5.5",
        "value": "gpt-5.5",
        "hint": "Recommended"
      },
      {
        "label": "GPT-5.5 Pro",
        "value": "gpt-5.5-pro"
      },
      {
        "label": "GPT-5.4",
        "value": "gpt-5.4"
      },
      {
        "label": "Custom",
        "value": "custom",
        "hint": "Type a model name"
      }
    ],
    "anthropic": [
      {
        "label": "Claude Sonnet 4.6",
        "value": "claude-sonnet-4-6",
        "hint": "Recommended"
      },
      {
        "label": "Claude Opus 4.8",
        "value": "claude-opus-4-8"
      },
      {
        "label": "Claude Haiku 4.5",
        "value": "claude-haiku-4-5",
        "hint": "Faster"
      },
      {
        "label": "Custom",
        "value": "custom",
        "hint": "Type a model name"
      }
    ],
    "custom": [
      {
        "label": "Custom",
        "value": "custom",
        "hint": "Type a model name"
      }
    ]
  },
  "live": [
    {
      "providerId": "gpt-live",
      "value": "gpt-live-1",
      "label": "GPT Live",
      "grade": "recommended",
      "video": "none",
      "image": false,
      "note": "Voice conversation through your Not Organic account. Audio only; no live tools or visual input."
    },
    {
      "providerId": "tavus",
      "value": "keatingbot",
      "label": "KeatingBot PAL",
      "grade": "recommended",
      "video": "native",
      "image": false,
      "surface": "embedded",
      "note": "Interactive Tavus video PAL with voice, vision, and Magic Canvas activities."
    },
    {
      "providerId": "gemini-live",
      "value": "gemini-3.1-flash-live-preview",
      "label": "Gemini 3.1 Flash Live",
      "grade": "recommended",
      "video": "native",
      "image": true,
      "note": "Native live video and the fastest turn-taking."
    },
    {
      "providerId": "gemini-live",
      "value": "gemini-2.5-flash-live-preview",
      "label": "Gemini 2.5 Flash Live",
      "grade": "capable",
      "video": "native",
      "image": true,
      "note": "Widest availability. Runs tools without pausing the conversation."
    },
    {
      "providerId": "gemini-live",
      "value": "gemini-3.0-flash-live-preview",
      "label": "Gemini 3.0 Flash Live",
      "grade": "capable",
      "video": "native",
      "image": true
    },
    {
      "providerId": "gemini-live",
      "value": "gemini-2.0-flash-live-001",
      "label": "Gemini 2.0 Flash Live",
      "grade": "legacy",
      "video": "native",
      "image": true,
      "note": "Older generation. Keep it for accounts without preview access."
    },
    {
      "providerId": "openai-realtime",
      "value": "gpt-realtime-2.1",
      "label": "gpt-realtime-2.1",
      "grade": "recommended",
      "video": "none",
      "image": true,
      "note": "Full-duplex voice with still-image input; no live video."
    },
    {
      "providerId": "openai-realtime",
      "value": "gpt-realtime",
      "label": "gpt-realtime",
      "grade": "capable",
      "video": "none",
      "image": true
    },
    {
      "providerId": "openai-realtime",
      "value": "gpt-realtime-2.1-mini",
      "label": "gpt-realtime-2.1-mini",
      "grade": "capable",
      "video": "none",
      "image": true,
      "note": "Cheaper and quicker; less patient with a long explanation."
    },
    {
      "providerId": "openai-realtime",
      "value": "gpt-realtime-mini",
      "label": "gpt-realtime-mini",
      "grade": "capable",
      "video": "none",
      "image": true
    },
    {
      "providerId": "openai-realtime",
      "value": "gpt-4o-realtime-preview-2024-12-17",
      "label": "gpt-4o-realtime-preview",
      "grade": "legacy",
      "video": "none",
      "image": false,
      "note": "Voice only \u2014 this generation cannot look at your camera or screen."
    },
    {
      "providerId": "openai-realtime",
      "value": "gpt-4o-mini-realtime-preview-2024-12-17",
      "label": "gpt-4o-mini-realtime-preview",
      "grade": "legacy",
      "video": "none",
      "image": false,
      "note": "Voice only \u2014 this generation cannot look at your camera or screen."
    }
  ]
};
test("setup menus retain their exact choices, labels, hints and order", () => {
  expect(MODEL_CHOICES.cliSetup).toEqual(shipped.cliSetup);
  expect(MODEL_CHOICES.piSetup).toEqual(shipped.piSetup);
});
test("live choices retain exact model IDs, labels, order and capabilities", () => {
  expect([...LIVE_MODEL_CHOICES.notorganic, ...LIVE_MODEL_CHOICES.tavus,
    ...LIVE_MODEL_CHOICES.google, ...LIVE_MODEL_CHOICES.openai]).toEqual(shipped.live);
});
test("role defaults drive menu, live recommendation and mobile fallback identities", () => {
  expect(MODEL_CHOICES.cliSetup.openai[0].value).toBe(DEFAULT_MODELS.cli.openai);
  expect(MODEL_CHOICES.piSetup.openai[0].value).toBe(DEFAULT_MODELS.cli.openai);
  expect(LIVE_MODEL_CHOICES.openai[0].value).toBe(DEFAULT_MODELS.speech.realtimeOpenai);
  expect(LIVE_MODEL_CHOICES.google[0].value).toBe(DEFAULT_MODELS.speech.liveGoogle);
  expect(Object.fromEntries(Object.entries(MODEL_CHOICES.mobileFallback).map(([provider, choice]) => [provider, choice.value])))
    .toEqual(DEFAULT_MODELS.mobile);
  expect("MODEL_IDS" in runtimeConfig).toBe(false);
});

test("provider, speech and judgement choice labels retain their shipped values", () => {
  expect(MODEL_CHOICES.piProviders).toEqual({
    zyphra: [{ value: "zyphra/ZAYA1-8B", label: "ZAYA1-8B" }],
    minimax: [{ value: "MiniMax-M2.7-highspeed", label: "MiniMax M2.7 Highspeed" }, { value: "MiniMax-M3", label: "MiniMax-M3" }],
  });
  expect(MODEL_CHOICES.webCompatibility.minimax).toEqual([
    { value: "MiniMax-M3", label: "MiniMax-M3" }, { value: "minimax-m2.7-highspeed", label: "MiniMax M2.7 Highspeed" },
  ]);
  expect(MODEL_CHOICES.openaiTts).toEqual([
    { value: "gpt-4o-mini-tts", label: "GPT-4o mini TTS (steerable)" },
    { value: "tts-1", label: "tts-1 (fast)" }, { value: "tts-1-hd", label: "tts-1 HD (higher quality)" },
  ]);
  expect(MODEL_CHOICES.googleSpeech).toEqual([
    { value: "gemini-2.0-flash-live-001", label: "Gemini 2.0 Flash Live" },
    { value: "gemini-2.5-flash-live-preview", label: "Gemini 2.5 Flash Live (Preview)" },
    { value: "gemini-3.0-flash-live-preview", label: "Gemini 3.0 Flash Live (Preview)" },
    { value: "gemini-3.1-flash-live-preview", label: "Gemini 3.1 Flash Live (Preview)" },
  ]);
  expect(MODEL_CHOICES.judgement.tabular.shortLabel).toBe("TabPFN 3.5");
  expect(MODEL_CHOICES.judgement.tabular.label).toBe("TabPFN 3.5 · Not Organic");
});
