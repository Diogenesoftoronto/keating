#!/usr/bin/env bun

import { serve } from "bun";

const requestedPort = Number.parseInt(process.argv[2] ?? "58173", 10);
const port = Number.isFinite(requestedPort) ? requestedPort : 58173;

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
  return content.toLowerCase().includes("numerical example") ? exampleReply : contradictionReply;
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

serve({
  hostname: "127.0.0.1",
  port,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/health") return new Response("ready\n");
    if (request.method !== "POST" || url.pathname !== "/v1/chat/completions") {
      return Response.json({ error: { message: "Not found" } }, { status: 404 });
    }

    const body = await request.json();
    const text = replyFor(Array.isArray(body.messages) ? body.messages : []);
    const id = `chatcmpl-keating-${Date.now()}`;

    if (body.stream === false) {
      return Response.json({
        id,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: "local-tutor",
        choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
        usage: { prompt_tokens: 24, completion_tokens: 46, total_tokens: 70 },
      });
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
        "cache-control": "no-cache",
        connection: "keep-alive",
        "content-type": "text/event-stream",
      },
    });
  },
});

console.log(`Keating capture provider listening on http://127.0.0.1:${port}`);
