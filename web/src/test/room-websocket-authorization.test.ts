import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

let directory: string;
let fixture: string;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "keating-room-ws-auth-"));
  const entry = join(directory, "fixture.ts");
  const local = (path: string) => JSON.stringify(fileURLToPath(new URL(path, import.meta.url)));
  const dependency = (name: string) => JSON.stringify(fileURLToPath(name === "ws"
    ? new URL("wrapper.mjs", import.meta.resolve("ws/package.json"))
    : import.meta.resolve(name)));
  // Compile the real route and installed Node adapter: running Bun's adapter or
  // invoking hooks directly would miss Nitro's rejected-factory -> 101 regression.
  await writeFile(entry, `
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { H3 } from ${dependency("h3/node")};
import { NodeRequest } from ${dependency("srvx/node")};
import nodeAdapter from ${dependency("crossws/adapters/node")};
import { getWebSocketHooks } from ${dependency("crossws")};
import WebSocket from ${dependency("ws")};
import { createStorage } from ${dependency("unstorage")};
import memoryDriver from ${dependency("unstorage/drivers/memory")};
import roomSocket from ${local("../../server/api/rooms/realtime.ts")};
import { localCourseAccountIdFromSecret } from ${local("../../server/utils/course-session.ts")};
import { applyStoredRoomOperation, createRoom, createRoomInvite, joinRoomWithInvite, withRoomRepositoryStorage } from ${local("../../server/utils/room-repository.ts")};
import { MemoryPublicAbuseStore, reservePublicQuota, setPublicAbuseStoreForTests } from ${local("../../server/utils/public-abuse.ts")};
import { NOTORGANIC_SESSION_ADAPTER_CONTEXT_KEY } from ${local("../notorganic-provider/server.ts")};

const scenario = process.argv[2];
process.env.NODE_ENV = "production";
process.env.NOTORGANIC_ENABLED = "0";
delete process.env.KEATING_COURSES_DEV_ACCOUNT_ID;
setPublicAbuseStoreForTests(new MemoryPublicAbuseStore());
const store = createStorage({ driver: memoryDriver() });
const hostSecret = "1".repeat(32), learnerSecret = "2".repeat(32), outsiderSecret = "3".repeat(32);
const hostId = await localCourseAccountIdFromSecret(hostSecret);
const learnerId = await localCourseAccountIdFromSecret(learnerSecret);
let operationCount = 0;
let upgradeErrors = [];

function connect(url, headers) {
  const ws = new WebSocket(url, { headers, handshakeTimeout: 2000 });
  const state = { ws, frames: [], status: undefined, headers: undefined, body: "", closed: undefined };
  ws.on("upgrade", response => { state.status = response.statusCode; state.headers = response.headers; });
  ws.on("unexpected-response", (_request, response) => {
    state.status = response.statusCode; state.headers = response.headers;
    response.on("data", chunk => { state.body += chunk.toString(); });
    response.on("end", () => ws.terminate());
  });
  ws.on("message", data => { const raw = data.toString(); try { state.frames.push(JSON.parse(raw)); } catch { state.frames.push(raw); } });
  ws.on("close", (code, reason) => { state.closed = { code, reason: reason.toString() }; });
  ws.on("error", () => {});
  return state;
}
async function until(state, predicate) {
  const deadline = Date.now() + 2500;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Socket condition timed out: " + JSON.stringify({ scenario, status: state.status, frames: state.frames, closed: state.closed }));
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

await withRoomRepositoryStorage(store, async () => {
  const room = (await createRoom(hostId, "Host", { title: "Node adapter authorization" })).room;
  const invite = await createRoomInvite(room.id, hostId, "learner", 1, 2);
  await joinRoomWithInvite(invite.token, learnerId, "Learner");
  const operation = input => applyStoredRoomOperation(hostId, { id: "op_auth_" + (++operationCount), roomId: room.id, ...input });
  await operation({ type: "whisper.post", messageId: "msg_secret", body: "TEACHER_ONLY_BODY" });
  const app = new H3({ silent: true });
  if (scenario === "hosted" || scenario === "unavailable" || scenario === "unexpected") process.env.NOTORGANIC_ENABLED = "1";
  if (scenario === "hosted" || scenario === "unexpected") app.use((event, next) => {
    event.context[NOTORGANIC_SESSION_ADAPTER_CONTEXT_KEY] = {
      async getProductSession(event) {
        if (scenario === "unexpected") throw new Error("SECRET_AUTH_INTERNAL_DETAIL");
        event.res.headers.append("set-cookie", "validated_session=refreshed; HttpOnly; Path=/");
        return { accountId: learnerId, accessToken: "test-only", async createDpopProof() { throw new Error("No external calls permitted"); } };
      },
    };
    return next();
  });
  app.all("/api/rooms/realtime", roomSocket);
  // Match installed Nitro resolveWebsocketHooks exactly: HTTP error responses
  // supply no hooks. Do not turn a resolver error into a synthetic upgrade hook.
  const adapter = nodeAdapter({
    idleTimeout: 0,
    resolve: async request => {
      const response = await app.fetch(request);
      const hooks = response.crossws ?? getWebSocketHooks(request) ?? {};
      // Socket events run outside the listener's AsyncLocalStorage scope. Supply
      // the real repository's memory-store seam to each unmodified route hook.
      return Object.fromEntries(Object.entries(hooks).map(([name, hook]) => [name,
        typeof hook === "function" ? (...args) => withRoomRepositoryStorage(store, async () => hook(...args)) : hook,
      ]));
    },
  });
  const server = createServer((_request, response) => { response.writeHead(404); response.end(); });
  server.on("upgrade", (request, socket, head) => {
    // Carry the production repository scope through Node's independent event callback.
    withRoomRepositoryStorage(store, () => adapter.handleUpgrade(request, socket, head, new NodeRequest({ req: request, upgrade: { socket, head } }))).catch(error => { upgradeErrors.push(String(error)); socket.destroy(); });
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  const origin = "http://127.0.0.1:" + server.address().port;
  let roomId = room.id;
  if (scenario === "malformed") roomId = "!bad-room";
  const headers = { origin, cookie: "keating_course_account=" + (scenario === "outsider" ? outsiderSecret : learnerSecret) };
  if (scenario === "origin") headers.origin = "https://foreign.invalid";
  // Query claims and a host cookie cannot replace an adapter-validated identity.
  if (scenario === "hosted") headers.cookie = "keating_course_account=" + hostSecret;
  if (scenario === "limited") await reservePublicQuota({ bucket: "room-socket", key: learnerId, amount: 120, limit: 120, windowSeconds: 60 });
  const state = connect(origin.replace("http:", "ws:") + "/api/rooms/realtime?roomId=" + encodeURIComponent(roomId) + "&accountId=" + hostId, headers);
  try {
    const expectedStatus = { outsider: 404, malformed: 400, origin: 403, unavailable: 503, unexpected: 500, limited: 429 }[scenario];
    if (expectedStatus) {
      await until(state, () => state.status !== undefined);
      assert.equal(state.status, expectedStatus, "rejected authorization must retain its HTTP status before upgrade");
      assert.deepEqual(state.frames, [], "rejected handshakes must not receive any room frames");
      if (scenario === "limited") assert.match(state.headers["retry-after"], /^[1-9][0-9]*$/);
      await until(state, () => Boolean(state.closed));
      assert.ok(!state.body.includes("SECRET_AUTH_INTERNAL_DETAIL"));
      assert.ok(!state.body.includes("Not Organic hosted access requires"));
      assert.ok(!state.body.includes('"stack"'));
    } else {
      await until(state, () => state.frames.some(frame => frame.type === "snapshot"));
      assert.equal(state.status, 101);
      const snapshot = state.frames.find(frame => frame.type === "snapshot").snapshot;
      assert.equal(snapshot.viewer.accountId, learnerId);
      assert.equal(snapshot.viewer.role, "learner");
      assert.ok(!JSON.stringify(state.frames).includes("TEACHER_ONLY_BODY"));
      if (scenario === "hosted") assert.ok(state.headers["set-cookie"].some(cookie => cookie.includes("validated_session=refreshed")), "authorization refresh cookie must reach the successful handshake");
      if (scenario === "removed") {
        // Deliberately omit broadcast: the message hook must independently recheck
        // current membership rather than trusting its successful upgrade snapshot.
        await operation({ type: "member.remove", accountId: learnerId });
        state.ws.send("ping");
        await until(state, () => Boolean(state.closed));
        assert.equal(state.closed.code, 4403);
        assert.ok(state.frames.some(frame => frame.type === "removed"));
        assert.ok(!state.frames.includes("pong"));
      } else {
        state.ws.send("ping"); await until(state, () => state.frames.includes("pong"));
      }
    }
    assert.deepEqual(upgradeErrors, []);
    console.log(JSON.stringify({ scenario, status: state.status, frames: state.frames.length, close: state.closed }));
  } finally {
    state.ws.terminate(); adapter.closeAll(1000, "test finished", true); await adapter.close();
    await new Promise(resolve => server.close(resolve));
  }
});
`);
  const build = await Bun.build({ entrypoints: [entry], outdir: directory, target: "node", external: ["nitro/storage"] });
  if (!build.success) throw new AggregateError(build.logs, "Could not compile real Node WebSocket regression fixture");
  fixture = join(directory, "fixture.js");
}, 20_000);

afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe("room WebSocket authorization through the real Node adapter", () => {
  test.each([
    ["outsider", "outsider gets HTTP 404 without an idle 101 connection"],
    ["malformed", "malformed room ID gets HTTP 400"],
    ["origin", "cross-origin handshake gets HTTP 403"],
    ["unavailable", "unavailable hosted authorization gets HTTP 503"],
    ["unexpected", "unexpected authorization failure rejects with HTTP 500"],
    ["limited", "socket quota rejects with HTTP 429 and Retry-After"],
    ["member", "local cookie identity receives only its projected snapshot and ping"],
    ["hosted", "validated hosted identity takes precedence and preserves refresh headers"],
    ["removed", "member removed after upgrade is rechecked before a message"],
  ])("%s: %s", async (scenario) => {
    const child = Bun.spawn(["node", fixture, scenario], { stdout: "pipe", stderr: "pipe", env: { ...process.env, NODE_ENV: "production", NOTORGANIC_ENABLED: "0" } });
    const timeout = setTimeout(() => child.kill(), 8_000);
    try {
      const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
      expect({ exitCode, stderr }, stdout).toEqual({ exitCode: 0, stderr: "" });
      expect(JSON.parse(stdout.trim()).scenario).toBe(scenario);
    } finally {
      clearTimeout(timeout);
      child.kill();
    }
  }, 10_000);
});
