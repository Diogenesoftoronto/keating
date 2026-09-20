import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import type { ClientRequest, IncomingMessage } from "node:http";
import { createGptLiveRelay, GPT_LIVE_BUFFER_BYTES, GPT_LIVE_FRAME_BYTES, gptLiveServerConfig, safeGptLiveUpgradeError,
  validateGptLiveOrigin, type GptLiveUpstream, type GptLiveUpstreamOptions } from "../server/utils/gpt-live-relay";

const config = { enabled: true, gatewayBaseUrl: "https://provider.test", maxCostMicrousd: 50000 };
const proof = (url = "https://provider.test/v1/live/sessions", method = "GET") => `${Buffer.from(JSON.stringify({ typ: "dpop+jwt", alg: "ES256" })).toString("base64url")}.${Buffer.from(JSON.stringify({ htu: url, htm: method })).toString("base64url")}.signature`;
const auth = () => ({ type: "keating.live.connect", authorization: "DPoP test-account-token", dpop: proof(), idempotencyKey: "connection-test-1", maxCostMicrousd: 100000 });
class Socket extends EventEmitter implements GptLiveUpstream {
  readyState = 0; bufferedAmount = 0; sent: string[] = []; closed = false; terminated = false;
  send(text: string, callback?: (error?: Error) => void) { this.sent.push(text); callback?.(); }
  close() { this.closed = true; this.readyState = 3; this.emit("close", 1000); }
  terminate() { this.terminated = true; this.readyState = 3; this.emit("close", 1006); }
  open() { this.readyState = 1; this.emit("open"); }
}
function fixture(handshakeMs = 1000) {
  const socket = new Socket(), output: string[] = [], closes: number[] = [], connections: Array<{ url: string; options: GptLiveUpstreamOptions }> = [];
  let buffered = 0;
  const relay = createGptLiveRelay({ send: text => { output.push(text); }, close: code => { closes.push(code); }, bufferedAmount: () => buffered }, {
    requestUrl: "https://keating.test/api/live", origin: "https://keating.test", config, handshakeMs,
    connect(url, options) { connections.push({ url, options }); return socket; },
  });
  return { socket, output, closes, connections, relay, buffered: (value: number) => { buffered = value; },
    authenticate() { relay.message(JSON.stringify(auth())); }, lastError: () => JSON.parse(output.at(-1) ?? "{}").code };
}

test("exact same-origin checks admit desktop loopback and reject queries, null origins and cross-site upgrades", () => {
  expect(() => validateGptLiveOrigin("https://keating.test/api/live", "https://keating.test")).not.toThrow();
  expect(() => validateGptLiveOrigin("http://127.0.0.1:41231/api/live", "http://127.0.0.1:41231")).not.toThrow();
  expect(() => validateGptLiveOrigin("http://[::1]:41231/api/live", "http://[::1]:41231")).not.toThrow();
  for (const [url, origin] of [
    ["https://keating.test/api/live", "https://evil.test"], ["https://keating.test/api/live", "null"],
    ["https://keating.test/api/live?token=forbidden", "https://keating.test"], ["http://keating.test/api/live", "http://keating.test"],
    ["http://127.0.0.1:41231/api/live", "http://127.0.0.1:41232"], ["https://keating.test/api/live", "https://keating.test/"],
  ]) expect(() => validateGptLiveOrigin(url!, origin)).toThrow();
});

test("relay sends only fixed gateway authentication headers and caps spending before ready", () => {
  const f = fixture();
  try {
    f.authenticate(); expect(f.output).toEqual([]); expect(f.connections).toHaveLength(1);
    expect(f.connections[0]!.url).toBe("wss://provider.test/v1/live/sessions");
    expect(f.connections[0]!.options).toEqual({ headers: { Authorization: auth().authorization, DPoP: auth().dpop,
      "Idempotency-Key": auth().idempotencyKey, "x-notorganic-max-cost-microusd": "50000" },
      handshakeTimeout: 1000, maxPayload: GPT_LIVE_FRAME_BYTES, perMessageDeflate: false, followRedirects: false });
    f.socket.open(); expect(JSON.parse(f.output[0]!)).toEqual({ type: "keating.live.ready", maxCostMicrousd: 50000 });
    const clientEvent = JSON.stringify({ type: "session.start", session: { instructions: "Follow the lesson." } });
    f.relay.message(clientEvent); expect(f.socket.sent).toEqual([clientEvent]);
    const upstreamEvent = JSON.stringify({ type: "session.started" }); f.socket.emit("message", Buffer.from(upstreamEvent), false);
    expect(f.output.at(-1)).toBe(upstreamEvent); expect(f.socket.sent.join("")).not.toContain(auth().authorization);
  } finally { f.relay.close(); }
});

test("bad credentials, wrong proof destination, nonpositive budget and extra routing fields never open upstream", () => {
  const invalid = [
    { ...auth(), dpop: proof("https://evil.test/v1/live/sessions") }, { ...auth(), dpop: proof(undefined, "POST") },
    { ...auth(), authorization: "DPoP token\r\nInjected: header" }, { ...auth(), maxCostMicrousd: 0 },
    { ...auth(), maxCostMicrousd: 1.5 }, { ...auth(), endpoint: "wss://evil.test" }, { ...auth(), dpop: "x".repeat(16385) },
    { type: "session.start" },
  ];
  for (const input of invalid) {
    const f = fixture(); try { f.relay.message(JSON.stringify(input)); expect(f.connections).toHaveLength(0); expect(f.closes).toHaveLength(1); }
    finally { f.relay.close(); }
  }
});

test("duplicate authentication and events before upstream readiness close the upstream attempt", () => {
  for (const input of [auth(), { type: "session.input_audio.append", audio: "AA==" }]) {
    const f = fixture(); f.authenticate(); f.relay.message(JSON.stringify(input));
    expect(f.connections).toHaveLength(1); expect(f.socket.terminated).toBe(true); expect(f.socket.sent).toEqual([]); expect(f.closes).toHaveLength(1);
  }
  const f = fixture(); f.authenticate(); f.socket.open(); f.relay.message(JSON.stringify(auth()));
  expect(f.socket.closed).toBe(true); expect(f.lastError()).toBe("live_event_invalid");
});

test("frame limits, binary rejection and both send-buffer limits fail closed", () => {
  for (const message of [Buffer.from("binary"), " ".repeat(GPT_LIVE_FRAME_BYTES + 1)]) {
    const f = fixture(); f.relay.message(message); expect(f.connections).toHaveLength(0); expect(f.closes).toHaveLength(1);
  }
  const upstream = fixture(); upstream.authenticate(); upstream.socket.open(); upstream.socket.bufferedAmount = GPT_LIVE_BUFFER_BYTES;
  upstream.relay.message(JSON.stringify({ type: "session.close" })); expect(upstream.lastError()).toBe("live_backpressure"); expect(upstream.socket.sent).toEqual([]);
  const client = fixture(); client.authenticate(); client.socket.open(); client.buffered(GPT_LIVE_BUFFER_BYTES);
  client.socket.emit("message", Buffer.from('{"type":"session.started"}'), false); expect(client.closes).toEqual([1013]); expect(client.output).toHaveLength(1);
  const binary = fixture(); binary.authenticate(); binary.socket.open(); binary.socket.emit("message", Buffer.from("binary"), true);
  expect(binary.closes).toEqual([1003]);
});

test("client disconnect terminates connecting sockets, closes open sockets and ignores late events", () => {
  const connecting = fixture(); connecting.authenticate(); connecting.relay.close(); expect(connecting.socket.terminated).toBe(true);
  connecting.socket.open(); expect(connecting.output).toEqual([]); expect(connecting.socket.closed).toBe(true);
  const opened = fixture(); opened.authenticate(); opened.socket.open(); opened.relay.close();
  expect(opened.socket.closed).toBe(true); expect(opened.closes).toEqual([]);
  opened.socket.emit("message", "must not send", false); opened.socket.emit("error", Error("secret")); expect(opened.output).toHaveLength(1);
});

test("initial and upstream handshakes have bounded deadlines", async () => {
  const initial = fixture(2), upstream = fixture(2); upstream.authenticate();
  await Bun.sleep(12);
  expect(initial.lastError()).toBe("live_handshake_timeout"); expect(initial.connections).toHaveLength(0);
  expect(upstream.lastError()).toBe("live_handshake_timeout"); expect(upstream.socket.terminated).toBe(true);
});

test("failed upgrades retain actionable safe codes without copying messages, URLs or credentials", async () => {
  for (const [code, status, phrase] of [
    ["realtime_consent_required", 403, "consent"], ["insufficient_funds", 402, "wallet"], ["live_unavailable", 503, "configured"],
    ["insufficient_scope", 403, "realtime:connect"], ["live_budget_too_small", 400, "31 seconds"],
  ] as const) {
    const f = fixture(); f.authenticate();
    const response = new PassThrough() as PassThrough & { statusCode: number }; response.statusCode = status;
    let destroyed = false;
    f.socket.emit("unexpected-response", { destroy() { destroyed = true; } } as unknown as ClientRequest, response as unknown as IncomingMessage);
    response.end(JSON.stringify({ error: { code, message: `SECRET ${auth().authorization} https://secret.test` } }));
    await Bun.sleep(0);
    const event = JSON.parse(f.output.at(-1)!); expect(event).toMatchObject({ type: "keating.live.error", code, status });
    expect(event.message).toContain(phrase); expect(f.output.join("")).not.toContain("SECRET"); expect(destroyed).toBe(true);
  }
  expect(safeGptLiveUpgradeError(401, '{"error":{"message":"secret"}}').message).toContain("Reconnect");
  expect(safeGptLiveUpgradeError(503, "<html>secret</html>").message).not.toContain("secret");
  expect(() => gptLiveServerConfig({ NOTORGANIC_ENABLED: "false" })).toThrow("Live is not configured");
});

test("oversized upstream frames and rejection bodies close without forwarding their contents", async () => {
  const frame = fixture(); frame.authenticate(); frame.socket.open(); frame.socket.emit("message", "S".repeat(GPT_LIVE_FRAME_BYTES + 1), false);
  expect(frame.closes).toEqual([1009]); expect(frame.output.join("").length).toBeLessThan(1000);
  const rejection = fixture(); rejection.authenticate();
  const response = new PassThrough() as PassThrough & { statusCode: number }; response.statusCode = 503;
  let destroyed = false;
  rejection.socket.emit("unexpected-response", { destroy() { destroyed = true; } }, response);
  response.write("SECRET".repeat(2000)); await Bun.sleep(0);
  expect(destroyed).toBe(true); expect(rejection.closes).toHaveLength(1); expect(rejection.output.join("")).not.toContain("SECRET");
});

test("actual H3/CrossWS Node sockets preserve text auth, bufferedAmount, forwarding and binary rejection", async () => {
  // Run Node's real adapter in Node: CrossWS intentionally rejects that adapter under Bun.
  const directory = await mkdtemp(join(tmpdir(), "keating-live-socket-"));
  const webRoot = resolve(import.meta.dir, "..");
  const require = createRequire(join(webRoot, "package.json"));
  try {
    const built = await Bun.build({ entrypoints: [join(webRoot, "server/api/live.ts")], target: "node", format: "esm", outdir: directory, naming: "route.mjs" });
    expect(built.success).toBe(true);
    const script = `
      import assert from 'node:assert/strict';
      import { createServer } from 'node:http';
      import { once } from 'node:events';
      import { writeSync } from 'node:fs';
      import { createRequire } from 'node:module';
      import nodeAdapter from ${JSON.stringify(pathToFileURL(require.resolve("crossws/adapters/node")).href)};
      import { createGptLiveHandler } from './route.mjs';
      const { WebSocket, WebSocketServer } = createRequire(${JSON.stringify(join(webRoot, "package.json"))})('ws');
      const timeout = setTimeout(() => { writeSync(2, 'Local Live socket test timed out'); process.exit(1); }, 8000);
      const auth = ${JSON.stringify(auth())};
      const observation = { connections: 0, textFrames: 0, binaryFrames: 0, bufferedAmount: false };
      const upstreamServer = createServer();
      const upstream = new WebSocketServer({ server: upstreamServer });
      upstream.on('connection', (socket, request) => {
        observation.connections++;
        assert.equal(request.url, '/v1/live/sessions');
        assert.equal(request.headers.authorization, auth.authorization);
        assert.equal(request.headers.dpop, auth.dpop);
        assert.equal(request.headers['x-notorganic-max-cost-microusd'], '50000');
        socket.on('message', (data, binary) => {
          assert.equal(binary, false);
          assert.equal(JSON.parse(data.toString()).type, 'session.start');
          socket.send(JSON.stringify({ type: 'session.started' }));
        });
      });
      upstreamServer.listen(0, '127.0.0.1'); await once(upstreamServer, 'listening');
      const route = createGptLiveHandler({
        env: { NOTORGANIC_ENABLED: 'true', NOTORGANIC_ISSUER: 'https://provider.test', NOTORGANIC_MAX_COST_MICROUSD: '50000' },
        connect(url, options) {
          assert.equal(url, 'wss://provider.test/v1/live/sessions');
          return new WebSocket('ws://127.0.0.1:' + upstreamServer.address().port + '/v1/live/sessions', options);
        }
      });
      const hooks = new WeakMap();
      const adapter = nodeAdapter({ resolve(request) {
        if (!hooks.has(request)) hooks.set(request, Promise.resolve(route.fetch(request)).then(response => {
          assert.equal(response.status, 426);
          const original = response.crossws;
          assert.ok(original);
          return { ...original,
            open(peer) { observation.bufferedAmount = typeof peer.websocket.bufferedAmount === 'number'; return original.open(peer); },
            message(peer, message) {
              if (typeof message.rawData === 'string') observation.textFrames++;
              else observation.binaryFrames++;
              return original.message(peer, message);
            }
          };
        }));
        return hooks.get(request);
      } });
      const server = createServer();
      server.on('upgrade', (request, socket, head) => adapter.handleUpgrade(request, socket, head).catch(error => { writeSync(2, String(error)); socket.destroy(); }));
      server.listen(0, '127.0.0.1'); await once(server, 'listening');
      const origin = 'http://127.0.0.1:' + server.address().port;
      const open = async () => { const socket = new WebSocket(origin.replace('http:', 'ws:') + '/api/live', { origin }); await once(socket, 'open'); return socket; };
      const text = await open();
      let response = once(text, 'message'); text.send(JSON.stringify(auth));
      assert.deepEqual(JSON.parse((await response)[0].toString()), { type: 'keating.live.ready', maxCostMicrousd: 50000 });
      response = once(text, 'message'); text.send(JSON.stringify({ type: 'session.start' }));
      assert.equal(JSON.parse((await response)[0].toString()).type, 'session.started');
      const disconnected = once(text, 'close'); text.close(); await disconnected;
      const binary = await open();
      response = once(binary, 'message'); const rejected = once(binary, 'close');
      binary.send(Buffer.from(JSON.stringify(auth)), { binary: true });
      assert.equal(JSON.parse((await response)[0].toString()).code, 'live_text_required');
      assert.equal((await rejected)[0], 1003);
      assert.deepEqual(observation, { connections: 1, textFrames: 2, binaryFrames: 1, bufferedAmount: true });
      adapter.closeAll(1000, 'Test complete', true);
      for (const socket of upstream.clients) socket.terminate();
      await new Promise(resolve => upstream.close(resolve));
      await new Promise(resolve => upstreamServer.close(resolve));
      await new Promise(resolve => server.close(resolve));
      clearTimeout(timeout);
      writeSync(1, JSON.stringify(observation));
    `;
    const scriptPath = join(directory, "socket-test.mjs");
    await writeFile(scriptPath, script);
    const result = spawnSync("node", [scriptPath], { encoding: "utf8", timeout: 12000,
      env: { ...process.env, NODE_PATH: join(webRoot, "node_modules") } });
    expect({ status: result.status, stderr: result.stderr, error: result.error?.message }).toEqual({ status: 0, stderr: "", error: undefined });
    expect(JSON.parse(result.stdout)).toEqual({ connections: 1, textFrames: 2, binaryFrames: 1, bufferedAmount: true });
  } finally { await rm(directory, { recursive: true, force: true }); }
}, 20000);
