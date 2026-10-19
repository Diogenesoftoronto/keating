/** Public model roles and ordered choices. Platform adapters supply environment and user overrides. */
import { MODEL_IDS } from "./model-identities.js";
export type { RuntimeModelId } from "./model-identities.js";

/** Intentional platform differences are independent defaults, not accidental drift. */
export const DEFAULT_MODELS = {
  cli: {
    notorganic: MODEL_IDS.balanced,
    openai: MODEL_IDS.gpt_5_5,
    google: MODEL_IDS.gemini_3_5_flash,
    anthropic: MODEL_IDS.claude_sonnet_4_6,
    openrouter: MODEL_IDS.poolside_laguna_m_1_free,
    zyphra: MODEL_IDS.zyphra_zaya1_8b,
    minimax: MODEL_IDS.minimax_m2_7_highspeed,
  },
  mobile: {
    openai: MODEL_IDS.gpt_5_4,
    anthropic: MODEL_IDS.claude_sonnet_4_6,
    google: MODEL_IDS.gemini_3_5_flash,
    openrouter: MODEL_IDS.anthropic_claude_sonnet_4_6,
    custom: MODEL_IDS.default,
  },
  web: { notorganic: MODEL_IDS.balanced },
  setup: { google: MODEL_IDS.gemini_3_1_pro_preview, cliAnthropic: MODEL_IDS.claude_sonnet_5 },
  account: { mobileChat: MODEL_IDS.balanced },
  speech: {
    sttOpenai: MODEL_IDS.gpt_4o_transcribe,
    sttGoogle: MODEL_IDS.gemini_2_5_flash,
    ttsOpenai: MODEL_IDS.gpt_4o_mini_tts,
    realtimeOpenai: MODEL_IDS.gpt_realtime_2_1,
    liveGoogle: MODEL_IDS.gemini_3_1_flash_live_preview,
    liveNotOrganic: MODEL_IDS.gpt_live_1,
    steering: MODEL_IDS.default,
  },
  image: { openai: MODEL_IDS.gpt_image_2_5_flare, google: MODEL_IDS.gemini_3_1_flash_image, notorganic: MODEL_IDS.image },
  judgement: { systemOne: MODEL_IDS.jev_latest, tabular: MODEL_IDS.tabular },
} as const;

export const NOTORGANIC_CHAT_MODEL_IDS = [DEFAULT_MODELS.web.notorganic, MODEL_IDS.gpt_6_1_sol] as const;
export const NOTORGANIC_IMAGE_MODEL_IDS = [DEFAULT_MODELS.image.notorganic] as const;

/** Discovery preferences; provider catalogs still own availability and metadata. */
export const MODEL_PREFERENCES = {
  webChat: {
    "openai-codex": [MODEL_IDS.gpt_5_5, MODEL_IDS.gpt_5_4, MODEL_IDS.gpt_5_4_mini, MODEL_IDS.gpt_5_3_codex_spark],
    openai: [MODEL_IDS.gpt_5_5, MODEL_IDS.gpt_5_5_pro, MODEL_IDS.gpt_5_4, MODEL_IDS.gpt_5_3_chat_latest, MODEL_IDS.gpt_5_2, MODEL_IDS.gpt_5_1, MODEL_IDS.gpt_5],
    anthropic: [MODEL_IDS.claude_sonnet_4_6, MODEL_IDS.claude_opus_4_8, MODEL_IDS.claude_opus_4_7, MODEL_IDS.claude_sonnet_4_5, MODEL_IDS.claude_haiku_4_5],
    google: [MODEL_IDS.gemini_3_1_pro_preview, MODEL_IDS.gemini_3_5_flash, MODEL_IDS.gemini_3_pro_preview, MODEL_IDS.gemini_2_5_pro],
  },
  speech: { steerableTts: [MODEL_IDS.gpt_4o_mini_tts] },
  judgement: { aliases: [MODEL_IDS.jev_latest, MODEL_IDS.jev_preview] },
  axCompatibility: {
    smallOpenai: { match: MODEL_IDS.gpt_4o_mini, model: MODEL_IDS.gpt_4o_mini },
    openai: { match: MODEL_IDS.gpt_4o, model: MODEL_IDS.gpt_4o },
    anthropic: { match: MODEL_IDS.claude_3_5_sonnet, model: MODEL_IDS.claude_3_5_sonnet_20240620 },
  },
  auxiliarySearch: {
    openai: [MODEL_IDS.gpt_5_mini, MODEL_IDS.gpt_5_6_sol, MODEL_IDS.gpt_5_5, MODEL_IDS.gpt_5_4, MODEL_IDS.gpt_4_1_mini],
    google: [MODEL_IDS.gemini_2_5_flash, MODEL_IDS.gemini_3_5_flash, MODEL_IDS.gemini_3_1_pro_preview],
    anthropic: [MODEL_IDS.claude_haiku_4_5, MODEL_IDS.claude_sonnet_4_6, MODEL_IDS.claude_sonnet_5],
  },
} as const;

export const DEFAULT_SYSTEM_ONE_MODEL = DEFAULT_MODELS.judgement.systemOne;

/** Image choices are ordered newest first; adapters supply sizes and protocol metadata. */
export const IMAGE_MODEL_IDS = {
  openai: [DEFAULT_MODELS.image.openai, MODEL_IDS.gpt_image_2_5_sunburst, MODEL_IDS.gpt_image_2,
    MODEL_IDS.gpt_image_1_5, MODEL_IDS.gpt_image_1, MODEL_IDS.gpt_image_1_mini],
  google: [DEFAULT_MODELS.image.google, MODEL_IDS.gemini_3_1_flash_lite_image,
    MODEL_IDS.gemini_3_pro_image, MODEL_IDS.gemini_2_5_flash_image],
} as const;

/** Labels follow the selected role ID; changing a default cannot leave a stale consumer label. */
const SETUP_MODEL_LABELS: Record<string, string> = {
  [MODEL_IDS.balanced]: "Balanced",
  [MODEL_IDS.zyphra_zaya1_8b]: "ZAYA1-8B",
  ["custom"]: "Custom",
  [MODEL_IDS.poolside_laguna_m_1_free]: "Poolside Laguna M.1 (free)",
  [MODEL_IDS.poolside_laguna_xs_2_free]: "Poolside Laguna XS.2 (free)",
  [MODEL_IDS.openai_gpt_oss_120b_free]: "OpenAI GPT-OSS 120B (free)",
  [MODEL_IDS.deepseek_deepseek_v4_flash_free]: "DeepSeek V4 Flash (free)",
  [MODEL_IDS.google_gemma_4_31b_it_free]: "Google Gemma 4 31B (free)",
  [MODEL_IDS.nvidia_nemotron_3_super_120b_a12b_free]: "Nvidia Nemotron 120B (free)",
  [MODEL_IDS.moonshotai_kimi_k2_6_free]: "MoonshotAI Kimi K2.6 (free)",
  [MODEL_IDS.gemini_3_1_pro_preview]: "Gemini 3.1 Pro Preview",
  [MODEL_IDS.gemini_3_5_flash]: "Gemini 3.5 Flash",
  [MODEL_IDS.gemma_31b_it]: "Gemma 31b",
  [MODEL_IDS.gpt_5_5]: "GPT-5.5",
  [MODEL_IDS.gpt_5_5_pro]: "GPT-5.5 Pro",
  [MODEL_IDS.gpt_5_4]: "GPT-5.4",
  [MODEL_IDS.claude_sonnet_5]: "Claude Sonnet 5",
  [MODEL_IDS.claude_opus_4_8]: "Claude Opus 4.8",
  [MODEL_IDS.claude_fable_5]: "Claude Fable 5",
  [MODEL_IDS.claude_haiku_4_5]: "Claude Haiku 4.5",
  [MODEL_IDS.gemini_3_pro_preview]: "Gemini 3 Pro Preview",
  [MODEL_IDS.claude_sonnet_4_6]: "Claude Sonnet 4.6",
  [MODEL_IDS.anthropic_claude_sonnet_4_6]: "Claude Sonnet 4.6",
};
function setupChoice(value: string, hint?: string) {
  return { label: SETUP_MODEL_LABELS[value] ?? value, value, ...(hint ? { hint } : {}) };
}
function menu(choices: ReturnType<typeof setupChoice>[]) {
  return choices.filter((choice, index) => choices.findIndex(candidate => candidate.value === choice.value) === index);
}

const LIVE_MODEL_LABELS: Record<string, string> = {
  [MODEL_IDS.gpt_live_1]: "GPT Live",
  ["keatingbot"]: "KeatingBot PAL",
  [MODEL_IDS.gemini_3_1_flash_live_preview]: "Gemini 3.1 Flash Live",
  [MODEL_IDS.gemini_2_5_flash_live_preview]: "Gemini 2.5 Flash Live",
  [MODEL_IDS.gemini_3_0_flash_live_preview]: "Gemini 3.0 Flash Live",
  [MODEL_IDS.gemini_2_0_flash_live_001]: "Gemini 2.0 Flash Live",
  [MODEL_IDS.gpt_realtime_2_1]: "gpt-realtime-2.1",
  [MODEL_IDS.gpt_realtime]: "gpt-realtime",
  [MODEL_IDS.gpt_realtime_2_1_mini]: "gpt-realtime-2.1-mini",
  [MODEL_IDS.gpt_realtime_mini]: "gpt-realtime-mini",
  [MODEL_IDS.gpt_4o_realtime_preview_2024_12_17]: "gpt-4o-realtime-preview",
  [MODEL_IDS.gpt_4o_mini_realtime_preview_2024_12_17]: "gpt-4o-mini-realtime-preview",
};

const TTS_MODEL_LABELS: Record<string, string> = {
  [MODEL_IDS.gpt_4o_mini_tts]: "GPT-4o mini TTS (steerable)",
  [MODEL_IDS.tts_fast]: "tts-1 (fast)",
  [MODEL_IDS.tts_quality]: "tts-1 HD (higher quality)",
};
const NOTORGANIC_MODEL_LABELS: Record<string, string> = {
  [MODEL_IDS.balanced]: "Inkling Small", [MODEL_IDS.gpt_6_1_sol]: "GPT-6.1 Sol",
};
const TABULAR_MODEL_LABELS: Record<string, string> = { [MODEL_IDS.tabular]: "TabPFN 3.5" };
const PI_PROVIDER_LABELS: Record<string, string> = {
  [MODEL_IDS.zyphra_zaya1_8b]: "ZAYA1-8B", [MODEL_IDS.minimax_m2_7_highspeed]: "MiniMax M2.7 Highspeed",
  [MODEL_IDS.minimax_m3]: MODEL_IDS.minimax_m3,
};
/** Ordered surface/provider menus. Their first entries use that surface's default role. */
export const MODEL_CHOICES = {
  cliSetup: {
    notorganic: menu([
      setupChoice(DEFAULT_MODELS.cli.notorganic, "Five-minute device-bound capability"),
    ]),
    zyphra: menu([
      setupChoice(DEFAULT_MODELS.cli.zyphra, "Recommended"),
      setupChoice("custom", "Type a model name"),
    ]),
    openrouter: menu([
      setupChoice(DEFAULT_MODELS.cli.openrouter, "Recommended"),
      setupChoice(MODEL_IDS.poolside_laguna_xs_2_free, "Faster/smaller"),
      setupChoice(MODEL_IDS.openai_gpt_oss_120b_free),
      setupChoice(MODEL_IDS.deepseek_deepseek_v4_flash_free),
      setupChoice(MODEL_IDS.google_gemma_4_31b_it_free),
      setupChoice(MODEL_IDS.nvidia_nemotron_3_super_120b_a12b_free),
      setupChoice(MODEL_IDS.moonshotai_kimi_k2_6_free),
      setupChoice("custom", "Type a model name"),
    ]),
    google: menu([
      setupChoice(DEFAULT_MODELS.setup.google, "Recommended"),
      setupChoice(DEFAULT_MODELS.cli.google, "Faster"),
      setupChoice(MODEL_IDS.gemma_31b_it, "Free"),
      setupChoice("custom", "Type a model name"),
    ]),
    openai: menu([
      setupChoice(DEFAULT_MODELS.cli.openai, "Recommended"),
      setupChoice(MODEL_IDS.gpt_5_5_pro),
      setupChoice(MODEL_IDS.gpt_5_4),
      setupChoice("custom", "Type a model name"),
    ]),
    anthropic: menu([
      setupChoice(DEFAULT_MODELS.setup.cliAnthropic, "Recommended"),
      setupChoice(MODEL_IDS.claude_opus_4_8),
      setupChoice(MODEL_IDS.claude_fable_5),
      setupChoice(MODEL_IDS.claude_haiku_4_5, "Faster"),
      setupChoice("custom", "Type a model name"),
    ]),
    custom: menu([
      setupChoice("custom", "Type a model name"),
    ]),
  },
  piSetup: {
    zyphra: menu([
      setupChoice(DEFAULT_MODELS.cli.zyphra, "Recommended"),
      setupChoice("custom", "Type a model name"),
    ]),
    openrouter: menu([
      setupChoice(DEFAULT_MODELS.cli.openrouter, "Recommended"),
      setupChoice(MODEL_IDS.poolside_laguna_xs_2_free, "Faster/smaller"),
      setupChoice(MODEL_IDS.openai_gpt_oss_120b_free),
      setupChoice(MODEL_IDS.deepseek_deepseek_v4_flash_free),
      setupChoice(MODEL_IDS.google_gemma_4_31b_it_free),
      setupChoice(MODEL_IDS.nvidia_nemotron_3_super_120b_a12b_free),
      setupChoice(MODEL_IDS.moonshotai_kimi_k2_6_free),
      setupChoice("custom", "Type a model name"),
    ]),
    google: menu([
      setupChoice(DEFAULT_MODELS.setup.google, "Recommended"),
      setupChoice(DEFAULT_MODELS.cli.google, "Faster"),
      setupChoice(MODEL_IDS.gemini_3_pro_preview),
      setupChoice("custom", "Type a model name"),
    ]),
    openai: menu([
      setupChoice(DEFAULT_MODELS.cli.openai, "Recommended"),
      setupChoice(MODEL_IDS.gpt_5_5_pro),
      setupChoice(MODEL_IDS.gpt_5_4),
      setupChoice("custom", "Type a model name"),
    ]),
    anthropic: menu([
      setupChoice(DEFAULT_MODELS.cli.anthropic, "Recommended"),
      setupChoice(MODEL_IDS.claude_opus_4_8),
      setupChoice(MODEL_IDS.claude_haiku_4_5, "Faster"),
      setupChoice("custom", "Type a model name"),
    ]),
    custom: menu([
      setupChoice("custom", "Type a model name"),
    ]),
  },
  mobileFallback: Object.fromEntries(Object.entries(DEFAULT_MODELS.mobile).map(([provider, value]) =>
    [provider, { value, label: SETUP_MODEL_LABELS[value] ?? value }])) as Record<keyof typeof DEFAULT_MODELS.mobile, { value: string; label: string }>,
  piProviders: {
    zyphra: [{ value: DEFAULT_MODELS.cli.zyphra, label: PI_PROVIDER_LABELS[DEFAULT_MODELS.cli.zyphra] ?? DEFAULT_MODELS.cli.zyphra }],
    minimax: [
      { value: DEFAULT_MODELS.cli.minimax, label: PI_PROVIDER_LABELS[DEFAULT_MODELS.cli.minimax] ?? DEFAULT_MODELS.cli.minimax },
      { value: MODEL_IDS.minimax_m3, label: MODEL_IDS.minimax_m3 },
    ],
  },
  webCompatibility: {
    minimax: [
      { value: MODEL_IDS.minimax_m3, label: MODEL_IDS.minimax_m3 },
      { value: MODEL_IDS.minimax_m2_7_highspeed_discovery, label: "MiniMax M2.7 Highspeed" },
    ],
  },
  judgement: { tabular: {
    value: DEFAULT_MODELS.judgement.tabular,
    shortLabel: TABULAR_MODEL_LABELS[DEFAULT_MODELS.judgement.tabular] ?? DEFAULT_MODELS.judgement.tabular,
    label: `${TABULAR_MODEL_LABELS[DEFAULT_MODELS.judgement.tabular] ?? DEFAULT_MODELS.judgement.tabular} · Not Organic`,
  } },
  notorganicChat: NOTORGANIC_CHAT_MODEL_IDS.map(value => ({ value, label: NOTORGANIC_MODEL_LABELS[value] ?? value })),
  openaiTts: [
    { value: DEFAULT_MODELS.speech.ttsOpenai, label: TTS_MODEL_LABELS[DEFAULT_MODELS.speech.ttsOpenai] ?? DEFAULT_MODELS.speech.ttsOpenai },
    { value: MODEL_IDS.tts_fast, label: "tts-1 (fast)" },
    { value: MODEL_IDS.tts_quality, label: "tts-1 HD (higher quality)" },
  ],
  // Preserve the provider descriptor's legacy-first order; live recommendations have their own list.
  googleSpeech: [
    { value: MODEL_IDS.gemini_2_0_flash_live_001, label: "Gemini 2.0 Flash Live" },
    { value: MODEL_IDS.gemini_2_5_flash_live_preview, label: "Gemini 2.5 Flash Live (Preview)" },
    { value: MODEL_IDS.gemini_3_0_flash_live_preview, label: "Gemini 3.0 Flash Live (Preview)" },
    { value: DEFAULT_MODELS.speech.liveGoogle, label: `${LIVE_MODEL_LABELS[DEFAULT_MODELS.speech.liveGoogle] ?? DEFAULT_MODELS.speech.liveGoogle} (Preview)` },
  ],
};


export const LIVE_MODEL_CHOICES = {
  notorganic: [
    {
      providerId: "gpt-live",
      value: DEFAULT_MODELS.speech.liveNotOrganic,
      label: LIVE_MODEL_LABELS[DEFAULT_MODELS.speech.liveNotOrganic] ?? DEFAULT_MODELS.speech.liveNotOrganic,
      grade: "recommended",
      video: "none",
      image: false,
      note: "Voice conversation through your Not Organic account. Audio only; no live tools or visual input.",
    },
  ],
  tavus: [
    {
      providerId: "tavus",
      value: "keatingbot",
      label: LIVE_MODEL_LABELS["keatingbot"] ?? "keatingbot",
      grade: "recommended",
      video: "native",
      image: false,
      surface: "embedded",
      note: "Interactive Tavus video PAL with voice, vision, and Magic Canvas activities.",
    },
  ],
  google: [
    {
      providerId: "gemini-live",
      value: DEFAULT_MODELS.speech.liveGoogle,
      label: LIVE_MODEL_LABELS[DEFAULT_MODELS.speech.liveGoogle] ?? DEFAULT_MODELS.speech.liveGoogle,
      grade: "recommended",
      video: "native",
      image: true,
      note: "Native live video and the fastest turn-taking.",
    },
    {
      providerId: "gemini-live",
      value: MODEL_IDS.gemini_2_5_flash_live_preview,
      label: LIVE_MODEL_LABELS[MODEL_IDS.gemini_2_5_flash_live_preview] ?? MODEL_IDS.gemini_2_5_flash_live_preview,
      grade: "capable",
      video: "native",
      image: true,
      note: "Widest availability. Runs tools without pausing the conversation.",
    },
    {
      providerId: "gemini-live",
      value: MODEL_IDS.gemini_3_0_flash_live_preview,
      label: LIVE_MODEL_LABELS[MODEL_IDS.gemini_3_0_flash_live_preview] ?? MODEL_IDS.gemini_3_0_flash_live_preview,
      grade: "capable",
      video: "native",
      image: true,
    },
    {
      providerId: "gemini-live",
      value: MODEL_IDS.gemini_2_0_flash_live_001,
      label: LIVE_MODEL_LABELS[MODEL_IDS.gemini_2_0_flash_live_001] ?? MODEL_IDS.gemini_2_0_flash_live_001,
      grade: "legacy",
      video: "native",
      image: true,
      note: "Older generation. Keep it for accounts without preview access.",
    },
  ],
  openai: [
    {
      providerId: "openai-realtime",
      value: DEFAULT_MODELS.speech.realtimeOpenai,
      label: LIVE_MODEL_LABELS[DEFAULT_MODELS.speech.realtimeOpenai] ?? DEFAULT_MODELS.speech.realtimeOpenai,
      grade: "recommended",
      video: "none",
      image: true,
      note: "Full-duplex voice with still-image input; no live video.",
    },
    {
      providerId: "openai-realtime",
      value: MODEL_IDS.gpt_realtime,
      label: LIVE_MODEL_LABELS[MODEL_IDS.gpt_realtime] ?? MODEL_IDS.gpt_realtime,
      grade: "capable",
      video: "none",
      image: true,
    },
    {
      providerId: "openai-realtime",
      value: MODEL_IDS.gpt_realtime_2_1_mini,
      label: LIVE_MODEL_LABELS[MODEL_IDS.gpt_realtime_2_1_mini] ?? MODEL_IDS.gpt_realtime_2_1_mini,
      grade: "capable",
      video: "none",
      image: true,
      note: "Cheaper and quicker; less patient with a long explanation.",
    },
    {
      providerId: "openai-realtime",
      value: MODEL_IDS.gpt_realtime_mini,
      label: LIVE_MODEL_LABELS[MODEL_IDS.gpt_realtime_mini] ?? MODEL_IDS.gpt_realtime_mini,
      grade: "capable",
      video: "none",
      image: true,
    },
    {
      providerId: "openai-realtime",
      value: MODEL_IDS.gpt_4o_realtime_preview_2024_12_17,
      label: LIVE_MODEL_LABELS[MODEL_IDS.gpt_4o_realtime_preview_2024_12_17] ?? MODEL_IDS.gpt_4o_realtime_preview_2024_12_17,
      grade: "legacy",
      video: "none",
      image: false,
      note: "Voice only \u2014 this generation cannot look at your camera or screen.",
    },
    {
      providerId: "openai-realtime",
      value: MODEL_IDS.gpt_4o_mini_realtime_preview_2024_12_17,
      label: LIVE_MODEL_LABELS[MODEL_IDS.gpt_4o_mini_realtime_preview_2024_12_17] ?? MODEL_IDS.gpt_4o_mini_realtime_preview_2024_12_17,
      grade: "legacy",
      video: "none",
      image: false,
      note: "Voice only \u2014 this generation cannot look at your camera or screen.",
    },
  ],
} as const;
