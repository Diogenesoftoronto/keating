/** Public service locations and provider API versions. Never put credentials here. */
export const API_VERSIONS = {
  anthropic: "2023-06-01",
  google: "v1beta",
} as const;

export const SERVICE_ENDPOINTS = {
  notorganic: {
    api: "https://api.notorganic.info",
    authorization: "https://id.notorganic.info/authorize",
    account: "https://id.notorganic.info/account",
    waitlist: "https://id.notorganic.info/waitlist",
  },
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  google: `https://generativelanguage.googleapis.com/${API_VERSIONS.google}`,
  zyphra: "https://api.zyphracloud.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
  minimax: "https://api.minimax.io/v1",
  minimaxCn: "https://api.minimaxi.com/v1",
  mobileLocal: "http://10.0.2.2:11434/v1",
  modelsDev: "https://models.dev/api.json",
  systemOne: "https://api.typesafe.ai/v1/systemone",
} as const;

export const PROVIDER_ENDPOINTS = {
  openaiSpeech: `${SERVICE_ENDPOINTS.openai}/audio/speech`,
  openaiTranscription: `${SERVICE_ENDPOINTS.openai}/audio/transcriptions`,
  openaiImages: `${SERVICE_ENDPOINTS.openai}/images/generations`,
  openaiRealtimeSecrets: `${SERVICE_ENDPOINTS.openai}/realtime/client_secrets`,
  openaiRealtimeCalls: `${SERVICE_ENDPOINTS.openai}/realtime/calls`,
  googleImageTemplate: `${SERVICE_ENDPOINTS.google}/models/{model}:generateContent`,
} as const;

export const SYSTEM_ONE_ENDPOINT = SERVICE_ENDPOINTS.systemOne;
