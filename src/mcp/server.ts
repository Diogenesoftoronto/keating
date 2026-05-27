import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, isAbsolute, resolve } from "node:path";

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

import {
  benchPolicyArtifact,
  currentPolicySummary,
  dueTopicsArtifact,
  ensureProjectScaffold,
  evolvePolicyArtifact,
  listArtifacts,
  mapTopicArtifact,
  planTopicArtifact,
  quizTopicArtifact,
  timelineArtifact,
  verifyTopicArtifact
} from "../core/project.js";
import { keatingRoot } from "../core/paths.js";

const DEFAULT_WEBMCP_HOST = "127.0.0.1";
const DEFAULT_WEBMCP_PORT = 3928;

export interface WebMcpOptions {
  cwd: string;
  host?: string;
  port?: number;
  endpoint?: string;
}

export interface RunningWebMcpServer {
  server: Server;
  url: string;
  close(): Promise<void>;
}

interface ArtifactRef {
  path: string;
  uri: string;
  mimeType: string;
}

function artifactUri(path: string): string {
  return `keating://artifact/${encodeURIComponent(path)}`;
}

function artifactMimeType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case ".json":
      return "application/json";
    case ".html":
      return "text/html";
    case ".svg":
      return "image/svg+xml";
    case ".mmd":
    case ".md":
    case ".txt":
    default:
      return "text/plain";
  }
}

function artifactRef(path: string): ArtifactRef {
  return { path, uri: artifactUri(path), mimeType: artifactMimeType(path) };
}

function asToolResult(data: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data
  };
}

function errorToolResult(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true
  };
}

function safeArtifactPath(cwd: string, path: string): string {
  if (!path || isAbsolute(path)) throw new Error("Artifact path must be relative.");
  const root = resolve(keatingRoot(cwd));
  const fullPath = resolve(cwd, path);
  if (fullPath !== root && !fullPath.startsWith(`${root}/`)) {
    throw new Error("Artifact path must stay inside .keating.");
  }
  return fullPath;
}

async function readArtifact(cwd: string, path: string): Promise<string> {
  return readFile(safeArtifactPath(cwd, path), "utf8");
}

async function artifactResources(cwd: string): Promise<ArtifactRef[]> {
  const artifacts = await listArtifacts(cwd);
  return artifacts.map((artifact) => artifactRef(artifact.path));
}

export function createKeatingMcpServer(cwd: string): McpServer {
  const server = new McpServer({
    name: "keating-webmcp",
    version: "0.1.0"
  });
  const registerTool = server.registerTool.bind(server) as (
    name: string,
    config: {
      title?: string;
      description?: string;
      inputSchema?: Record<string, unknown>;
      annotations?: Record<string, unknown>;
    },
    callback: (args: any) => unknown
  ) => void;
  const registerPrompt = server.registerPrompt.bind(server) as (
    name: string,
    config: {
      title?: string;
      description?: string;
      argsSchema?: Record<string, unknown>;
    },
    callback: (args: any) => unknown
  ) => void;

  server.registerResource(
    "keating_policy",
    "keating://policy/current",
    {
      title: "Current Keating teaching policy",
      description: "The active local teaching policy summary.",
      mimeType: "text/plain"
    },
    async (uri) => ({
      contents: [{ uri: uri.href, text: await currentPolicySummary(cwd), mimeType: "text/plain" }]
    })
  );

  server.registerResource(
    "keating_artifacts",
    "keating://artifacts",
    {
      title: "Keating artifact index",
      description: "Recently generated plans, maps, quizzes, benchmarks, traces, and other artifacts.",
      mimeType: "application/json"
    },
    async (uri) => ({
      contents: [{ uri: uri.href, text: JSON.stringify(await artifactResources(cwd), null, 2), mimeType: "application/json" }]
    })
  );

  server.registerResource(
    "keating_artifact",
    new ResourceTemplate("keating://artifact/{artifactPath}", {
      list: async () => ({
        resources: (await artifactResources(cwd)).map((artifact) => ({
          uri: artifact.uri,
          name: artifact.path,
          title: artifact.path,
          mimeType: artifact.mimeType
        }))
      })
    }),
    {
      title: "Keating artifact",
      description: "Read a generated Keating artifact by encoded relative path.",
      mimeType: "text/plain"
    },
    async (uri, variables) => {
      const rawPath = Array.isArray(variables.artifactPath)
        ? variables.artifactPath[0]
        : variables.artifactPath;
      const path = decodeURIComponent(rawPath ?? "");
      return {
        contents: [{ uri: uri.href, text: await readArtifact(cwd, path), mimeType: artifactMimeType(path) }]
      };
    }
  );

  registerTool(
    "keating_plan_topic",
    {
      title: "Plan a topic",
      description: "Generate a deterministic Keating lesson plan artifact for a topic.",
      inputSchema: { topic: z.string().min(1) },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    async ({ topic }) => {
      try {
        const artifact = await planTopicArtifact(cwd, topic);
        const ref = artifactRef(artifact.planPath.replace(`${cwd}/`, ""));
        return asToolResult({ topic, artifact: ref, markdown: await readArtifact(cwd, ref.path) });
      } catch (error) {
        return errorToolResult(error);
      }
    }
  );

  registerTool(
    "keating_map_topic",
    {
      title: "Map a topic",
      description: "Generate a Mermaid concept map for a topic.",
      inputSchema: { topic: z.string().min(1) },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    async ({ topic }) => {
      try {
        const artifact = await mapTopicArtifact(cwd, topic);
        const mmd = artifactRef(artifact.mmdPath.replace(`${cwd}/`, ""));
        return asToolResult({
          topic,
          artifacts: [mmd, ...(artifact.svgPath ? [artifactRef(artifact.svgPath.replace(`${cwd}/`, ""))] : [])],
          mermaid: await readArtifact(cwd, mmd.path)
        });
      } catch (error) {
        return errorToolResult(error);
      }
    }
  );

  registerTool(
    "keating_quiz_topic",
    {
      title: "Quiz a topic",
      description: "Generate retrieval practice questions and an answer key for a topic.",
      inputSchema: { topic: z.string().min(1), includeAnswers: z.boolean().optional() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    async ({ topic, includeAnswers }) => {
      try {
        const artifact = await quizTopicArtifact(cwd, topic);
        const quiz = artifactRef(artifact.quizPath.replace(`${cwd}/`, ""));
        const answers = artifactRef(artifact.answersPath.replace(`${cwd}/`, ""));
        return asToolResult({
          topic,
          artifacts: [quiz, answers],
          quiz: await readArtifact(cwd, quiz.path),
          answers: includeAnswers === false ? undefined : await readArtifact(cwd, answers.path)
        });
      } catch (error) {
        return errorToolResult(error);
      }
    }
  );

  registerTool(
    "keating_verify_topic",
    {
      title: "Verify a topic",
      description: "Generate a verification checklist for a topic. LLM verification is opt-in.",
      inputSchema: { topic: z.string().min(1), useLLM: z.boolean().optional() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true }
    },
    async ({ topic, useLLM }) => {
      try {
        const result = await verifyTopicArtifact(cwd, topic, useLLM ?? false);
        const checklist = artifactRef(result.checklistPath.replace(`${cwd}/`, ""));
        return asToolResult({
          topic,
          alreadyVerified: result.alreadyVerified,
          artifact: checklist,
          result: result.result,
          checklist: await readArtifact(cwd, checklist.path)
        });
      } catch (error) {
        return errorToolResult(error);
      }
    }
  );

  registerTool(
    "keating_teach_topic",
    {
      title: "Build a teaching bundle",
      description: "Generate a compact bundle of Keating artifacts an agent can use to teach or learn a topic.",
      inputSchema: {
        topic: z.string().min(1),
        includeMap: z.boolean().optional(),
        includeQuiz: z.boolean().optional(),
        includeVerification: z.boolean().optional()
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    async ({ topic, includeMap, includeQuiz, includeVerification }) => {
      try {
        const artifacts: ArtifactRef[] = [];
        const plan = await planTopicArtifact(cwd, topic);
        const planRef = artifactRef(plan.planPath.replace(`${cwd}/`, ""));
        artifacts.push(planRef);

        let mermaid: string | undefined;
        let quiz: string | undefined;
        let checklist: string | undefined;

        if (includeMap ?? true) {
          const map = await mapTopicArtifact(cwd, topic);
          const mapRef = artifactRef(map.mmdPath.replace(`${cwd}/`, ""));
          artifacts.push(mapRef);
          if (map.svgPath) artifacts.push(artifactRef(map.svgPath.replace(`${cwd}/`, "")));
          mermaid = await readArtifact(cwd, mapRef.path);
        }

        if (includeQuiz ?? true) {
          const quizArtifact = await quizTopicArtifact(cwd, topic);
          const quizRef = artifactRef(quizArtifact.quizPath.replace(`${cwd}/`, ""));
          artifacts.push(quizRef, artifactRef(quizArtifact.answersPath.replace(`${cwd}/`, "")));
          quiz = await readArtifact(cwd, quizRef.path);
        }

        if (includeVerification ?? true) {
          const verification = await verifyTopicArtifact(cwd, topic, false);
          const verificationRef = artifactRef(verification.checklistPath.replace(`${cwd}/`, ""));
          artifacts.push(verificationRef);
          checklist = await readArtifact(cwd, verificationRef.path);
        }

        return asToolResult({
          topic,
          artifacts,
          plan: await readArtifact(cwd, planRef.path),
          mermaid,
          quiz,
          checklist
        });
      } catch (error) {
        return errorToolResult(error);
      }
    }
  );

  registerTool(
    "keating_benchmark_policy",
    {
      title: "Benchmark policy",
      description: "Benchmark the active teaching policy against deterministic synthetic learners.",
      inputSchema: { topic: z.string().min(1).optional() },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    async ({ topic }) => {
      try {
        const result = await benchPolicyArtifact(cwd, topic);
        return asToolResult({
          topic,
          overallScore: result.overallScore,
          artifacts: [
            artifactRef(result.reportPath.replace(`${cwd}/`, "")),
            ...(result.tracePath ? [artifactRef(result.tracePath.replace(`${cwd}/`, ""))] : [])
          ]
        });
      } catch (error) {
        return errorToolResult(error);
      }
    }
  );

  registerTool(
    "keating_evolve_policy",
    {
      title: "Evolve policy",
      description: "Run MAP-Elites policy evolution and save the best policy as the active policy.",
      inputSchema: { topic: z.string().min(1).optional() },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false }
    },
    async ({ topic }) => {
      try {
        const result = await evolvePolicyArtifact(cwd, topic);
        return asToolResult({
          topic,
          bestScore: result.bestScore,
          artifacts: [
            artifactRef(result.reportPath.replace(`${cwd}/`, "")),
            artifactRef(result.policyPath.replace(`${cwd}/`, "")),
            ...(result.tracePath ? [artifactRef(result.tracePath.replace(`${cwd}/`, ""))] : [])
          ]
        });
      } catch (error) {
        return errorToolResult(error);
      }
    }
  );

  registerTool(
    "keating_read_artifact",
    {
      title: "Read artifact",
      description: "Read a generated Keating artifact from a relative .keating path.",
      inputSchema: { path: z.string().min(1) },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async ({ path }) => {
      try {
        return asToolResult({ artifact: artifactRef(path), text: await readArtifact(cwd, path) });
      } catch (error) {
        return errorToolResult(error);
      }
    }
  );

  registerTool(
    "keating_list_artifacts",
    {
      title: "List artifacts",
      description: "List generated Keating artifacts with MCP resource URIs.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async () => {
      try {
        return asToolResult({ artifacts: await artifactResources(cwd) });
      } catch (error) {
        return errorToolResult(error);
      }
    }
  );

  registerTool(
    "keating_policy",
    {
      title: "Show policy",
      description: "Show the active teaching policy.",
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    },
    async () => {
      try {
        return asToolResult({ policy: await currentPolicySummary(cwd) });
      } catch (error) {
        return errorToolResult(error);
      }
    }
  );

  registerTool(
    "keating_due_topics",
    {
      title: "Due topics",
      description: "Show topics due for spaced review.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    async () => {
      try {
        const result = await dueTopicsArtifact(cwd);
        return asToolResult({
          count: result.count,
          artifact: artifactRef(result.reportPath.replace(`${cwd}/`, "")),
          markdown: result.markdown
        });
      } catch (error) {
        return errorToolResult(error);
      }
    }
  );

  registerTool(
    "keating_timeline",
    {
      title: "Timeline",
      description: "Show the learner engagement timeline.",
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }
    },
    async () => {
      try {
        const result = await timelineArtifact(cwd);
        return asToolResult({
          artifact: artifactRef(result.reportPath.replace(`${cwd}/`, "")),
          markdown: result.markdown
        });
      } catch (error) {
        return errorToolResult(error);
      }
    }
  );

  registerPrompt(
    "learn_with_keating",
    {
      title: "Learn with Keating",
      description: "A short prompt for an agent that wants to use Keating artifacts to learn a topic.",
      argsSchema: { topic: z.string().min(1) }
    },
    ({ topic }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: `Use Keating to learn "${topic}". Start with keating_teach_topic, inspect the generated artifacts, then teach back the core intuition, formal structure, misconceptions, and retrieval-practice answers.`
          }
        }
      ]
    })
  );

  return server;
}

function isAllowedLocalHostHeader(hostHeader: string | undefined, bindHost: string): boolean {
  if (!hostHeader) return true;
  const host = hostHeader.split(":")[0]?.toLowerCase();
  const allowed = new Set([bindHost.toLowerCase(), "localhost", "127.0.0.1", "::1"]);
  return Boolean(host && allowed.has(host));
}

function writeJson(res: ServerResponse, status: number, data: Record<string, unknown>): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(data, null, 2));
}

export async function serveWebMcp(options: WebMcpOptions): Promise<RunningWebMcpServer> {
  const host = options.host ?? DEFAULT_WEBMCP_HOST;
  const port = options.port ?? DEFAULT_WEBMCP_PORT;
  const endpoint = options.endpoint ?? "/mcp";

  await ensureProjectScaffold(options.cwd);

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (!isAllowedLocalHostHeader(req.headers.host, host) && host !== "0.0.0.0") {
      writeJson(res, 403, { error: "Host header is not allowed for local WebMCP." });
      return;
    }

    const requestUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? host}`);
    if (requestUrl.pathname === "/health") {
      writeJson(res, 200, { ok: true, name: "keating-webmcp", endpoint });
      return;
    }

    if (requestUrl.pathname !== endpoint) {
      writeJson(res, 404, { error: "Not found", endpoint });
      return;
    }

    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type, mcp-session-id, mcp-protocol-version"
      });
      res.end();
      return;
    }

    if (req.method !== "GET" && req.method !== "POST") {
      writeJson(res, 405, { error: "Method not allowed" });
      return;
    }

    const mcpServer = createKeatingMcpServer(options.cwd);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

    res.on("close", () => {
      void transport.close();
      void mcpServer.close();
    });

    try {
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      if (!res.headersSent) writeJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
      else res.end();
    }
  });

  await new Promise<void>((resolveListen, rejectListen) => {
    httpServer.once("error", rejectListen);
    httpServer.listen(port, host, () => {
      httpServer.off("error", rejectListen);
      resolveListen();
    });
  });

  const address = httpServer.address();
  const actualPort = typeof address === "object" && address ? address.port : port;
  const url = `http://${host}:${actualPort}${endpoint}`;

  return {
    server: httpServer,
    url,
    close: () => new Promise((resolveClose, rejectClose) => {
      httpServer.close((error) => error ? rejectClose(error) : resolveClose());
    })
  };
}
