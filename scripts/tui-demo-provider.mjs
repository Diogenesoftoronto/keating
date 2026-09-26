#!/usr/bin/env bun

// Deterministic local capture provider. Usage: bun scripts/tui-demo-provider.mjs [port]

import { serve } from "bun";

const requestedPort = Number.parseInt(process.argv[2] ?? "58173", 10);
const port = Number.isFinite(requestedPort) ? requestedPort : 58173;
const corsHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "*",
};

const contradictionReply = [
  "Proof by contradiction works because a claim and its negation cannot both be true.",
  "We temporarily assume the claim is false, then follow that assumption until it violates a known fact or itself.",
  "That contradiction eliminates the negation, so the original claim must stand.",
].join(" ");

const exampleReply = [
  "Take √2.",
  "If √2 = a/b in lowest terms, squaring forces both a and b to be even—contradicting ‘lowest terms.’",
  "Therefore √2 is irrational.",
].join(" ");

const raftReply = [
  "In Raft, if two entries in different logs have the same index and term, they store the identical command and their logs are identical up to that point.",
  "Now imagine two candidates timeout at the exact same millisecond in term 3 and both request votes.",
  "What condition prevents both candidates from acquiring a majority quorum simultaneously in the same term?",
].join(" ");

const citiesReply = [
  "A city often begins where people have a reason to stop, exchange goods, and stay.",
  "Rivers supply water and transport, while sheltered harbours and crossing trade routes bring people together.",
  "If you were choosing a site for a new city, which of those advantages would matter most, and why?",
].join(" ");

const stoppingRuleHint = [
  "Hint: trace the update before changing the stopping rule.",
  "For `while (n !== 0) { n = n - 1; }`, does subtracting 1 move a negative number toward zero or away from it?",
  "What do you predict happens for n = -3?",
].join(" ");

const stoppingRuleConfirmation = [
  "Yes. Starting at -3 gives -4, -5, and so on, so the loop never reaches zero.",
  "To handle negative inputs too, each step needs to move toward zero.",
  "Can you restate the fix in your own words?",
].join(" ");

function replyFor(messages) {
  const latest = [...messages].reverse().find((message) => message && message.role === "user");
  const content = Array.isArray(latest?.content)
    ? latest.content
        .map((part) =>
          typeof part === "string"
            ? part
            : typeof part?.text === "string"
              ? part.text
              : typeof part?.content === "string"
                ? part.content
                : "",
        )
        .join(" ")
    : typeof latest?.content === "string"
      ? latest.content
      : "";
  if (content.toLowerCase().includes("raft") || content.toLowerCase().includes("consensus")) return raftReply;
  if (content.toLowerCase().includes("numerical example")) return exampleReply;
  if (content.includes("Explain why this stopping rule fails when the input is negative.")) return stoppingRuleHint;
  if (content.includes("It never reaches zero, so it loops forever?")) return stoppingRuleConfirmation;
  return content.toLowerCase().includes("cities") ? citiesReply : contradictionReply;
}

function chunk(id, content, finishReason = null) {
  return JSON.stringify({
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: "local-tutor",
    choices: [{ index: 0, delta: content, finish_reason: finishReason }],
  });
}

const server = serve({
  hostname: "127.0.0.1",
  port,
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
    if (url.pathname === "/health") return new Response("ready\n", { headers: corsHeaders });
    if (request.method === "GET" && url.pathname === "/v1/models") {
      return Response.json(
        { object: "list", data: [{ id: "local-tutor", object: "model", owned_by: "keating" }] },
        { headers: corsHeaders },
      );
    }
    if (request.method !== "POST" || url.pathname !== "/v1/chat/completions") {
      return Response.json({ error: { message: "Not found" } }, { status: 404, headers: corsHeaders });
    }

    const body = await request.json();
    const text = replyFor(Array.isArray(body.messages) ? body.messages : []);
    const id = `chatcmpl-keating-${Date.now()}`;

    if (body.stream === false) {
      return Response.json(
        {
          id,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: "local-tutor",
          choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
          usage: { prompt_tokens: 24, completion_tokens: 46, total_tokens: 70 },
        },
        { headers: corsHeaders },
      );
    }

    const words = text.split(/(?<=\s)/u);
    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode(`data: ${chunk(id, { role: "assistant", content: "" })}\n\n`));
        for (const word of words) {
          controller.enqueue(encoder.encode(`data: ${chunk(id, { content: word })}\n\n`));
          await Bun.sleep(35);
        }
        controller.enqueue(encoder.encode(`data: ${chunk(id, {}, "stop")}\n\n`));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        ...corsHeaders,
        "cache-control": "no-cache",
        connection: "keep-alive",
        "content-type": "text/event-stream",
      },
    });
  },
});

console.log(`Keating capture provider listening on http://127.0.0.1:${server.port}`);
