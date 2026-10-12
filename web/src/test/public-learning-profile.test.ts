import { describe, expect, test } from "bun:test";
import { LearningProfilePublisher, learningProfileRecord, readLearningProfile, LEARNING_PROFILE_COLLECTION, LEARNING_PROFILE_SCOPE } from "../keating/public-learning-profile";
import { learningProfileOAuthLocation } from "../keating/learning-profile-oauth";
import metadata from "../../public/learning-profile-client-metadata.json";
import { safeAuthorizationReturnTo } from "../notorganic-provider/public-client";

const DID = "did:plc:abcdefghijklmnopqrstuvwx";
const missing = () => Response.json({ error: "RecordNotFound" }, { status: 400 });
const receipt = () => Response.json({ uri: `at://${DID}/${LEARNING_PROFILE_COLLECTION}/self`, cid: crypto.randomUUID() });
function fixture(handler: (path: string, init?: RequestInit) => Promise<Response> = async (_path, init) => init?.method === "GET" ? missing() : receipt()) {
  const calls: { path: string; init?: RequestInit }[] = [];
  const owner = { did: DID, current: true, isCurrent() { return this.current; } };
  const session = {
    sub: DID,
    getTokenInfo: async () => ({ scope: LEARNING_PROFILE_SCOPE }),
    fetchHandler: async (path: string, init?: RequestInit) => { calls.push({ path, init }); return handler(path, init); },
  };
  return { calls, owner, session, publisher: new LearningProfilePublisher(session, owner) };
}

describe("public learning projection", () => {
  test("publishes only selected labels and explicitly included count", () => {
    const record = learningProfileRecord([" Bayesian reasoning ", "Latin"], 3, new Date("2026-10-11T00:00:00.000Z"));
    expect(record).toEqual({ $type: LEARNING_PROFILE_COLLECTION, schemaVersion: 1, visibility: "public", publicationId: expect.any(String), topics: ["Bayesian reasoning", "Latin"], activity: { savedSessions: 3 }, updatedAt: "2026-10-11T00:00:00.000Z" });
    expect(learningProfileRecord([])).not.toHaveProperty("activity");
    expect(readLearningProfile({ ...record, transcripts: ["private"], answers: "private", activity: { savedSessions: 3, grades: "private" } })).toEqual(record);
  });
  test("rejects raw objects, multi-line/oversized labels, duplicates and invalid counts", () => {
    for (const topics of [[{}], ["one\ntwo"], ["x".repeat(81)], ["Latin", "latin"], Array(21).fill("x"), [""]]) expect(() => learningProfileRecord(topics)).toThrow();
    for (const count of [-1, 1.2, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "5", null]) expect(() => learningProfileRecord([], count)).toThrow();
  });
});

describe("PDS publication", () => {
  test("requires consent, writes stable self record, strips additional private input", async () => {
    const { publisher, calls } = fixture();
    await expect(publisher.publish({ topics: ["Latin"], consent: false })).rejects.toThrow("Confirm");
    expect(calls).toHaveLength(0);
    await publisher.publish({ topics: ["Latin"], consent: true, savedSessions: 2, rawAnswers: "private" } as never);
    const sent = JSON.parse(calls[1].init?.body as string);
    expect(sent.repo).toBe(DID); expect(sent.collection).toBe(LEARNING_PROFILE_COLLECTION); expect(sent.rkey).toBe("self");
    expect(sent.record.topics).toEqual(["Latin"]); expect(JSON.stringify(sent)).not.toContain("private");
    expect(sent.swapRecord).toBeNull(); expect(calls[1].init?.redirect).toBe("error");
  });
  test("fails closed on account mismatch and changes while refreshing OAuth", async () => {
    const f = fixture(); f.session.sub = "did:plc:other";
    await expect(f.publisher.remove()).rejects.toThrow("accounts do not match");
    f.session.sub = DID; f.session.getTokenInfo = async () => { f.owner.current = false; return { scope: LEARNING_PROFILE_SCOPE }; };
    await expect(f.publisher.publish({ topics: [], consent: true })).rejects.toThrow("accounts do not match");
    expect(f.calls).toHaveLength(0);
  });
  test("requires updated collection grant, does not accept broad legacy grants", async () => {
    const f = fixture(); f.session.getTokenInfo = async () => ({ scope: "atproto transition:generic" });
    await expect(f.publisher.remove()).rejects.toThrow("Reconnect your PDS"); expect(f.calls).toHaveLength(0);
  });
  test("withdraws self with a minimal unique private marker even when absent", async () => {
    const f = fixture();
    expect(await f.publisher.read()).toBeNull();
    await f.publisher.remove();
    expect(f.calls[2].path).toBe("/xrpc/com.atproto.repo.putRecord");
    const sent = JSON.parse(f.calls[2].init?.body as string);
    expect(sent).toMatchObject({ repo: DID, collection: LEARNING_PROFILE_COLLECTION, rkey: "self", swapRecord: null, record: { visibility: "private", publicationId: expect.any(String) } });
    expect(sent.record).not.toHaveProperty("topics"); expect(sent.record).not.toHaveProperty("activity");
    await f.publisher.remove();
    expect(JSON.parse(f.calls[4].init?.body as string).record.publicationId).not.toBe(sent.record.publicationId);
  });
  test("failed removal is visible and remains retryable", async () => {
    let tries = 0;
    const f = fixture(async (_path, init) => init?.method === "GET" ? missing() : ++tries === 1 ? Response.json({ error: "Unavailable" }, { status: 503 }) : receipt());
    await expect(f.publisher.remove()).rejects.toThrow("public status may be unchanged");
    await f.publisher.remove(); expect(tries).toBe(2);
  });
  test("serializes withdrawal behind an in-flight publication so withdrawal wins", async () => {
    let finish!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    const f = fixture(async (_path, init) => { if (init?.method === "GET") return missing(); if (JSON.parse(init?.body as string).record.visibility === "public") await gate; return receipt(); });
    const publish = f.publisher.publish({ topics: ["Latin"], consent: true });
    const remove = f.publisher.remove();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(f.calls).toHaveLength(2); finish(); await Promise.all([publish, remove]);
    expect(f.calls.filter(call => call.init?.method === "POST").map(call => JSON.parse(call.init?.body as string).record.visibility)).toEqual(["public", "private"]);
  });
  test("read errors and malformed records never become a private status", async () => {
    const unavailable = fixture(async () => Response.json({ error: "Unavailable" }, { status: 503 }));
    await expect(unavailable.publisher.read()).rejects.toThrow();
    const malformed = fixture(async () => Response.json({ value: { topics: [] } }));
    await expect(malformed.publisher.read()).rejects.toThrow();
  });
  test("aborted operations do not dispatch", async () => {
    const f = fixture(); const controller = new AbortController(); controller.abort();
    await expect(f.publisher.remove(controller.signal)).rejects.toThrow(); expect(f.calls).toHaveLength(0);
  });
  test("cross-tab withdrawal defeats a delayed initial publication with CAS", async () => {
    let value: Record<string, unknown> | null = null;
    let cid: string | null = null;
    let release!: () => void;
    let dispatch!: () => void;
    let delay = true;
    const delayed = new Promise<void>(resolve => { release = resolve; });
    const dispatched = new Promise<void>(resolve => { dispatch = resolve; });
    const handler = async (_path: string, init?: RequestInit) => {
      if (init?.method === "GET") return value ? Response.json({ uri: `at://${DID}/${LEARNING_PROFILE_COLLECTION}/self`, cid, value }) : missing();
      const input = JSON.parse(init?.body as string);
      if (input.record.visibility === "public" && delay) { delay = false; dispatch(); await delayed; }
      if (input.swapRecord !== cid) return Response.json({ error: "InvalidSwap" }, { status: 400 });
      value = input.record; cid = crypto.randomUUID(); return Response.json({ uri: `at://${DID}/${LEARNING_PROFILE_COLLECTION}/self`, cid });
    };
    const oldTab = fixture(handler), newTab = fixture(handler);
    const stalePublish = oldTab.publisher.publish({ topics: ["Latin"], consent: true });
    await dispatched;
    await newTab.publisher.remove();
    const withdrawn = value;
    release();
    await expect(stalePublish).rejects.toThrow("changed in another tab");
    expect(value).toEqual(withdrawn); expect(await newTab.publisher.read()).toBeNull();
    expect(value).not.toHaveProperty("topics");
    await newTab.publisher.publish({ topics: ["Mathematics"], consent: true });
    expect((await newTab.publisher.read())?.topics).toEqual(["Mathematics"]);
  });
  test("rechecks account after response body awaits", async () => {
    const f = fixture(async () => {
      const response = Response.json({ error: "RecordNotFound" }, { status: 400 });
      response.text = async () => { f.owner.current = false; return JSON.stringify({ error: "RecordNotFound" }); };
      return response;
    });
    await expect(f.publisher.read()).rejects.toThrow("accounts do not match");
  });
  test("malformed GET envelope cannot downgrade CAS to a blind write", async () => {
    for (const reference of [{ uri: `at://${DID}/${LEARNING_PROFILE_COLLECTION}/self` }, { uri: "at://did:plc:other/app.keating.learningProfile/self", cid: "revision" }]) {
      const f = fixture(async () => Response.json({ ...reference, value: learningProfileRecord(["Latin"]) }));
      await expect(f.publisher.remove()).rejects.toThrow("invalid record reference");
      expect(f.calls).toHaveLength(1);
    }
  });
  test("malformed or mismatched PUT acknowledgements never confirm public or private", async () => {
    for (const response of [{}, { uri: `at://${DID}/${LEARNING_PROFILE_COLLECTION}/self` }, { uri: `at://${DID}/${LEARNING_PROFILE_COLLECTION}/self`, cid: " " }, { uri: "at://did:plc:other/app.keating.learningProfile/self", cid: "revision" }]) {
      const f = fixture(async (_path, init) => init?.method === "GET" ? missing() : Response.json(response));
      await expect(f.publisher.publish({ topics: ["Latin"], consent: true })).rejects.toThrow("public status is unknown");
      await expect(f.publisher.remove()).rejects.toThrow("public status is unknown");
    }
  });
});

test("OAuth metadata grants only the profile collection and uses allowed app callback", () => {
  expect(metadata.scope).toBe(LEARNING_PROFILE_SCOPE);
  const hosted = learningProfileOAuthLocation("https://chat.keating.help");
  expect(metadata.redirect_uris).toEqual([hosted.redirectUri]); expect(hosted.clientId).toBe(metadata.client_id);
  expect(safeAuthorizationReturnTo("/review/learning-profile")).toBe("/review/learning-profile");
  const loopback = learningProfileOAuthLocation("http://127.0.0.1:5173");
  expect(new URL(loopback.clientId).searchParams.get("scope")).toBe(LEARNING_PROFILE_SCOPE);
  expect(new URL(loopback.clientId).searchParams.get("redirect_uri")).toBe("http://127.0.0.1:5173/review/learning-profile");
  expect(() => learningProfileOAuthLocation("http://localhost:5173")).toThrow();
  expect(() => learningProfileOAuthLocation("https://evil.example")).toThrow();
});
