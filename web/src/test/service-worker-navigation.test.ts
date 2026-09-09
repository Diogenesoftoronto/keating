import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const workerSource = readFileSync(new URL("../../node_modules/@scelar/nodepod/dist/__sw__.js", import.meta.url), "utf8");

function worker() {
  const listeners = new Map<string, ((event: any) => void)[]>();
  const self = {
    location: new URL("https://keating.test/sw.js"),
    addEventListener(type: string, listener: (event: any) => void) {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    skipWaiting() {},
    clients: { claim: async () => {}, matchAll: async () => [] },
  };
  runInNewContext(workerSource, { self, URL, Response, Request, Headers, console, setTimeout, clearTimeout });
  return listeners;
}

describe("shared service worker navigation", () => {
  it.each(["/chat", "/notorganic/callback?code=fixture&state=fixture", "/oauth/callback?code=fixture&state=fixture"])("leaves host navigation %s to the host handler", path => {
    const listeners = worker();
    let intercepted = false;
    for (const handler of listeners.get("fetch") ?? []) handler({
      request: { url: `https://keating.test${path}`, mode: "navigate", destination: "document", referrer: "https://keating.test/chat" },
      clientId: "host-tab", resultingClientId: "host-result",
      respondWith() { intercepted = true; },
    });
    expect(intercepted).toBe(false);
  });

  it("reserves virtual preview navigation for NodePod", async () => {
    const listeners = worker();
    let response: Promise<Response> | undefined;
    for (const handler of listeners.get("fetch") ?? []) handler({
      request: new Request("https://keating.test/__preview__/fixture/3000/"),
      clientId: "preview-tab",
      respondWith(value: Promise<Response>) { response = value; },
    });
    expect(response).toBeDefined();
    // A missing virtual server returns a real unavailable response, never the
    // precached Keating shell pretending to be a live preview.
    expect((await response!).status).toBe(503);
  });

  it("does not redirect live tabs through the legacy activation script", () => {
    const events: string[] = [];
    runInNewContext(readFileSync(new URL("../../public/sw-update-reload.js", import.meta.url), "utf8"), {
      self: { addEventListener(type: string) { events.push(type); } },
    });
    expect(events).toEqual([]);
  });
});
