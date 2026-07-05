import { Nav } from "../components/Nav";
import { SimpleFooter } from "../components/Footer";
import { CommitReviewArticle, type CommitReviewSection } from "../components/CommitReviewArticle";
import { useSeo } from "../hooks/useSeo";
import { css } from "../../styled-system/css";

const mainContentClass = css({ paddingInline: "1.5rem", paddingBlockStart: "1.5rem", paddingBlockEnd: "4rem" });

const ROUTE_PATH = "/review/latest-commit";

const SECTIONS: CommitReviewSection[] = [
  {
    id: "cli-entry",
    title: "CLI entrypoint: accept a project root",
    file: "src/cli/main.ts",
    why: "The flow starts when `keating web` parses launch arguments. This commit teaches the CLI two new ideas: what directory counts as the host project, and whether ignore rules should be bypassed.",
    takeaway: "The user now declares the capability boundary at launch time with `--root=PATH` and can opt out of ignore filtering with `--no-ignore`.",
    snippet: `return {\n  port,\n  options: {\n    agentRuntimeMode: modes[0] ?? \"browser-only\",\n    projectRoot: optionValue(args, \"--root\"),\n    noIgnore: args.includes(\"--no-ignore\"),\n    remoteProvider: optionValue(args, \"--remote-provider\"),\n    cloudEndpoint: optionValue(args, \"--cloud-endpoint\")\n  }\n};`,
  },
  {
    id: "server-launch",
    title: "Web server launcher: translate CLI choices into env vars",
    file: "src/cli/web.ts",
    why: "The CLI itself does not serve project files. It passes configuration into the Nitro server process through environment variables, which keeps the boundary explicit and inspectable.",
    takeaway: "CLI args become process env, and the server process becomes the authority that decides whether project access exists.",
    snippet: `const env = {\n  ...process.env,\n  PORT: port.toString(),\n  KEATING_WEB_AGENT_MODE: mode,\n  KEATING_WEB_PROJECT_ROOT: projectRoot,\n  KEATING_WEB_PROJECT_NO_IGNORE: noIgnore ? \"1\" : \"\",\n};`,
  },
  {
    id: "runtime-config",
    title: "Runtime config: advertise the new capability",
    file: "web/server/api/agent-runtime/config.ts",
    why: "The browser agent needs a discoverable way to learn whether host project access exists. This route is the capability advertisement layer.",
    takeaway: "The browser now learns three key facts: the project root string, the project files endpoint, and the boolean `hostProjectAccess` capability.",
    snippet: `return {\n  mode,\n  label: \"Browser-only agent\",\n  executionEndpoint: null,\n  cloudEndpoint: null,\n  projectRoot,\n  projectFilesEndpoint: projectRoot ? \"/api/project-files\" : null,\n  capabilities: {\n    browserLocal: true,\n    hostProjectAccess: !!projectRoot,\n  },\n};`,
  },
  {
    id: "browser-runtime",
    title: "Browser runtime model: preserve the fields client-side",
    file: "web/src/keating/agent-runtime.ts",
    why: "Even if the server returns the new capability, the browser would lose it unless its runtime config type and normalization logic preserve those fields.",
    takeaway: "The browser runtime now keeps `projectRoot`, `projectFilesEndpoint`, and `hostProjectAccess` alive all the way to tool creation.",
    snippet: `if (mode === \"browser-only\") {\n  const projectFilesEndpoint = raw.projectFilesEndpoint ?? null;\n  return {\n    ...DEFAULT_AGENT_RUNTIME_CONFIG,\n    projectRoot: raw.projectRoot ?? null,\n    projectFilesEndpoint,\n    capabilities: {\n      ...DEFAULT_AGENT_RUNTIME_CONFIG.capabilities,\n      hostProjectAccess: !!projectFilesEndpoint,\n    },\n  };\n}`,
  },
  {
    id: "security-gate",
    title: "Project-files API: the real security gate",
    file: "web/server/api/project-files/[...path].ts",
    why: "This is the most important file in the commit. It is where the server decides whether a request to list or read a project path is allowed.",
    takeaway: "The browser does not read disk directly. It asks this route, and this route enforces root checks, ignore rules, hard-blocked directories, regular-file checks, size limits, and symlink-safe resolution.",
    snippet: `const target = resolve(root, relPath);\nconst lexicalRel = relative(root, target);\nif (pathEscapesRoot(lexicalRel)) {\n  throw createError({ statusCode: 400, statusMessage: \"Path escapes project root\" });\n}\n\nconst [realRoot, realTarget] = await Promise.all([realpath(root), realpath(target)]);\nconst resolvedRel = relative(realRoot, realTarget);\nif (pathEscapesRoot(resolvedRel)) {\n  throw createError({ statusCode: 400, statusMessage: \"Path escapes project root\" });\n}`,
  },
  {
    id: "browser-tools",
    title: "Browser tools: agent-friendly wrappers over HTTP",
    file: "web/src/keating/browser-tools.ts",
    why: "The agent does not need to know about Nitro routes or filesystem APIs. It only needs tools that describe its allowed actions.",
    takeaway: "`list_project_files` and `read_project_file` turn the HTTP route into simple, legible agent tools and return friendly markdown-shaped responses.",
    snippet: `createTool(\n  \"read_project_file\",\n  \"Read the contents of a file from the host project root.\",\n  { path: { type: \"string\" } },\n  async (params) => {\n    const runtime = options.agentRuntime;\n    if (!runtime?.projectFilesEndpoint) {\n      return \"Project files endpoint is not available.\";\n    }\n    const relPath = String(params.path ?? \"\").replace(/^\\/+/, \"\");\n    const res = await fetch(\`\${runtime.projectFilesEndpoint}/\${relPath}\`);\n    const data = await res.json() as { path: string; content: string; size: number };\n    return [\`# \${data.path}\`, \`(\${data.size} bytes)\`, \"\", data.content].join(\"\\n\");\n  }\n);`,
  },
  {
    id: "tests",
    title: "Tests: prove capability propagation and symlink safety",
    file: "web/src/test/*.test.ts",
    why: "A feature like this can fail in two ways: the browser never sees the capability, or the server exposes too much. The tests target both risks.",
    takeaway: "One test locks in capability propagation for browser-only mode. The other locks in the symlink escape defense.",
    snippet: `await symlink(outside, join(root, \"secret\"));\nawait expect(resolveProjectPath(root, \"secret\")).rejects.toMatchObject({\n  statusCode: 400,\n  statusMessage: \"Path escapes project root\",\n});`,
  },
];

export function LatestCommitReview() {
  useSeo({
    title: "Latest Commit Review — Fix web agent project file access",
    description: "A teachable walkthrough of commit c9d2425: CLI → server config → secure project-files API → browser tools.",
    canonical: `https://keating.help${ROUTE_PATH}`,
  });

  return (
    <div className="retro-layout retro-page">
      <Nav />
      <main className={mainContentClass}>
        <CommitReviewArticle
          commit="c9d2425"
          title="Fix web agent project file access"
          subtitle="A file-by-file walkthrough of how Keating now lets the browser agent inspect the host project through a narrow HTTP capability boundary instead of direct filesystem access."
          routePath={ROUTE_PATH}
          summary={[
            "Adds a launch-time project root for `keating web`.",
            "Surfaces host-project access in runtime config.",
            "Creates a secure `/api/project-files/**` boundary for listing and reading files.",
            "Adds browser tools that consume that boundary instead of touching disk directly.",
          ]}
          misconception="The commit did not give the browser direct filesystem access. It gave the browser agent a constrained HTTP capability, with the server acting as the gatekeeper."
          flow={[
            { label: "CLI parses `--root` and `--no-ignore`", detail: "The capability starts as an explicit user choice when launching `keating web`." },
            { label: "Server process receives env vars", detail: "The launcher passes project settings into Nitro through `KEATING_WEB_PROJECT_*`." },
            { label: "Runtime config advertises host project access", detail: "The browser discovers `projectFilesEndpoint` and `hostProjectAccess`." },
            { label: "Browser runtime preserves capability metadata", detail: "Normalization keeps the project access fields alive in browser-only, remote, and cloud modes." },
            { label: "Agent calls `list_project_files` / `read_project_file`", detail: "The tools feel simple to the model, but they are only HTTP wrappers." },
            { label: "Server route approves or rejects the request", detail: "This is where root escape, ignore filtering, blocked directories, and size limits are enforced." },
          ]}
          sections={SECTIONS}
          guardrails={[
            "The server rejects lexical path traversal such as `../secret.txt`.",
            "The server also rejects resolved-path escape after following symlinks with `realpath(...)`.",
            "`.git` and `node_modules` are always blocked, even with `--no-ignore`.",
            "Ignored paths stay hidden by default, which reduces noise and avoids casual exposure of files the project already marked as ignorable.",
            "Only regular files are served, and files above 2 MiB are rejected.",
          ]}
          tests={[
            "`web/src/test/agent-runtime.test.ts` now verifies that browser-only mode can still preserve project file access metadata.",
            "`web/src/test/project-files.test.ts` proves that a symlink inside the repo cannot smuggle the server outside the project root.",
            "I re-ran those targeted tests after building this page: 5 passing, 0 failing.",
          ]}
          extraChange="The same commit also adds inline artifact rendering in `web/src/pages/Chat.tsx`, which is good UI work but separate from the main project-file-access pipeline."
          quizzes={[
            {
              prompt: "Which file is the true security gate: `browser-tools.ts` or `project-files/[...path].ts`?",
              answer: "`project-files/[...path].ts`. The tools are just the interface. The server route is where the rules are enforced.",
            },
            {
              prompt: "Why is `realpath(...)` stronger than checking for `..` in the input string?",
              answer: "Because a path can look safe textually but still resolve through a symlink to a location outside the repo. `realpath(...)` checks the final destination, not just the spelling.",
            },
          ]}
        />
      </main>
      <SimpleFooter />
    </div>
  );
}
