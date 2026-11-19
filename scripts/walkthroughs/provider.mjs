// OpenAI-compatible SSE adapted from scripts/tui-demo-provider.mjs.
const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "*",
  "access-control-allow-private-network": "true",
};

function messageText(message) {
  if (typeof message?.content === "string") return message.content;
  return (message?.content ?? []).map(part => part.text ?? "").join(" ");
}

export function startProvider(transcript, log) {
  const turns = transcript.turns.map(turn => ({ ...turn, remaining: turn.times ?? Infinity }));
  const model = "local-tutor";
  let sequence = 0;
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname.replace(/^\/v1/, "");
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
      if (request.method === "GET" && path === "/models") {
        return Response.json({ object: "list", data: [{ id: model, object: "model", owned_by: "keating-demo" }] }, { headers: cors });
      }
      if (request.method !== "POST" || path !== "/chat/completions") {
        return new Response("Unknown demo route", { status: 404, headers: cors });
      }
      const body = await request.json();
      const latest = messageText(body.messages?.findLast(message => message.role === "user"));
      const categorized = transcript.topicCategory && (body.messages ?? []).some(message =>
        message.role !== "user" && messageText(message).includes("You classify learning topics into a fixed set of categories."));
      const auxiliary = categorized || body.stream === false || (body.messages ?? []).some(message =>
        /rename learning chat sessions|generate (a )?(short |concise )?(session |conversation )?title|title generator/i.test(messageText(message)) && message.role !== "user");
      const turn = categorized
        ? { reply: JSON.stringify({ category: transcript.topicCategory }), match: "(category)" }
        : auxiliary && transcript.auxiliaryReply
        ? { reply: transcript.auxiliaryReply, match: "(auxiliary)" }
        : turns.find(candidate => candidate.remaining > 0 && latest.toLowerCase().includes(candidate.match.toLowerCase()));
      log(`Provider ${turn?.match ?? "(unmatched)"}: ${turn?.error ?? (turn ? "200" : "422")}`);
      if (!turn || turn.error) {
        if (turn) turn.remaining--;
        return Response.json({ error: { message: turn?.message ?? (turn ? "The local walkthrough provider paused this reply." : "No scripted reply matches this turn.") } },
          { status: turn?.error ?? 422, headers: cors });
      }
      if (!auxiliary) turn.remaining--;
      const id = `chatcmpl-walkthrough-${++sequence}`;
      const envelope = { id, created: Math.floor(Date.now() / 1000), model };
      if (body.stream === false) {
        return Response.json({
          ...envelope, object: "chat.completion",
          choices: [{ index: 0, message: { role: "assistant", content: turn.reply }, finish_reason: "stop" }],
        }, { headers: cors });
      }
      const encode = new TextEncoder();
      const pieces = [
        { role: "assistant", content: "" },
        ...(turn.thinking ? [{ reasoning_content: turn.thinking }] : []),
        ...(turn.reply.match(/\S+\s*|\s+/gu) ?? []).map(content => ({ content })),
        {},
      ];
      const stream = new ReadableStream({
        async pull(controller) {
          const delta = pieces.shift();
          if (!delta) {
            controller.enqueue(encode.encode("data: [DONE]\n\n"));
            controller.close();
            return;
          }
          const finish_reason = pieces.length ? null : "stop";
          const packet = { ...envelope, object: "chat.completion.chunk", choices: [{ index: 0, delta, finish_reason }] };
          controller.enqueue(encode.encode(`data: ${JSON.stringify(packet)}\n\n`));
          if (delta.reasoning_content || delta.content) await Bun.sleep(delta.reasoning_content ? 850 : (turn.delayMs ?? 34));
        },
      });
      return new Response(stream, { headers: { ...cors, "content-type": "text/event-stream", "cache-control": "no-cache" } });
    },
  });
  return server;
}
