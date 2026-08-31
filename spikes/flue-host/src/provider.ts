import { fauxProvider } from "@earendil-works/pi-ai";
import { setProvider } from "@flue/runtime";

export const deterministicProvider = fauxProvider({
  provider: "keating-faux",
  models: [
    {
      id: "teacher",
      name: "Keating deterministic teacher",
      reasoning: false,
      input: ["text"],
      contextWindow: 32_000,
      maxTokens: 4_096,
    },
  ],
});

// Top-level registration is the documented Flue custom-provider path. It is
// evaluated in the built Node host and when the agent module is run directly.
setProvider(deterministicProvider.provider);
