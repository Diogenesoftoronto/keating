/** Export the existing default web tutor prompt without opening learner storage. */
import { plugin } from "bun";
import { createHash } from "node:crypto";
import { chmod, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const root = resolve(import.meta.dir, "../..");
const output = resolve(root, process.argv[2] ?? ".keating/outputs/training/system-prompt.txt");
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

// Bun does not implement Vite's ?raw import convention. Read the same checked-in
// bytes that Vite supplies; all prose continues to come from application modules.
await plugin({
  name: "keating-prompt-raw-markdown",
  setup(build) {
    build.onLoad({ filter: /\.md(?:\?raw)?$/ }, async (args) => ({
      contents: `export default ${JSON.stringify(await Bun.file(args.path.replace(/\?raw$/, "")).text())};`,
      loader: "js",
    }));
  },
});

const { buildKeatingSystemPrompt, composeKeatingSystemPrompt } = await import(
  "../../web/src/keating/browser-tools/prompt"
);
const { DEFAULT_TEACHER_PERSONA } = await import("../../web/src/keating/persona");
const { keatingOpenUIPrompt } = await import("../../web/src/keating/openui/library");
const { composeSessionStartSystemPrompt } = await import("../../web/src/keating/session-start-hooks");
const { appendWorkspaceCapabilityPrompt } = await import("../../web/src/keating/capabilities");
const { appendCourseCollaborationPrompt } = await import("../../web/src/keating/browser-tools/courses");
// A transitive PDF dependency allocates a DOMMatrix at import time. Use the
// installed real canvas implementation for Node compatibility; no tool code or
// schemas are replaced, and no PDF/media processing runs during this export.
if (typeof globalThis.DOMMatrix === "undefined") {
  const webRequire = createRequire(resolve(root, "web/package.json"));
  globalThis.DOMMatrix = webRequire("@napi-rs/canvas").DOMMatrix;
}
const { createKeatingTools } = await import("../../web/src/keating/browser-tools");
const { filterAvailableKeatingTools } = await import("../../web/src/keating/capabilities");
const { KeatingStorage } = await import("../../web/src/keating/storage");

// The real storage constructor only records its database name. Never initialize
// it or invoke tools: this exports the application's declarations, not results.
const declarationStorage = new KeatingStorage("keating-training-schema-export-unused");
const registeredTools = await createKeatingTools(declarationStorage, {});
const availableTools = filterAvailableKeatingTools(registeredTools, {
  runtime: undefined, speechEnabled: false, clientWebSearch: false,
});
const toolSchemas = availableTools.map((tool) => ({
  type: "function" as const,
  function: { name: tool.name, description: tool.description, parameters: tool.parameters },
}));
if (!toolSchemas.length || new Set(toolSchemas.map((tool) => tool.function.name)).size !== toolSchemas.length) {
  throw new Error("Expected nonempty uniquely named Keating tool declarations");
}
const toolsText = `${JSON.stringify(toolSchemas, null, 2)}\n`;
const toolsOutput = resolve(dirname(output), "tool-schemas.json");

const base = composeKeatingSystemPrompt(DEFAULT_TEACHER_PERSONA);
const withLearner = buildKeatingSystemPrompt(false, base, "");
const withOpenUi = base.includes(keatingOpenUIPrompt)
  ? withLearner
  : `${withLearner}\n\n${keatingOpenUIPrompt}`;
const composed = appendCourseCollaborationPrompt(
  appendWorkspaceCapabilityPrompt(composeSessionStartSystemPrompt(withOpenUi, ""), { runtime: undefined }),
  undefined,
);

// Independently execute the actual builder declaration from the React hook. We
// deliberately avoid importing that hook, which initializes application storage.
// TypeScript removes only types; dependencies are the same functions imported above.
const hookPath = "web/src/hooks/useKeatingAgent.tsx";
const hook = await readFile(resolve(root, hookPath), "utf8");
const sourceFile = ts.createSourceFile(hookPath, hook, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const builders = sourceFile.statements.filter((node): node is ts.FunctionDeclaration =>
  ts.isFunctionDeclaration(node) && node.name?.text === "buildAgentSystemPrompt",
);
if (builders.length !== 1) throw new Error("Expected exactly one original web prompt builder");
const originalSource = builders[0]!.getText(sourceFile);
const executable = ts.transpileModule(originalSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  reportDiagnostics: true,
});
if (executable.diagnostics?.some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error)) {
  throw new Error("Could not compile original web prompt builder");
}
const originalBuilder = new Function(
  "buildKeatingSystemPrompt", "keatingOpenUIPrompt", "composeSessionStartSystemPrompt",
  "appendWorkspaceCapabilityPrompt", "appendCourseCollaborationPrompt",
  `${executable.outputText}\nreturn buildAgentSystemPrompt;`,
)(buildKeatingSystemPrompt, keatingOpenUIPrompt, composeSessionStartSystemPrompt,
  appendWorkspaceCapabilityPrompt, appendCourseCollaborationPrompt);
const original = originalBuilder(false, base, "", "", undefined, undefined);
if (typeof original !== "string" || original !== composed) {
  throw new Error("Export differs from the original web hook prompt builder");
}
if (original.split(keatingOpenUIPrompt).length !== 2) {
  throw new Error("OpenUI prompt must appear exactly once");
}

const inputs = [
  hookPath, "web/src/keating/browser-tools/prompt.ts", "web/src/keating/persona.ts",
  "web/src/keating/learner-context.ts", "web/src/keating/prompts/operational-protocol.md",
  "web/src/keating/prompts/speech-system-prompt.md", "web/src/keating/openui/library.tsx",
  "web/src/keating/session-start-hooks.ts", "web/src/keating/capabilities.ts",
  "web/src/keating/browser-tools/courses.ts", "web/package.json", "bun.lock",
  "web/src/keating/browser-tools.ts", "web/src/keating/storage.ts", "web/src/keating/speech.ts",
  ...(await readdir(resolve(root, "web/src/keating/browser-tools")))
    .filter((name) => name.endsWith(".ts"))
    .map((name) => `web/src/keating/browser-tools/${name}`),
];
const inputHashes = Object.fromEntries(await Promise.all(inputs.map(async (path) =>
  [path, digest(await readFile(resolve(root, path)))] as const,
)));
const metadata = {
  schemaVersion: 1,
  promptSha256: digest(original),
  bytes: Buffer.byteLength(original),
  characters: original.length,
  openUiCharacters: keatingOpenUIPrompt.length,
  originalBuilderSha256: digest(originalSource),
  verifiedEqualToOriginalWebBuilder: true,
  toolSchemas: {
    sha256: digest(toolsText), bytes: Buffer.byteLength(toolsText), count: toolSchemas.length,
    names: toolSchemas.map((tool) => tool.function.name),
    environment: { runtime: null, speechEnabled: false, clientWebSearch: false },
    source: "createKeatingTools then filterAvailableKeatingTools; direct AgentTool parameters",
    storageInitialized: false, toolsExecuted: false,
    nodeCompatibility: "Installed @napi-rs/canvas DOMMatrix for import-time PDF dependency",
  },
  state: {
    persona: "DEFAULT_TEACHER_PERSONA", speechEnabled: false,
    learnerContext: "", sessionStartContext: "", runtime: null, course: null,
    activeTeachingRevision: null,
  },
  sourceSha256: inputHashes,
  limitations: [
    "Default new-user web prompt with empty learner and startup context; no browser storage was read.",
    "Existing accounts, active teaching revisions, runtime or course context may produce different prompts.",
    "Tool schemas are exported separately in tool-schemas.json; tools were declared but never executed.",
    "Token count depends on the chosen model tokenizer; byte and character counts are not token counts.",
  ],
};
await mkdir(dirname(output), { recursive: true, mode: 0o700 });
await writeFile(output, original, { mode: 0o600 });
await chmod(output, 0o600);
await writeFile(toolsOutput, toolsText, { mode: 0o600 });
await chmod(toolsOutput, 0o600);
await writeFile(`${output}.metadata.json`, `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600 });
await chmod(`${output}.metadata.json`, 0o600);
console.log(JSON.stringify({ output, sha256: metadata.promptSha256, bytes: metadata.bytes,
  characters: metadata.characters, verifiedEqualToOriginalWebBuilder: true,
  toolsOutput, toolSchemas: metadata.toolSchemas }));
