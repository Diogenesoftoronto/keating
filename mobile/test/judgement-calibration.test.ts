import { describe, expect, test } from "bun:test";
import { abstained, decided, questionDigest, routeJudgement, thresholdKey, type JudgementQuestion } from "@keating/learner-contracts";
import { MAX_CALIBRATION_BYTES, prepareJudgementCalibrationArtifact, serializeJudgementCalibrationArtifact, type CalibrationInput } from "../../packages/learner-contracts/src/judgement/calibration-artifact";
import { importMobileJudgementCalibration, MobileJudgementCalibrationStore, readMobileCalibrationFile } from "../src/lib/judgement/calibration";
import { configuredMobileJudgementRuntime, createMobileJudgementRuntime } from "../src/lib/judgement/runtime";

const question: JudgementQuestion = { type: "choice", instructions: "Select the supported next activity", criteria: { practice: "Practice prerequisite skills", none: "No suitable activity" } };
const sha = async (text: string) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map(byte => byte.toString(16).padStart(2, "0")).join("");
// Synthetic fixtures exercise measured-input shape; they are never installed as production evidence.
async function fixture(models = ["jev-1.13.0"], backend: "local" | "system-one" = "system-one") {
  const input: CalibrationInput = { schemaVersion: 1, policy: { maxFalsePositiveRate: 0.1, maxActionErrorRate: 0.1, minSamples: 40, minActions: 40, minNegatives: 40 }, observations: models.flatMap(model => (["fit", "validation"] as const).flatMap(split => Array.from({ length: 100 }, (_, i) => ({
    observationId: `${model}-${split}-${i}`, sourceId: `source-${model}-${split}-${i}`, groupId: `${split}-${i}`, split, evidence: "observed" as const,
    backend: { backend, model, calibrationSha256: null }, question, metricKind: "choice-confidence" as const, value: i < 50 ? 0.1 : 0.9, label: i < 50 ? 0 as const : 1 as const,
  })))) };
  const prepared = prepareJudgementCalibrationArtifact(input), artifact = prepared.complete(await sha(prepared.identityInput));
  const contents = serializeJudgementCalibrationArtifact(artifact);
  return { contents, pin: await sha(contents), artifact };
}
class MemoryStorage {
  values = new Map<string, string>(); reads = 0; writes = 0;
  async getItem(key: string) { this.reads++; return this.values.get(key) ?? null; }
  async setItem(key: string, value: string) { this.writes++; this.values.set(key, value); }
  async removeItem(key: string) { this.values.delete(key); }
}
const response = (model = "jev-1.13.0") => Response.json({ model, answers: { choose: { type: "choice", choice: "practice", confidence: 0.98, probabilities: { practice: 0.99, none: 0.01 } } } });

describe("device-local fitted judgement calibration", () => {
  test("persists and reloads the exact verified artifact while preserving raw null provenance", async () => {
    const memory = new MemoryStorage(), first = new MobileJudgementCalibrationStore(memory, sha), file = await fixture();
    const installed = await first.install(file.contents, file.pin);
    expect(installed.backend).toEqual({ backend: "system-one", model: "jev-1.13.0", calibrationSha256: file.artifact.calibrationSha256 });
    expect(installed.fileSha256).not.toBe(installed.backend.calibrationSha256);
    expect(installed.questionCount).toBe(1);
    const reloaded = await new MobileJudgementCalibrationStore(memory, sha).load();
    expect(reloaded).toEqual(installed);
    const saved = JSON.parse([...memory.values.values()][0]!);
    expect(saved.contents).toBe(file.contents);
    expect(JSON.parse(saved.contents).input.observations[0].backend.calibrationSha256).toBeNull();
    expect([...memory.values.keys()]).toEqual(["keating.mobile.judgement-calibration.v1"]);
    await first.remove(); expect(await first.load()).toBeNull();
  });

  test("the production configured runtime selects using installed thresholds and keeps hosted opt-in independent", async () => {
    const memory = new MemoryStorage(), store = new MobileJudgementCalibrationStore(memory, sha), file = await fixture();
    await store.install(file.contents, file.pin);
    let calls = 0, allowed = true;
    const runtime = await configuredMobileJudgementRuntime({ calibrationStore: store, loadSettings: async () => ({ judgementHosted: allowed }), request: async body => {
      calls++; expect(JSON.parse(body).model).toBe("judgement"); return response();
    } });
    const routed = await routeJudgement("Saved learner work", { key: "choose", question, baseline: "none", read: (answer, thresholds, provenance) => answer.type === "choice" && answer.confidence >= thresholds.actAtOrAbove ? decided(answer.choice, answer.confidence, provenance) : abstained("below-confidence-floor", provenance) }, runtime.policy);
    expect(routed.value).toBe("practice"); expect(routed.verdict.status).toBe("decided"); expect(calls).toBe(1);
    expect(runtime.policy.tiers[0]!.key.calibrationSha256).toBe(file.artifact.calibrationSha256);
    allowed = false;
    expect((await runtime.call({ state: "work", questions: { choose: question } })).ok).toBe(false); expect(calls).toBe(1);
    const reads = memory.reads;
    const disabled = await configuredMobileJudgementRuntime({ calibrationStore: store, loadSettings: async () => ({ judgementHosted: false }), request: async () => { calls++; return response(); } });
    expect(disabled.policy.tiers).toEqual([]); expect(memory.reads).toBe(reads); expect(calls).toBe(1);
  });

  test("wrong pins, repinned tampering, ambiguous hosted models and local-only artifacts never install", async () => {
    const memory = new MemoryStorage(), store = new MobileJudgementCalibrationStore(memory, sha), file = await fixture();
    await expect(store.install(file.contents, "f".repeat(64))).rejects.toThrow("Calibration could not be verified or saved.");
    const tampered = JSON.parse(file.contents); tampered.groups[0].threshold = 0.1;
    const changed = JSON.stringify(tampered);
    await expect(store.install(changed, await sha(changed))).rejects.toThrow();
    const ambiguous = await fixture(["jev-1.13.0", "jev-1.14.0"]);
    await expect(store.install(ambiguous.contents, ambiguous.pin)).rejects.toThrow();
    const local = await fixture(["MiniCPM5-2B"], "local");
    await expect(store.install(local.contents, local.pin)).rejects.toThrow();
    expect(memory.writes).toBe(0);
  });

  test("persistence failure and changed bytes during verification fail closed", async () => {
    const file = await fixture(), memory = new MemoryStorage();
    const broken = new MobileJudgementCalibrationStore({ ...memory, getItem: async () => null, setItem: async () => {}, removeItem: async () => {} }, sha);
    await expect(broken.install(file.contents, file.pin)).rejects.toThrow();
    const first = new MobileJudgementCalibrationStore(memory, sha); await first.install(file.contents, file.pin);
    let mutate = true;
    const changed = new MobileJudgementCalibrationStore(memory, async text => {
      const hash = await sha(text);
      if (mutate) { mutate = false; memory.values.set([...memory.values.keys()][0]!, "{}"); }
      return hash;
    });
    await expect(changed.load()).rejects.toThrow();
    let calls = 0;
    const runtime = await configuredMobileJudgementRuntime({ calibrationStore: changed, loadSettings: async () => ({ judgementHosted: true }), request: async () => { calls++; return response(); } });
    expect((await runtime.call({ state: "work", questions: { choose: question } })).ok).toBe(false); expect(calls).toBe(0);
  });

  test("throwing observers cannot prevent installation or removal and all revisions invalidate old runtimes", async () => {
    const store = new MobileJudgementCalibrationStore(new MemoryStorage(), sha), file = await fixture(); let events = 0;
    store.subscribe(() => { throw new Error("UI failed"); }); store.subscribe(() => { events++; });
    const before = store.getRevision(); await store.install(file.contents, file.pin);
    expect(store.isCurrent(before)).toBe(false); expect(await store.load()).not.toBeNull();
    await store.remove(); expect(await store.load()).toBeNull(); expect(events).toBe(4);
  });

  test("removal cancels non-cooperative inference and installed model drift cannot reuse thresholds", async () => {
    const store = new MobileJudgementCalibrationStore(new MemoryStorage(), sha), file = await fixture(); await store.install(file.contents, file.pin);
    let started!: () => void; const dispatched = new Promise<void>(resolve => { started = resolve; });
    const runtime = await configuredMobileJudgementRuntime({ calibrationStore: store, loadSettings: async () => ({ judgementHosted: true }), request: async () => { started(); return new Promise(() => {}); } });
    const pending = runtime.call({ state: "work", questions: { choose: question } });
    await dispatched; await store.remove();
    expect(await pending).toMatchObject({ ok: false, error: { code: "cancelled" } });
    expect(await runtime.call({ state: "work", questions: { choose: question } })).toMatchObject({ ok: false, error: { code: "cancelled" } });
    await store.install(file.contents, file.pin);
    const drift = await configuredMobileJudgementRuntime({ calibrationStore: store, loadSettings: async () => ({ judgementHosted: true }), request: async () => response("jev-1.14.0") });
    expect(await drift.call({ state: "work", questions: { choose: question } })).toMatchObject({ ok: false, error: { code: "response-malformed" } });
  });

  test("installed and returned runtime calibration cannot be changed by caller mutation", async () => {
    const store = new MobileJudgementCalibrationStore(new MemoryStorage(), sha), file = await fixture();
    const installed = structuredClone(await store.install(file.contents, file.pin));
    const runtime = createMobileJudgementRuntime({ hostedEnabled: true, calibration: installed, request: async () => response() });
    const key = thresholdKey(installed.backend, questionDigest(question));
    (installed.backend as { model: string }).model = "jev-wrong";
    (installed.table.entries[key] as { actAtOrAbove: number }).actAtOrAbove = 0;
    expect(runtime.policy.tiers[0]!.key.model).toBe("jev-1.13.0"); expect(runtime.policy.calibration.entries[key]!.actAtOrAbove).toBe(0.9);
    expect(Object.isFrozen(runtime.policy.tiers)).toBe(true); expect(Object.isFrozen(runtime.policy.tiers[0]!.key)).toBe(true);
    expect(Object.isFrozen(runtime.policy.calibration.entries)).toBe(true); expect(Object.isFrozen(runtime.policy.calibration.entries[key])).toBe(true);
  });

  test("the settings file-import action validates pins and byte limits before reading, and cancellation preserves state", async () => {
    const store = new MobileJudgementCalibrationStore(new MemoryStorage(), sha), file = await fixture(); let picks = 0, reads = 0;
    const pick = async () => { picks++; return { sizeBytes: new TextEncoder().encode(file.contents).byteLength, readText: async () => { reads++; return file.contents; } }; };
    await expect(importMobileJudgementCalibration("bad-pin", { store, pick })).rejects.toThrow(); expect(picks).toBe(0);
    const installed = await importMobileJudgementCalibration(file.pin, { store, pick }); expect(installed?.fileSha256).toBe(file.pin); expect(reads).toBe(1);
    const revision = store.getRevision();
    expect(await importMobileJudgementCalibration(file.pin, { store, pick: async () => null })).toBeNull(); expect(store.getRevision()).toBe(revision);
    await expect(importMobileJudgementCalibration(file.pin, { store, pick: async () => ({ sizeBytes: MAX_CALIBRATION_BYTES + 1, readText: async () => { reads++; return file.contents; } }) })).rejects.toThrow();
    expect(reads).toBe(1);
    await expect(importMobileJudgementCalibration(file.pin, { store, pick: async () => ({ sizeBytes: 1, readText: async () => "x".repeat(MAX_CALIBRATION_BYTES + 1) }) })).rejects.toThrow();
    expect((await store.load())?.fileSha256).toBe(file.pin);
  });
  test("native file reads preserve exact Unicode bytes, reject invalid UTF-8 and stop at the byte cap", () => {
    function handle(bytes: Uint8Array) {
      let offset = 0; const state = { closed: false, read: 0 };
      return { state, readBytes(length: number) { const chunk = bytes.subarray(offset, offset + Math.min(length, 1024)); offset += chunk.length; state.read += chunk.length; return chunk; }, close() { state.closed = true; } };
    }
    const text = '{"question":"What is π?"}\n', good = handle(new TextEncoder().encode(text));
    expect(readMobileCalibrationFile(good)).toBe(text); expect(good.state.closed).toBe(true);
    const invalid = handle(new Uint8Array([0xf0, 0x9f, 0x92]));
    expect(() => readMobileCalibrationFile(invalid)).toThrow(); expect(invalid.state.closed).toBe(true);
    const oversized = handle(new Uint8Array(MAX_CALIBRATION_BYTES + 10));
    expect(() => readMobileCalibrationFile(oversized)).toThrow(); expect(oversized.state.closed).toBe(true); expect(oversized.state.read).toBe(MAX_CALIBRATION_BYTES + 1);
  });
});
