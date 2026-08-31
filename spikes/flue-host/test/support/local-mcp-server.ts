import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

export interface LocalMcpEvidence {
  authHeaders: string[];
  methods: string[];
  remoteAddresses: string[];
  readCalls: Array<{ learnerId: string }>;
  mutationCalls: number;
}

export interface LocalMcpFixture {
  url: string;
  evidence: LocalMcpEvidence;
  close: () => Promise<void>;
}

function requestMethod(body: Uint8Array): string {
  if (body.byteLength === 0) return "(bodyless)";

  try {
    const parsed = JSON.parse(Buffer.from(body).toString("utf8")) as {
      method?: unknown;
    };
    return typeof parsed.method === "string" ? parsed.method : "(response)";
  } catch {
    return "(invalid-json)";
  }
}

async function bodyOf(request: IncomingMessage): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Uint8Array.from(Buffer.concat(chunks));
}

async function writeWebResponse(
  response: Response,
  destination: ServerResponse,
): Promise<void> {
  destination.writeHead(
    response.status,
    Object.fromEntries(response.headers.entries()),
  );
  destination.end(Buffer.from(await response.arrayBuffer()));
}

export async function startLocalMcpServer(
  expectedToken: string,
): Promise<LocalMcpFixture> {
  const evidence: LocalMcpEvidence = {
    authHeaders: [],
    methods: [],
    remoteAddresses: [],
    readCalls: [],
    mutationCalls: 0,
  };

  const handler = createMcpHandler(
    () => {
      const mcp = new McpServer({
        name: "keating-local-learning-records",
        version: "1.0.0",
      });
      mcp.registerTool(
        "read_learning_record",
        {
          description: "Read a deterministic learner record by learner ID.",
          inputSchema: z.object({ learnerId: z.string().min(1) }),
          annotations: { readOnlyHint: true },
        },
        ({ learnerId }) => {
          evidence.readCalls.push({ learnerId });
          return {
            content: [
              {
                type: "text" as const,
                text: `Learner ${learnerId}: fractions retrieval score 0.75.`,
              },
            ],
          };
        },
      );
      mcp.registerTool(
        "mutate_learning_record",
        {
          description: "Mutation sentinel that the host must never expose.",
          inputSchema: z.object({ learnerId: z.string().min(1) }),
          annotations: { destructiveHint: true, readOnlyHint: false },
        },
        () => {
          evidence.mutationCalls += 1;
          return {
            content: [{ type: "text" as const, text: "mutation sentinel" }],
          };
        },
      );
      return mcp;
    },
    { responseMode: "json" },
  );

  const server = createServer(async (request, response) => {
    try {
      const body = await bodyOf(request);
      evidence.methods.push(requestMethod(body));
      evidence.authHeaders.push(request.headers.authorization ?? "");
      evidence.remoteAddresses.push(request.socket.remoteAddress ?? "");

      if (request.headers.authorization !== `Bearer ${expectedToken}`) {
        response.writeHead(401, { "www-authenticate": "Bearer" });
        response.end("unauthorized");
        return;
      }

      const origin = `http://${request.headers.host ?? "127.0.0.1"}`;
      const init: RequestInit & { duplex?: "half" } = {
        method: request.method,
        headers: new Headers(request.headers as Record<string, string>),
      };
      if (body.byteLength > 0) {
        const requestBody = new ArrayBuffer(body.byteLength);
        new Uint8Array(requestBody).set(body);
        init.body = requestBody;
        init.duplex = "half";
      }
      const webRequest = new Request(
        new URL(request.url ?? "/mcp", origin),
        init,
      );
      await writeWebResponse(await handler.fetch(webRequest), response);
    } catch (error) {
      response.writeHead(500, { "content-type": "text/plain" });
      response.end(error instanceof Error ? error.message : String(error));
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Local MCP fixture did not bind a TCP port.");
  }

  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    evidence,
    async close() {
      await handler.close();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}
