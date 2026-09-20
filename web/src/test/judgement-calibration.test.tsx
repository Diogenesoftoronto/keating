import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { prepareJudgementCalibrationArtifact, serializeJudgementCalibrationArtifact } from "../../../packages/learner-contracts/src/judgement/calibration-artifact";
import { questionDigest, thresholdKey } from "@keating/learner-contracts";
import { createWebJudgementCalibrationStore, guardCalibrationCall, WEB_CALIBRATION_TEXT_KEY, WEB_CALIBRATION_SHA_KEY } from "../keating/judgement/calibration";
import { createWebJudgementRuntime } from "../keating/judgement/runtime";
import { JudgementCalibrationSettingsView } from "../components/settings/JudgementCalibrationSettings";
const digest = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2, "0")).join("");
const question = { type: "noul" as const, instructions: "Does the supplied work demonstrate prerequisites?" };
// Statistical inputs below are synthetic deterministic fixtures, never production calibration evidence.
async function fitted(models = [{ backend: "system-one", model: "jev-fixture-1" }]) {
  const observations = models.flatMap((backend, modelIndex) => ["fit", "validation"].flatMap(split => Array.from({ length: 80 }, (_, i) => ({
    observationId: `${modelIndex}-${split}-${i}`, sourceId: `${modelIndex}-${split}-${i}`, groupId: `${modelIndex}-${split}-${i}`,
    split, evidence: "observed", backend: { ...backend, calibrationSha256: null }, question, metricKind: "noul-probability", value: i < 40 ? .95 : .05, label: i < 40 ? 1 : 0,
  }))));
  const prepared = prepareJudgementCalibrationArtifact({ schemaVersion: 1, policy: { maxFalsePositiveRate: .1, maxActionErrorRate: .1, minSamples: 20, minActions: 20, minNegatives: 20 }, observations });
  const artifact = prepared.complete(await digest(prepared.identityInput));
  const contents = serializeJudgementCalibrationArtifact(artifact);
  return { artifact, contents, sha256: await digest(contents) };
}
class MemoryStorage {
  values = new Map<string, string>(); reads = 0;
  getItem(key: string) { this.reads++; return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}
const request = { state: "saved work", questions: { ready: question } };
const good = { ok: true as const, response: { backend: { backend: "system-one" as const, model: "jev-fixture-1", calibrationSha256: null }, answers: { ready: { type: "noul" as const, noul: .99 } } } };

test("imports exact bytes with independent hash, reloads verified data, and exposes only isolated table copies", async () => {
  const fixture = await fitted(), storage = new MemoryStorage();
  const store = createWebJudgementCalibrationStore({ storage: () => storage });
  await store.install(fixture.contents, fixture.sha256);
  expect(storage.values.get(WEB_CALIBRATION_TEXT_KEY)).toBe(fixture.contents);
  expect(storage.values.get(WEB_CALIBRATION_SHA_KEY)).toBe(fixture.sha256);
  expect(store.state()).toMatchObject({ status: "ready", fileSha256: fixture.sha256 });
  const selected = store.calibration("uninstalled").hosted!;
  const key = thresholdKey(selected.backend, questionDigest(question));
  expect(selected.table.entries[key]!.actAtOrAbove).toBe(.95);
  (selected.backend as { model: string }).model = "mutated";
  (selected.table.entries[key] as { actAtOrAbove: number }).actAtOrAbove = 0;
  expect(store.calibration("uninstalled").hosted!.backend.model).toBe("jev-fixture-1");
  expect(store.calibration("uninstalled").hosted!.table.entries[key]!.actAtOrAbove).toBe(.95);
  const reloaded = createWebJudgementCalibrationStore({ storage: () => storage });
  const loading = reloaded.ensureLoaded(); expect(reloaded.state().status).toBe("loading"); expect(reloaded.calibration("uninstalled")).toEqual({});
  await loading; expect(reloaded.state().status).toBe("ready");
  storage.setItem(WEB_CALIBRATION_TEXT_KEY, fixture.contents + " ");
  await reloaded.reload(); expect(reloaded.state().status).toBe("error"); expect(reloaded.calibration("uninstalled")).toEqual({});
  store.dispose(); reloaded.dispose();
});

test("wrong hash, derived-data tampering and ambiguous hosted models never install authority", async () => {
  const fixture = await fitted(), storage = new MemoryStorage(), store = createWebJudgementCalibrationStore({ storage: () => storage });
  await expect(store.install(fixture.contents, "0".repeat(64))).rejects.toThrow("could not be verified");
  const parsed = JSON.parse(fixture.contents); Object.values(parsed.table.entries).forEach((entry: any) => { entry.actAtOrAbove = .01; });
  const tampered = JSON.stringify(parsed);
  await expect(store.install(tampered, await digest(tampered))).rejects.toThrow("could not be verified");
  const ambiguous = await fitted([{ backend: "system-one", model: "jev-one" }, { backend: "system-one", model: "jev-two" }]);
  await expect(store.install(ambiguous.contents, ambiguous.sha256)).rejects.toThrow("one hosted model");
  expect(storage.values.size).toBe(0); expect(store.state().status).toBe("error"); store.dispose();
});

test("local installation matches exact chosen model and explicit hosted mismatch remains uncalibrated", async () => {
  const fixture = await fitted([{ backend: "local", model: "local-one" }, { backend: "local", model: "local-two" }, { backend: "system-one", model: "jev-fixture-1" }]);
  const storage = new MemoryStorage(), store = createWebJudgementCalibrationStore({ storage: () => storage });
  await store.install(fixture.contents, fixture.sha256);
  expect(store.calibration("local-two").local!.backend.model).toBe("local-two");
  expect(store.calibration("other", "other-hosted")).toEqual({ local: undefined, hosted: undefined }); store.dispose();
});

test("production runtime loads installed calibration without Settings and never dispatches while verification is pending", async () => {
  const fixture = await fitted(), storage = new MemoryStorage(); storage.setItem(WEB_CALIBRATION_TEXT_KEY, fixture.contents); storage.setItem(WEB_CALIBRATION_SHA_KEY, fixture.sha256);
  const store = createWebJudgementCalibrationStore({ storage: () => storage }); let calls = 0;
  const options = { calibrationStore: store, settings: { backend: "hosted" as const, localModelId: "missing-local", gatewayPath: "/api/judgement" }, hosted: { fetch: async () => { calls++; return { ok: true, status: 200, json: async () => ({ model: "jev-fixture-1", answers: { ready: { type: "noul", noul: .99 } } }) }; } } };
  const initial = createWebJudgementRuntime(options);
  expect(await initial.policy.tiers.at(-1)!.isAvailable!()).toBe(false);
  expect((await initial.policy.tiers.at(-1)!.call(request)).ok).toBe(false); expect(calls).toBe(0);
  await store.ensureLoaded();
  const configured = createWebJudgementRuntime(options), hosted = configured.policy.tiers.at(-1)!;
  expect(hosted.key).toMatchObject({ model: "jev-fixture-1", calibrationSha256: fixture.artifact.calibrationSha256 });
  expect(Object.keys(configured.policy.calibration.entries)).toHaveLength(1);
  expect((await hosted.call(request)).ok).toBe(true); expect(calls).toBe(1);
  store.remove(); expect((await hosted.call(request)).ok).toBe(false); expect(calls).toBe(1); store.dispose();
});

test("off mode does not read or verify installed artifacts", () => {
  const storage = new MemoryStorage(), store = createWebJudgementCalibrationStore({ storage: () => storage });
  const runtime = createWebJudgementRuntime({ calibrationStore: store, settings: { backend: "off", localModelId: "unused", gatewayPath: "/api/judgement" } });
  expect(runtime.policy.tiers).toEqual([]); expect(storage.reads).toBe(0); expect(store.state().status).toBe("unloaded"); store.dispose();
});

test("remove cancels an uncooperative in-flight call; changed raw storage rejects late results even before its event", async () => {
  const fixture = await fitted(), storage = new MemoryStorage(), events = new EventTarget();
  const store = createWebJudgementCalibrationStore({ storage: () => storage, events }); await store.install(fixture.contents, fixture.sha256);
  const replaced = guardCalibrationCall(async () => new Promise(() => {}), store, store.state().generation)(request);
  await store.install(fixture.contents, fixture.sha256);
  expect(await replaced).toMatchObject({ ok: false, error: { code: "cancelled" } });
  const pending = guardCalibrationCall(async () => new Promise(() => {}), store, store.state().generation)(request);
  store.remove(); expect(await pending).toMatchObject({ ok: false, error: { code: "cancelled" } });
  await store.install(fixture.contents, fixture.sha256);
  let resolve!: (value: typeof good) => void;
  const late = guardCalibrationCall(async () => new Promise(done => { resolve = done; }), store, store.state().generation)(request);
  storage.setItem(WEB_CALIBRATION_SHA_KEY, "0".repeat(64)); resolve(good);
  expect(await late).toMatchObject({ ok: false, error: { code: "cancelled" } });
  await store.ensureLoaded(); expect(store.state().status).toBe("error");
  await store.install(fixture.contents, fixture.sha256);
  const otherTab = guardCalibrationCall(async () => new Promise(() => {}), store, store.state().generation)(request);
  storage.removeItem(WEB_CALIBRATION_TEXT_KEY); events.dispatchEvent(new Event("storage"));
  expect(await otherTab).toMatchObject({ ok: false, error: { code: "cancelled" } }); store.dispose();
});

test("failed storage writes, readbacks and removal remain explicit errors", async () => {
  const fixture = await fitted();
  const failed = createWebJudgementCalibrationStore({ storage: () => ({ getItem: () => null, setItem: () => { throw new Error("quota private detail"); }, removeItem: () => { throw new Error(); } }) });
  await expect(failed.install(fixture.contents, fixture.sha256)).rejects.toThrow("could not save or read");
  expect(failed.state().error).not.toContain("private"); expect(() => failed.remove()).toThrow("could not save or read"); failed.dispose();
  const missing = createWebJudgementCalibrationStore({ storage: () => ({ getItem: () => null, setItem: () => {}, removeItem: () => {} }) });
  await expect(missing.install(fixture.contents, fixture.sha256)).rejects.toThrow("could not save or read"); expect(missing.state().status).toBe("error"); missing.dispose();
});

test("removal during artifact verification cannot resurrect an installation", async () => {
  const fixture = await fitted(), storage = new MemoryStorage(); let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const store = createWebJudgementCalibrationStore({ storage: () => storage, digest: async contents => { await gate; return digest(contents); } });
  const installing = store.install(fixture.contents, fixture.sha256); store.remove(); release();
  await expect(installing).rejects.toThrow("cancelled"); expect(storage.values.size).toBe(0); expect(store.state().status).toBe("empty"); store.dispose();
});

test("settings exposes explicit import, supplied hash, verified model coverage and removal", () => {
  const markup = renderToStaticMarkup(<JudgementCalibrationSettingsView state={{ status: "ready", generation: 1, error: null, fileSha256: "a".repeat(64), models: [{ backend: "system-one", model: "jev-fixture-1", questions: 3 }] }} file={null} sha256="" busy={false} error="" onFile={() => {}} onSha256={() => {}} onInstall={() => {}} onRemove={() => {}} />);
  expect(markup).toContain("Calibration file"); expect(markup).toContain("Supplied file SHA-256"); expect(markup).toContain("3 validated questions"); expect(markup).toContain("Remove calibration"); expect(markup).toContain("Installed file SHA-256"); expect(markup).toContain("a".repeat(64)); expect(markup).toContain("Your review mode stays unchanged");
});
