import { describe, expect, test } from "bun:test";
import { promotionRequest, requestWorkerRun } from "../scripts/request-staging-promotion.js";

const sha = "a".repeat(40);
const request = promotionRequest({ now: true }, { sha, dirty: false, promotionEligible: true }, "fixed-request-id");
const old = { id: "old", status: "SUCCESS", createdAt: "2026-09-24T10:00:00Z" };
const fresh = { id: "fresh", status: "SUCCESS", createdAt: "2026-09-24T11:00:00Z" };

function provider(options: { request?: string; oldRequest?: string; requestPresent?: boolean; delayFreshOnce?: boolean; stopped?: boolean; instanceStates?: string[]; noFresh?: boolean; changedBeforeRestart?: boolean; restartAccepted?: boolean } = {}) {
  let clock = 0;
  let lists = 0;
  const calls: string[][] = [];
  return {
    calls,
    now: () => clock,
    sleep: async (ms: number) => { clock += ms; },
    run: async (args: string[]) => {
      calls.push(args);
      if (args[1] === "deployment") {
        lists++;
        return JSON.stringify(lists === 1 || options.noFresh || options.delayFreshOnce && lists === 2 ? [old] : options.changedBeforeRestart && lists >= 3 ? [{ ...fresh, id: "replacement" }] : [fresh, old]);
      }
      if (args[1] === "variable" && args[2] === "list") return JSON.stringify(options.requestPresent === false ? { RAILWAY_TOKEN: null } : { KEATING_PROMOTION_REQUEST: options.oldRequest ?? request, RAILWAY_TOKEN: null });
      if (args[1] === "variable") return JSON.stringify({ set: true });
      if (args[1] === "api" && args[2]!.startsWith("query")) return JSON.stringify({ data: {
        deployment: { ...fresh, id: JSON.parse(args[args.indexOf("--variables") + 1]!).id, deploymentStopped: options.stopped ?? true, instances: (options.instanceStates ?? (options.stopped === false ? ["RUNNING"] : ["EXITED"])).map((status, index) => ({ id: `instance-${index}`, status })), projectId: "314d5558-957b-4e19-9ae0-bc08c8b5cf78", serviceId: "a1fef6d6-698e-4e0b-8647-452ac4399614", environmentId: "343e403a-fac6-4a18-a413-d3bfd5f758f1" },
        deploymentSnapshot: { variables: { KEATING_PROMOTION_REQUEST: JSON.parse(args[args.indexOf("--variables") + 1]!).id === "old" ? options.oldRequest ?? options.request ?? request : options.request ?? request, RAILWAY_TOKEN: "secret-never-logged" } },
      } });
      if (args[1] === "api" && args[2]!.startsWith("mutation")) return JSON.stringify({ data: { deploymentRestart: options.restartAccepted ?? true } });
      throw new Error("Unexpected command");
    },
  };
}

describe("manual staging promotion requests", () => {
  test("creates a scoped immediate request and rejects dirty or malformed candidates", () => {
    expect(JSON.parse(request)).toEqual({ id: "fixed-request-id", action: "promote", sha });
    expect(() => promotionRequest({ now: true }, { sha, dirty: true, promotionEligible: false })).toThrow(/clean/);
    expect(() => promotionRequest({ now: true, sha: "short" })).toThrow(/full/);
    expect(() => promotionRequest({ sha })).toThrow(/now=true/);
    expect(JSON.parse(promotionRequest({ now: true, sha })).action).toBe("rollback");
    expect(promotionRequest({ now: false })).toBe("");
  });
  test("normal variable deployment captures request then restarts the exact new stopped deployment", async () => {
    const fake = provider();
    expect(await requestWorkerRun(request, fake)).toEqual({ deploymentId: "fresh", restarted: true });
    expect(fake.calls.some(args => args.includes("--skip-deploys") || args.includes("redeploy"))).toBe(false);
    const mutation = fake.calls.find(args => args[2]?.startsWith("mutation"))!;
    expect(JSON.parse(mutation[mutation.indexOf("--variables") + 1]!)).toEqual({ id: "fresh" });
    expect(fake.calls[1]).toContain(`KEATING_PROMOTION_REQUEST=${request}`);
  });
  test("leaves a matching deployment that has already started running alone", async () => {
    const fake = provider({ stopped: false });
    expect(await requestWorkerRun(request, fake)).toEqual({ deploymentId: "fresh", restarted: false });
    expect(fake.calls.some(args => args[2]?.startsWith("mutation"))).toBe(false);
  });
  test("starts an idle CREATED cron instance even when deploymentStopped is false", async () => {
    const fake = provider({ stopped: false, instanceStates: ["CREATED"] });
    expect(await requestWorkerRun(request, fake)).toEqual({ deploymentId: "fresh", restarted: true });
    expect(fake.calls.some(args => args[2]?.includes("instances { id status }"))).toBe(true);
    const mutation = fake.calls.find(args => args[2]?.startsWith("mutation"))!;
    expect(JSON.parse(mutation[mutation.indexOf("--variables") + 1]!)).toEqual({ id: "fresh" });
  });
  test("transitional and unknown instances never trigger a restart", async () => {
    for (const state of ["INITIALIZING", "RESTARTING", "UNKNOWN_NEW_STATE"]) {
      const fake = provider({ stopped: true, instanceStates: [state] });
      await expect(requestWorkerRun(request, fake)).rejects.toThrow(/Timed out/);
      expect(fake.calls.some(args => args[2]?.startsWith("mutation"))).toBe(false);
    }
  });
  test("refuses another request's deployment and a replacement arriving before restart", async () => {
    for (const options of [{ request: "different-request" }, { changedBeforeRestart: true }]) {
      const fake = provider(options);
      await expect(requestWorkerRun(request, fake)).rejects.toThrow(/superseded|changed/);
      expect(fake.calls.some(args => args[2]?.startsWith("mutation"))).toBe(false);
    }
  });
  test("does not fall back to an old image when variable update creates no new deployment", async () => {
    const fake = provider({ noFresh: true });
    await expect(requestWorkerRun(request, fake)).rejects.toThrow(/Timed out/);
    expect(fake.calls.some(args => args[2]?.startsWith("mutation") || args.includes("redeploy"))).toBe(false);
  });
  test("a normal gated check clears a pending immediate request in the new snapshot", async () => {
    const fake = provider({ request: "" });
    expect(await requestWorkerRun("", fake)).toEqual({ deploymentId: "fresh", restarted: true });
    expect(fake.calls.some(args => args[1] === "variable" && args[2] === "delete" && args.includes("KEATING_PROMOTION_REQUEST"))).toBe(true);
    expect(fake.calls.some(args => args.includes("KEATING_PROMOTION_REQUEST="))).toBe(false);
  });
  test("an already-empty request can restart its existing stopped snapshot without a new deployment", async () => {
    const fake = provider({ request: "", noFresh: true, requestPresent: false });
    expect(await requestWorkerRun("", fake)).toEqual({ deploymentId: "old", restarted: true });
    const mutation = fake.calls.find(args => args[2]?.startsWith("mutation"))!;
    expect(JSON.parse(mutation[mutation.indexOf("--variables") + 1]!)).toEqual({ id: "old" });
    expect(fake.calls.some(args => args[1] === "variable" && ["set", "delete"].includes(args[2]!))).toBe(false);
  });
  test("clearing a pending request waits for its replacement instead of restarting the old request", async () => {
    const fake = provider({ request: "", oldRequest: request, delayFreshOnce: true });
    expect(await requestWorkerRun("", fake)).toEqual({ deploymentId: "fresh", restarted: true });
    const mutations = fake.calls.filter(args => args[2]?.startsWith("mutation"));
    expect(mutations).toHaveLength(1);
    expect(JSON.parse(mutations[0]![mutations[0]!.indexOf("--variables") + 1]!)).toEqual({ id: "fresh" });
  });
  test("a false API restart result cannot be reported as accepted", async () => {
    const fake = provider({ restartAccepted: false });
    await expect(requestWorkerRun(request, fake)).rejects.toThrow(/did not confirm/);
  });
  test("absent live request cannot revive an old snapshot containing a pending request", async () => {
    const fake = provider({ requestPresent: false, oldRequest: request, noFresh: true });
    await expect(requestWorkerRun("", fake)).rejects.toThrow(/old request/);
    expect(fake.calls.some(args => args[2]?.startsWith("mutation") || args.includes("redeploy"))).toBe(false);
  });
});
