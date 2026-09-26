import { describe, expect, test } from "bun:test";
import { spawn } from "bun";
import { frameTimeline, isLoopback, until } from "../scripts/capture-web-clips.mjs";
import { IDBFactory } from "../web/node_modules/fake-indexeddb/build/esm/index.js";
import clips from "../scripts/web-clips.json";

describe("web clip recorder", () => {
  test("both chat clips seed only the disposable demo credential", async () => {
    for (const name of ["web-classroom", "web-tutorial"]) {
      const clip = clips.find((clip) => clip.name === name);
      expect(clip.provider).toBe("demo");
      expect(clip.steps[0]).toEqual({ kind: "goto", path: "/chat" });
      const indexedDB = new IDBFactory();
      const settings = new Map();
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      await new AsyncFunction("indexedDB", "localStorage", "providerUrl", clip.seed)(
        indexedDB, { setItem: (key, value) => settings.set(key, value) }, "http://127.0.0.1:12345",
      );
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open("keating", 2);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const read = (store, method, key) => new Promise((resolve, reject) => {
          const request = db.transaction(store).objectStore(store)[method](key);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        expect(await read("provider-keys", "getAllKeys")).toEqual(["Keating Demo"]);
        expect(await read("provider-keys", "get", "Keating Demo")).toBe("local-demo-no-secret");
        expect((await read("custom-providers", "get", "web-clip-demo")).baseUrl).toBe("http://127.0.0.1:12345/v1");
      } finally { db.close(); }
    }
    expect(clips.find((clip) => clip.name === "web-tutorial").steps.filter((step) => step.kind === "type").map((step) => step.text)).toEqual([
      "Explain why this stopping rule fails when the input is negative.",
      "It never reaches zero, so it loops forever?",
    ]);
  });

  test("uses real variable frame timing and holds the last frame one second", () => {
    const timeline = frameTimeline([
      { file: "frame_00000.jpg", timestamp: 100 },
      { file: "frame_00001.jpg", timestamp: 100.05 },
      { file: "frame_00002.jpg", timestamp: 101.4 },
    ]);
    expect(timeline.duration).toBeCloseTo(2.4);
    expect(timeline.concat).toContain("duration 0.050000");
    expect(timeline.concat).toContain("duration 1.350000");
    expect(timeline.concat).toContain("duration 1.000000");
    expect(timeline.concat.match(/file 'frame_00002.jpg'/g)).toHaveLength(2);
    expect(() => frameTimeline([])).toThrow("no screencast frames");
    expect(() => frameTimeline([{ file: "frame_00000.jpg", timestamp: NaN }])).toThrow("timestamp");
  });

  test("does not allow remote hosts, credentials, or misleading loopback names", () => {
    for (const url of ["http://localhost:3000/", "http://127.0.0.1:1234/v1", "http://[::1]:3000/"]) expect(isLoopback(url)).toBe(true);
    for (const url of ["https://example.com", "https://localhost.example.com", "http://localhost@evil.com", "http://a:b@localhost", "file:///tmp/a"]) expect(isLoopback(url)).toBe(false);
  });

  test("failed waits name the condition and timeout", async () => {
    await expect(until(() => false, 1, "waitFor #missing")).rejects.toThrow("Timed out after 1 ms: waitFor #missing");
    await until(() => true, 100, "ready");
  });

  test("demo provider preserves existing replies and streams the cities turn with CORS", async () => {
    const child = spawn(["bun", new URL("../scripts/tui-demo-provider.mjs", import.meta.url).pathname, "0"], { stdout: "pipe", stderr: "inherit" });
    try {
      const { value } = await child.stdout.getReader().read();
      const base = new TextDecoder().decode(value).match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
      expect(base).toBeTruthy();
      expect(base.endsWith(":0")).toBe(false);
      const preflight = await fetch(`${base}/v1/chat/completions`, { method: "OPTIONS" });
      expect(preflight.status).toBe(204);
      expect(preflight.headers.get("access-control-allow-headers")).toBe("*");
      const models = await (await fetch(`${base}/v1/models`)).json();
      expect(models.data[0].id).toBe("local-tutor");
      const request = (content, stream = false, history = []) => fetch(`${base}/v1/chat/completions`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ stream, messages: [...history, { role: "user", content }] }),
      });
      for (const [prompt, prefix] of [["contradiction", "Proof by contradiction"], ["numerical example", "Take √2."], ["Raft consensus", "In Raft,"]]) {
        const response = await request(prompt);
        expect(response.headers.get("access-control-allow-origin")).toBe("*");
        expect((await response.json()).choices[0].message.content.startsWith(prefix)).toBe(true);
      }
      const answer = (await (await request("Why do cities form where they do?")).json()).choices[0].message.content;
      expect(answer.endsWith("why?")).toBe(true);
      const stream = await (await request("Why do cities form where they do?", true)).text();
      expect(stream).toContain("data: [DONE]");
      const reconstructed = stream.split("\n").filter((line) => line.startsWith("data: {")).map((line) => JSON.parse(line.slice(6)).choices[0].delta.content ?? "").join("");
      expect(reconstructed).toBe(answer);
      const tutorial = clips.find((clip) => clip.name === "web-tutorial");
      const turns = tutorial.steps.filter((step) => step.kind === "type");
      const history = [];
      for (const [index, turn] of turns.entries()) {
        // Exercise both string and multipart user messages with real prior turns.
        const content = index ? [{ type: "text", text: turn.text }] : turn.text;
        const reply = (await (await request(content, false, history)).json()).choices[0].message.content;
        expect(reply.endsWith(index ? "Can you restate the fix in your own words?" : "What do you predict happens for n = -3?")).toBe(true);
        expect(reply.startsWith(index ? "Yes." : "Hint:")).toBe(true);
        const sse = await (await request(content, true, history)).text();
        expect(sse).toContain("data: [DONE]");
        expect(sse.split("\n").filter((line) => line.startsWith("data: {")).map((line) => JSON.parse(line.slice(6)).choices[0].delta.content ?? "").join("")).toBe(reply);
        history.push({ role: "user", content }, { role: "assistant", content: reply });
      }
    } finally {
      child.kill();
      await child.exited;
    }
  }, 15000);
});
