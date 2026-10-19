/** Reject new model literals; exact exceptions document frozen data and UI protocol names. */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { parse } from "@babel/parser";
import { Parser, tokenizer } from "acorn";
import jsx from "acorn-jsx";

const root = join(import.meta.dir, "..");
// Read the private registry as data; consumers cannot import its value namespace.
const identities = new Set<string>([...tokenizer(readFileSync(join(root,
  "packages/runtime-config/src/model-identities.ts"), "utf8"), { ecmaVersion: "latest", sourceType: "module" })]
  .filter(token => token.type.label === "string").map(token => token.value as string));
const identityHints = new RegExp(`(?:["'\`]|infer:)(${[...identities]
  .map(id => id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`);
const modelPattern = /(?:[\w.-]+\/)?(?:gpt-|claude-|gemini-|o\d+(?:-|(?=\b))|grok-|jev-|(?:meta-)?llama[-._\d]|qwen[-._\d]|mistral[-._\d]|deepseek[-._\d]|gemma[-._\d]|MiniMax-)[\w.:/-]*/gi;
const jsxLexer = Parser.extend(jsx());
type Finding = { file: string; literal: string };

function modelLiterals(source: string, file: string): Finding[] {
  modelPattern.lastIndex = 0;
  if (!modelPattern.test(source) && !identityHints.test(source) && !/\bMODEL_IDS\s*[.\[]/.test(source)) return [];
  modelPattern.lastIndex = 0;
  // Lexing avoids full trees for TS/JS/JSX; Babel handles uncommon TS lexemes.
  // Both paths distinguish comments and regexes from string/template literals.
  let tokens: { type: { label?: string }; value?: unknown }[];
  try {
    const lex = /\.[jt]sx$/.test(file) ? jsxLexer.tokenizer.bind(jsxLexer) : tokenizer;
    tokens = [...lex(source, { ecmaVersion: "latest", sourceType: "module" })];
  } catch {
    tokens = parse(source, { sourceType: "unambiguous", plugins: ["typescript", "jsx"],
      errorRecovery: true, tokens: true, attachComment: false }).tokens as typeof tokens;
  }
  const found = new Set<string>();
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (token.type.label === "name" && token.value === "MODEL_IDS" && tokens[index + 1]?.type.label === ".") {
      found.add(`MODEL_IDS.${tokens[index + 2]?.value ?? "unknown"}`);
    }
    if (token.type.label === "name" && token.value === "MODEL_IDS" && tokens[index + 1]?.type.label === "[") {
      found.add(`MODEL_IDS[${String(tokens[index + 2]?.value ?? "unknown")}]`);
    }
    if ((token.type.label !== "string" && token.type.label !== "template") || typeof token.value !== "string") continue;
    const previous = tokens[index - 1];
    const beforePrevious = tokens[index - 2];
    // Static imports/re-exports and dynamic imports identify modules, not models.
    if (previous?.value === "from" || previous?.type.label === "import"
      || (previous?.type.label === "(" && (beforePrevious?.type.label === "import" || beforePrevious?.value === "require"))) continue;
    const literal = token.value;
    if (identities.has(literal)) found.add(literal);
    for (const match of literal.matchAll(/(?:^|\s)infer:([^\s]+)/g)) {
      if (identities.has(match[1])) found.add(match[1]);
    }
    for (const match of literal.matchAll(modelPattern)) found.add(match[0].replace(/[.:/-]+$/, ""));
  }
  return [...found].sort().map(literal => ({ file, literal }));
}

/**
 * Generated copies of scanned sources. Their literals are checked at the source
 * they were generated from, so listing them here avoids per-literal churn.
 */
const GENERATED_FILES = new Set(["web/src/keating/nodepod-boot-files.ts"]);

function sourceFiles(directory: string): string[] {
  return readdirSync(join(root, directory), { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    if (/^(?:node_modules|__tests__|test|tests|dist|\.output)$/.test(entry.name)) return [];
    if (entry.isDirectory()) return sourceFiles(path);
    if (GENERATED_FILES.has(path)) return [];
    return /\.[cm]?[jt]sx?$/.test(entry.name) && !/\.(?:test|spec|stories)\./.test(entry.name) ? [path] : [];
  });
}

// file + literal + reason, never a path glob or a blanket model-prefix exemption.
const ALLOWLIST: readonly [file: string, literal: string, reason: string][] = [
  ["web/src/components/chat/user-message.ts", "GPT-4o", "Display-only vision-capability example; actual model selection is supplied by the caller."],
  ["web/src/components/chat/user-message.ts", "image", "Attachment content discriminator; not an upstream inference model identity."],
  ["src/cli/main.ts", "balanced", "Help/error copy describing the narrow CLI grant; not a model selector."],
  ["src/cli/main.ts", "jev-1.13.0", "Pinned concrete calibration identity in CLI help, not a mutable model default."],
  ["src/core/learner-state.ts", "default", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["src/core/provider-auth.ts", "balanced", "Help/error copy describing the narrow CLI grant; not a model selector."],
  ["src/core/speech.ts", "default", "Speech steering protocol sentinel in diagnostic output; not a concrete upstream model ID."],
  ["src/pi/notorganic-provider.ts", "balanced", "Help/error copy describing the narrow CLI grant; not a model selector."],
  ["src/runtime/pi.ts", "balanced", "Help/error copy describing the narrow CLI grant; not a model selector."],
  ["src/tui/host-controller.ts", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["src/tui/model-picker.ts", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["src/tui/ui/adapter.ts", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["src/tui/ui/assistant-documents.ts", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["src/tui/ui/render.ts", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["src/tui/ui/rpc-action-transport.ts", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["src/tui/ui/types.ts", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["web/src/components/AssistantChatPanel.tsx", "GPT-4o", "Display-only model label or help/example text; request IDs come from configuration."],
  ["web/src/components/AssistantChatPanel.tsx", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["web/src/components/DraftReviewStatus.tsx", "default", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["web/src/components/MermaidRenderer.tsx", "default", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["web/src/components/ModelSelector.tsx", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["web/src/components/PlanRevisionCard.tsx", "default", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["web/src/components/SpeechSettingsTab.tsx", "gpt-live", "UI/provider protocol name or capability-family selector, not a selectable model ID."],
  ["web/src/components/SpeechSettingsTab.tsx", "gpt-realtime-2", "UI/provider protocol name or capability-family selector, not a selectable model ID."],
  ["web/src/components/assistant-chat-messages.ts", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["web/src/components/courses/CourseArtifactCard.tsx", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["web/src/components/courses/CourseBuilder.tsx", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["web/src/components/courses/CourseCommandPalette.tsx", "default", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["web/src/components/interactive-segments.ts", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["web/src/components/live/use-live-session.ts", "gemini-live", "UI/provider protocol name or capability-family selector, not a selectable model ID."],
  ["web/src/components/live/use-live-session.ts", "gpt-live", "UI/provider protocol name or capability-family selector, not a selectable model ID."],
  ["web/src/components/profile/ProfileFieldGroups.tsx", "balanced", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["web/src/components/profile/ProfileFieldGroups.tsx", "default", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["web/src/components/settings/CustomProvidersSection.tsx", "llama.cpp", "UI/provider protocol name or capability-family selector, not a selectable model ID."],
  ["web/src/components/settings/CustomProvidersSection.tsx", "llama.local", "UI/provider protocol name or capability-family selector, not a selectable model ID."],
  ["web/src/components/settings/ModelRolesPanel.tsx", "gpt-live", "UI/provider protocol name or capability-family selector, not a selectable model ID."],
  ["web/src/components/settings/MyModelsSection.tsx", "GPT-5", "Display-only model label or help/example text; request IDs come from configuration."],
  ["web/src/components/settings/MyModelsSection.tsx", "gpt-5", "Display-only model label or help/example text; request IDs come from configuration."],
  ["web/src/components/trajectory/DraftReviewReceipt.tsx", "default", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["web/src/components/trajectory/TrajectoryCanvas.tsx", "default", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["web/src/components/trajectory/TrajectoryCanvas.tsx", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["web/src/components/trajectory/pool-compatibility.ts", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["web/src/components/trajectory/types.ts", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["web/src/courses/contracts.ts", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["web/src/courses/course-assembly.ts", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["web/src/courses/course-judgement.ts", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["web/src/design-system/Recipes.tsx", "default", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["web/src/keating/anki-interests.ts", "default", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["web/src/keating/app-storage.ts", "llama.cpp", "UI/provider protocol name or capability-family selector, not a selectable model ID."],
  ["web/src/keating/browser-tools/courses.ts", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["web/src/keating/browser-tools/media.ts", "gemini-generate-content", "UI/provider protocol name or capability-family selector, not a selectable model ID."],
  ["web/src/keating/browser-tools/media.ts", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["web/src/keating/browser-tools/shared.ts", "default", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["web/src/keating/browser-tools/workspace.ts", "default", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["web/src/keating/desktop-offline-stream.ts", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["web/src/keating/flue/conversation.ts", "default", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["web/src/keating/flue/conversation.ts", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["web/src/keating/flue/conversation.ts", "litert-community/gemma-4-E4B-it-litert-lm", "Frozen local artifact/runtime identity or its compatibility discriminator; keep revisions pinned."],
  ["web/src/keating/flue/model-messages.ts", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["web/src/keating/judgement/draft-gate.ts", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["web/src/keating/judgement/draft-status.ts", "default", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["web/src/keating/learner-accessibility.ts", "default", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["web/src/keating/live-errors.ts", "gpt-live", "UI/provider protocol name or capability-family selector, not a selectable model ID."],
  ["web/src/keating/live-models.ts", "gemini-live", "UI/provider protocol name or capability-family selector, not a selectable model ID."],
  ["web/src/keating/live-models.ts", "gpt-live", "UI/provider protocol name or capability-family selector, not a selectable model ID."],
  ["web/src/keating/model-capabilities.ts", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["web/src/keating/openui/preview.ts", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["web/src/keating/openui/shared-renderer.tsx", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["web/src/keating/providers/capabilities.ts", "gpt-live", "UI/provider protocol name or capability-family selector, not a selectable model ID."],
  ["web/src/keating/providers/capabilities.ts", "minimax-chat", "UI/provider protocol name or capability-family selector, not a selectable model ID."],
  ["web/src/keating/share-contract.ts", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["web/src/keating/shared-sessions.ts", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["web/src/keating/speech-default.ts", "gpt-live", "UI/provider protocol name or capability-family selector, not a selectable model ID."],
  ["web/src/keating/speech-providers/gemini-live.ts", "gemini-live", "UI/provider protocol name or capability-family selector, not a selectable model ID."],
  ["web/src/keating/speech-providers/gpt-live.ts", "gpt-live", "UI/provider protocol name or capability-family selector, not a selectable model ID."],
  ["web/src/keating/speech.ts", "gemini-live", "UI/provider protocol name or capability-family selector, not a selectable model ID."],
  ["web/src/keating/speech.ts", "gpt-live", "UI/provider protocol name or capability-family selector, not a selectable model ID."],
  ["web/src/keating/storage.ts", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["web/src/keating/sync/learner-sync.ts", "default", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["web/src/keating/trajectory-artifacts.ts", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["web/src/keating/trajectory-generation.ts", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["web/src/keating/trajectory-message-display.ts", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["web/src/keating/trajectory-review.ts", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["web/src/keating/ui-protocol/legacy.ts", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["web/src/keating/ui-protocol/types.ts", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["web/src/keating/ui-protocol/validation.ts", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["web/src/lib/browser-model-input.ts", "Gemma", "Display-only model label or help/example text; request IDs come from configuration."],
  ["web/src/lib/browser-model-input.ts", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["web/src/lib/desktop-offline.ts", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["web/src/lib/desktop-offline.ts", "litert-community/gemma-4-E4B-it-litert-lm", "Frozen local artifact/runtime identity or its compatibility discriminator; keep revisions pinned."],
  ["web/src/lib/image-generators.ts", "gemini-generate-content", "UI/provider protocol name or capability-family selector, not a selectable model ID."],
  ["web/src/lib/image-generators.ts", "llama.cpp", "UI/provider protocol name or capability-family selector, not a selectable model ID."],
  ["web/src/lib/model-catalog.ts", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["web/src/lib/provider-key-test.ts", "mistral-conversations", "UI/provider protocol name or capability-family selector, not a selectable model ID."],
  ["web/src/lib/provider-models.ts", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["web/src/lib/provider-models.ts", "llama.cpp", "UI/provider protocol name or capability-family selector, not a selectable model ID."],
  ["web/src/lib/provider-models.ts", "minimax-cn", "UI/provider protocol name or capability-family selector, not a selectable model ID."],
  ["web/src/lib/provider-proxy.ts", "mistral.ai", "Provider hostname or documentation route, not a model identity."],
  ["web/src/lib/tutorial-links.ts", "llama-cpp", "Provider hostname or documentation route, not a model identity."],
  ["web/src/notorganic-provider/index.ts", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["web/src/notorganic-provider/profile.ts", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["web/src/pages/Blog.tsx", "Google/gemini-3.1-pro-preview", "Historical published benchmark/blog identity; preserve the record."],
  ["web/src/pages/Blog.tsx", "gemini-3.1-pro-preview", "Historical published benchmark/blog identity; preserve the record."],
  ["web/src/pages/Live.tsx", "gemini-live", "UI/provider protocol name or capability-family selector, not a selectable model ID."],
  ["web/src/pages/Live.tsx", "gpt-live", "UI/provider protocol name or capability-family selector, not a selectable model ID."],
  ["web/src/pages/TrainingData.tsx", "gemini-3-flash-preview", "Pinned research/evaluation judge identity; changing it changes the experiment."],
  ["web/src/pages/TrajectoryReview.tsx", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["web/src/pages/shared-session-view-model.ts", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["web/src/pages/course-workspace/DeskCards.tsx", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["web/src/stores/local-model.ts", "Gemma", "Frozen local artifact/runtime identity or its compatibility discriminator; keep revisions pinned."],
  ["web/src/stores/local-model.ts", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["web/src/stores/local-model.ts", "onnx-community/gemma-4-E2B-it-ONNX", "Frozen local artifact/runtime identity or its compatibility discriminator; keep revisions pinned."],
  ["web/src/stores/local-model.ts", "onnx-community/gemma-4-E4B-it-ONNX", "Frozen local artifact/runtime identity or its compatibility discriminator; keep revisions pinned."],
  ["web/server/api/courses/[...path].ts", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["web/server/utils/chat-proxy-policy.ts", "deepseek.com", "Provider hostname or documentation route, not a model identity."],
  ["web/server/utils/chat-proxy-policy.ts", "mistral.ai", "Provider hostname or documentation route, not a model identity."],
  ["mobile/src/app/(tabs)/index.tsx", "gemma-4-e4b", "Frozen local artifact/runtime identity or its compatibility discriminator; keep revisions pinned."],
  ["mobile/src/app/(tabs)/index.tsx", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["mobile/src/app/repository-smoke.tsx", "gpt-5", "Fictional repository smoke fixture identity."],
  ["mobile/src/components/Composer.tsx", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["mobile/src/components/MarkdownText.tsx", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["mobile/src/components/MessageBubble.tsx", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["mobile/src/components/UiDocumentRenderer.tsx", "default", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["mobile/src/components/UiDocumentRenderer.tsx", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["mobile/src/components/usage/SelfEvolutionChart.tsx", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["mobile/src/components/usage/TopicWheel.tsx", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["mobile/src/lib/composer-attachment-contract.ts", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["mobile/src/lib/composer-attachments.ts", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["mobile/src/lib/composer-draft-storage.ts", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["mobile/src/lib/courses/types.ts", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["mobile/src/lib/markdown-document.ts", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["mobile/src/lib/mobile-tools.ts", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["mobile/src/lib/model-catalog.ts", "gemma-4-e4b", "Frozen local artifact/runtime identity or its compatibility discriminator; keep revisions pinned."],
  ["mobile/src/lib/model-catalog.ts", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["mobile/src/lib/offline-model-contract.ts", "gemma-4-e4b", "Frozen local artifact/runtime identity or its compatibility discriminator; keep revisions pinned."],
  ["mobile/src/lib/offline-model-contract.ts", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["mobile/src/lib/offline-model-contract.ts", "litert-community/gemma-4-E4B-it-litert-lm/resolve/2eee7ac325f20eb8c9ac1d0e972f7c84663062da/gemma-4-E4B-it.litertlm", "Frozen local artifact/runtime identity or its compatibility discriminator; keep revisions pinned."],
  ["mobile/src/lib/offline-model.ts", "gemma4", "Frozen local artifact/runtime identity or its compatibility discriminator; keep revisions pinned."],
  ["mobile/src/lib/persisted-state.ts", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["mobile/src/lib/provider-client.ts", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["mobile/src/lib/types.ts", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["mobile/src/lib/ui-action-mutations.ts", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["packages/agent-runtime/src/runtime.ts", "default", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["packages/learner-contracts/src/judgement/activity-learning.ts", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["packages/learner-contracts/src/judgement/activity-observations.ts", "default", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["packages/learner-contracts/src/judgement/teaching-drafts.ts", "default", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["packages/learner-contracts/src/judgement/teaching-drafts/policy.ts", "default", "Draft variant discriminator; not an upstream inference model choice."],
  ["packages/learner-contracts/src/judgement/teaching-drafts/session.ts", "default", "Draft variant discriminator; not an upstream inference model choice."],
  ["packages/learner-contracts/src/learner-profile-declared.ts", "balanced", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["packages/learner-contracts/src/learner-profile-declared.ts", "default", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["packages/learner-contracts/src/learning.ts", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["packages/learner-contracts/src/openui-source.ts", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["packages/learner-contracts/src/rendering.ts", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["packages/learner-contracts/src/sessions.ts", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["packages/learner-contracts/src/ui.ts", "image", "UI, document or learner-state discriminator; not an upstream inference model choice."],
  ["src/tui/host/interaction.ts", "default", "Keyboard event suppression protocol discriminator; not an upstream inference model identity."],
];
const allowed = new Set(ALLOWLIST.map(([file, literal]) => `${file}\0${literal}`));

/** The identity table is private to runtime-config; any other import of it bypasses role-named defaults. */
const privateIdentityImport = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*)["'][^"']*\/model-identities(?:\.[cm]?[jt]s)?["']/;

function violations(source: string, file: string): Finding[] {
  if (privateIdentityImport.test(source)) return [{ file, literal: "import of runtime-config/model-identities" }];
  modelPattern.lastIndex = 0;
  const candidates = [
    ...(source.match(/\bMODEL_IDS\s*(?:\.\s*\w+|\[)/g) ?? []),
    ...[...source.matchAll(modelPattern)].map(match => match[0].replace(/[.:/-]+$/, "")),
    ...[...source.matchAll(new RegExp(identityHints.source, "g"))].map(match => match[1]),
  ];
  // Exact exceptions apply equally before and after lexing. A new ID still
  // forces lexing, including when added to a file with an existing exception.
  if (candidates.every(literal => allowed.has(`${file}\0${literal}`))) return [];
  return modelLiterals(source, file).filter(({ literal }) => !allowed.has(`${file}\0${literal}`));
}

function inventory(): Finding[] {
  const packages = readdirSync(join(root, "packages"), { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name !== "runtime-config")
    .map(entry => `packages/${entry.name}/src`);
  return ["src", "web/src", "web/server", "mobile/src", "shared", ...packages]
    .flatMap(sourceFiles).flatMap(file => violations(readFileSync(join(root, file), "utf8"), relative(root, join(root, file))));
}

describe("configuration hygiene", () => {
  test("flags synthetic new model IDs, aliases, scopes and template segments", () => {
    expect(modelLiterals('const model = "gpt-999-new"; const scope = `infer:claude-999-new ${suffix}`;', "synthetic.ts"))
      .toEqual([{ file: "synthetic.ts", literal: "claude-999-new" }, { file: "synthetic.ts", literal: "gpt-999-new" }]);
    expect(modelLiterals('const model = "balanced";', "synthetic.ts")).toHaveLength(1);
    expect(modelLiterals('// "gpt-999-new"\nconst ordinary = "hello";', "synthetic.ts")).toEqual([]);
    expect(modelLiterals('const view = <div data-model="gpt-999-new">Text</div>;', "synthetic.tsx"))
      .toEqual([{ file: "synthetic.tsx", literal: "gpt-999-new" }]);
    expect(modelLiterals('const scope = "infer:balanced"; const model = "zyphra/ZAYA1-8B";', "synthetic.ts"))
      .toHaveLength(2);
    expect(modelLiterals('const pattern = /"gpt-999-new"/; import x from "gpt-999-new";', "synthetic.ts"))
      .toEqual([]);
  });
  test("rejects value-named model references outside runtime-config", () => {
    expect(violations('const model = MODEL_IDS.gpt_5_4;', "synthetic.ts"))
      .toEqual([{ file: "synthetic.ts", literal: "MODEL_IDS.gpt_5_4" }]);
    expect(violations('const model = DEFAULT_MODELS.mobile.openai;', "synthetic.ts")).toEqual([]);
    expect(violations('// MODEL_IDS.gpt_5_4\nconst label = "MODEL_IDS.gpt_5_4";', "synthetic.ts")).toEqual([]);
  });
  test("rejects computed access and every import of the private identity table", () => {
    expect(violations('const model = MODEL_IDS["gpt_5_4"];', "synthetic.ts")).toEqual([{ file: "synthetic.ts", literal: "MODEL_IDS[gpt_5_4]" }]);
    for (const source of [
      'import { MODEL_IDS as ids } from "../packages/runtime-config/src/model-identities.js"; const m = ids.gpt_5_4;',
      'import * as identities from "@keating/runtime-config/src/model-identities";',
      'const { MODEL_IDS } = await import("../../packages/runtime-config/src/model-identities.ts");',
      'const identities = require("../runtime-config/src/model-identities");',
    ]) expect(violations(source, "synthetic.ts")).toEqual([{ file: "synthetic.ts", literal: "import of runtime-config/model-identities" }]);
  });

  test("runtime-config exposes role-named defaults, not the identity table", async () => {
    const publicApi = await import("../packages/runtime-config/src/index.js");
    expect(Object.keys(publicApi)).not.toContain("MODEL_IDS");
  });

  test("a frozen/UI exception cannot hide a new ID in the same file", () => {
    expect(violations('const existing = "default"; const added = "gpt-999-new";', "src/core/learner-state.ts"))
      .toEqual([{ file: "src/core/learner-state.ts", literal: "gpt-999-new" }]);
    expect(violations('const existing = "default";', "src/core/learner-state.ts")).toEqual([]);
  });
  test("non-test sources import changing model identities from runtime-config", () => {
    const findings = inventory().filter(({ file, literal }) => !allowed.has(`${file}\0${literal}`));
    expect(findings).toEqual([]);
  });
});

if (process.env.KEATING_CONFIG_INVENTORY === "1") console.log(JSON.stringify(inventory(), null, 2));
