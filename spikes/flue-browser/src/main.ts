import { createBrowserConversation } from "./browser-client";

const output = document.querySelector<HTMLPreElement>("#result");

const client = createBrowserConversation({
  url: "https://agents.invalid/keating/demo",
  authorizeRequest: async () => ({
    authorization: "DPoP probe-only-token",
    dpop: "probe-only-proof",
  }),
});

if (output) {
  output.textContent = [
    "@flue/sdk loaded in a real browser bundle.",
    `Conversation methods: ${["send", "read", "observe", "abort"]
      .filter((name) => typeof client[name as keyof typeof client] === "function")
      .join(", ")}`,
    "No request was sent: construction is intentionally side-effect free.",
  ].join("\n");
}
