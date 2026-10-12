import { afterEach, expect, test } from "bun:test";
import type { PortableLearnerData } from "@keating/learner-contracts";
import { rankingHoldoutAssignment } from "../../packages/learner-contracts/src/judgement/ranking-holdout";
import { onlineDecisionEvidenceId, type OnlineDecisionRequest, type OnlineDecisionResult } from "../../packages/learner-contracts/src/judgement/online-decision-policy";
import { applyMobileOnlineUrgency, MobileOnlineLearningPreferences, mobileOnlineLearningRefreshKey, mobileOnlineTopicEstimates } from "../src/lib/judgement/online-learning";
import type { ComingUp, ComingUpItem } from "../src/lib/learner-study";
import { loadMobileTabularModels, notOrganicTabularRequest, setAccountFetchForTests } from "../src/lib/notorganic-account/client";
import { clearDeviceSession, saveDeviceSession, setAccountCredentialStoreForTests } from "../src/lib/notorganic-account/credentials";
import { setAccountCryptoAdapterForTests } from "../src/lib/notorganic-account/crypto";
import { setDeviceKeyAdapterForTests } from "../src/lib/notorganic-account/dpop";
import { defaultNotOrganicAccountConfig, mobileTabularAccountConfig, NOTORGANIC_MOBILE_SCOPE } from "../src/lib/notorganic-account/contracts";

const now = Date.UTC(2026, 9, 1, 12);
function data(): PortableLearnerData {
  return { generatedAt: new Date(now).toISOString(), sessions: [], artifacts: [], goals: [], questionChecks: [], quizResults: [], decks: [], cardReviews: [],
    studyPriorities: [], feedbackEvents: [], usageEvents: [], topicEvidence: [], benchmarks: [], evolutions: [],
    learnerProfile: { topicsExplored: [], strengths: [], weaknesses: [], sessionsCount: 0 } };
}
function result(source: PortableLearnerData, target: "mastery" | "retention" | "urgency", predictions: OnlineDecisionResult["predictions"]): OnlineDecisionResult {
  return { predictions, receipt: { status: "active", target, model: "v3.5_default", evidenceId: onlineDecisionEvidenceId(source, target, now),
    requestId: "test", asOf: now, updatedAt: now, expiresAt: now + 86_400_000,
    counts: { observedRows: 40, trainRows: 30, validationRows: 10, candidateCount: predictions.length, omittedCandidates: 0 },
    validation: { kind: "paired-ranking-error", modelLoss: 0, baselineLoss: .5, passed: true, scope: "chronological-within-learner" },
    reasons: [], evidence: "observed-local-outcomes", validationScope: "chronological-within-learner" } };
}
function item(id: string, priority: "focus" | "maintain" = "focus"): ComingUpItem {
  return { id: `deck:${id}`, targetId: id, targetType: "deck", priority, prioritySource: "learner", title: id, topic: "Math", description: "deck",
    dueCount: 1, overdueCount: 0, nextDueAt: null, estimatedMinutes: 1, cardCount: 1, createdAt: new Date(now).toISOString() };
}

test("automatic refresh identity survives minute ticks and regenerated snapshots, then changes for saved evidence", () => {
  const source = data(), original = mobileOnlineLearningRefreshKey(source, now);
  const reexport = { ...structuredClone(source), generatedAt: new Date(now + 60_000).toISOString() };
  expect(mobileOnlineLearningRefreshKey(reexport, now + 60_000)).toBe(original);
  expect(mobileOnlineLearningRefreshKey(reexport, now + 120_000)).toBe(original);
  reexport.questionChecks.push({ id: "new", topic: "Math", question: "new question", answer: "answer", grading: "auto", score: 1,
    createdAt: new Date(now + 30_000).toISOString() });
  expect(mobileOnlineLearningRefreshKey(reexport, now + 60_000)).not.toBe(original);
  expect(mobileOnlineLearningRefreshKey(source, now + 3_600_000)).not.toBe(original);
});

test("model selection defaults off, isolates account and issuer, and a failed save cannot enable inference", async () => {
  const values = new Map<string, string>();
  const store = new MobileOnlineLearningPreferences({ getItem: async key => values.get(key) ?? null, setItem: async (key, value) => { values.set(key, value); } });
  const alice = '["https://issuer.test","alice"]', bob = '["https://issuer.test","bob"]';
  expect(store.get(alice)).toBe("off"); await store.load(alice); expect(store.loaded(alice)).toBe(true);
  await store.set(alice, "v3.5_default"); expect(store.get(alice)).toBe("v3.5_default"); expect(store.get(bob)).toBe("off");
  expect(store.get('["https://other.test","alice"]')).toBe("off");
  const broken = new MobileOnlineLearningPreferences({ getItem: async () => null, setItem: async () => { throw Error("full"); } });
  await expect(broken.set(alice, "v3.5_default")).rejects.toThrow(); expect(broken.get(alice)).toBe("off");
});

test("disabling wins over a slower preceding enable write", async () => {
  let finish!: () => void; let calls = 0; const values: string[] = [];
  const store = new MobileOnlineLearningPreferences({ getItem: async () => null, setItem: async (_key, value) => {
    if (++calls === 1) await new Promise<void>(resolve => { finish = resolve; }); values.push(value);
  } });
  const enable = store.set("account", "v3.5_default");
  await new Promise(resolve => setTimeout(resolve, 0));
  const disable = store.set("account", "off"); expect(store.get("account")).toBe("off");
  finish(); await Promise.all([enable, disable]);
  expect(store.get("account")).toBe("off"); expect(values).toEqual(["v3.5_default", "off"]);
});

test("urgency moves only predicted due decks inside a learner lane and preserves fixed controls", () => {
  const source = data(), scope = "account";
  const held: string[] = [], eligible: string[] = [];
  for (let i = 0; held.length < 1 || eligible.length < 3; i++) {
    const id = `d${i}`;
    (rankingHoldoutAssignment("decision-policy-urgency-v1", JSON.stringify([scope, id]), 1000).heldOut ? held : eligible).push(id);
  }
  const a = item(eligible[0]!), b = item(eligible[1]!), control = item(held[0]!), other = item(eligible[2]!, "maintain");
  const unknown = item("unknown"), future = { ...item("future"), dueCount: 0 };
  const base: ComingUp = { items: [a, control, unknown, future, b, other], lanes: { focus: [a, control, unknown, future, b], maintain: [other], low: [] },
    dueCardCount: 5, overdueCardCount: 0, estimatedMinutes: 6, dueDeckIds: [a.targetId, control.targetId, unknown.targetId, b.targetId, other.targetId] };
  const predictions = [a, control, b, other, future].map((row, i) => ({ key: row.id, deckId: row.targetId, topic: "math", value: [0.1, 1, .9, 1, 1][i]! }));
  const receipt = result(source, "urgency", predictions), saved = JSON.stringify(base);
  const projected = applyMobileOnlineUrgency(base, source, { urgency: receipt }, scope, now);
  expect(projected.lanes.focus.map(row => row.id)).toEqual([b.id, control.id, unknown.id, future.id, a.id]);
  expect(projected.lanes.maintain).toEqual([other]); expect(projected.dueCardCount).toBe(base.dueCardCount);
  expect(projected.dueDeckIds).not.toContain(future.targetId); expect(JSON.stringify(base)).toBe(saved);
  expect(applyMobileOnlineUrgency(base, source, { urgency: receipt }, null, now)).toBe(base);
  expect(applyMobileOnlineUrgency(base, source, { urgency: receipt }, scope, now + 86_400_000)).toBe(base);
  receipt.receipt.status = "baseline-retained";
  expect(applyMobileOnlineUrgency(base, source, { urgency: receipt }, scope, now)).toBe(base);
});

test("topic estimates retain topic/card scope and disappear when evidence changes", () => {
  const source = data(), mastery = result(source, "mastery", [{ key: "m", topic: "math", value: .8 }]);
  const retention = result(source, "retention", [{ key: "r1", topic: "math", deckId: "d", cardId: "c1", value: .4 },
    { key: "r2", topic: "math", deckId: "d", cardId: "c2", value: .8 }, { key: "r3", topic: "science", deckId: "s", cardId: "c3", value: 0 }]);
  const estimates = mobileOnlineTopicEstimates(source, { mastery, retention }, " Math ", now);
  expect(estimates.mastery).toBe(.8); expect(estimates.retention!.value).toBeCloseTo(.6); expect(estimates.retention!.cards).toBe(2);
  source.questionChecks.push({ id: "new", topic: "Math", question: "new question", answer: "answer", grading: "auto", score: 1, createdAt: new Date(now - 1).toISOString() });
  expect(mobileOnlineTopicEstimates(source, { mastery, retention }, "Math", now)).toEqual({ mastery: undefined, retention: null });
});

const config = { ...defaultNotOrganicAccountConfig(), issuer: "https://gateway.test" };
const session = { issuer: config.issuer, accountId: "alice", accessToken: "private-capability", accessExpiresAt: Date.now() + 60_000,
  refreshToken: "private-refresh", refreshExpiresAt: Date.now() + 600_000, scope: "infer:balanced tabular:predict" };
const request: OnlineDecisionRequest = { schemaVersion: 1, task: "regression", model: "v3.5_default", featureNames: ["count"],
  trainFeatures: [[1], [2]], trainTargets: [0, 1], testFeatures: [[3]] };
function installAccount() {
  const values = new Map<string, string>();
  setAccountCredentialStoreForTests({ getItem: async key => values.get(key) ?? null, setItem: async (key, value) => { values.set(key, value); }, deleteItem: async key => { values.delete(key); } });
  setAccountCryptoAdapterForTests({ randomBytes: async length => crypto.getRandomValues(new Uint8Array(length)),
    sha256Base64: async value => Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))).toString("base64") });
  setDeviceKeyAdapterForTests({ getOrCreatePublicJwkAsync: async () => ({ kty: "EC", crv: "P-256", x: "x", y: "y" }), signAsync: async () => "signature", deleteKeyAsync: async () => {} });
}
afterEach(() => { setAccountFetchForTests(null); setAccountCredentialStoreForTests(null); setAccountCryptoAdapterForTests(null); setDeviceKeyAdapterForTests(null); });

test("tabular permission is explicit and mobile transport binds DPoP, issuer, account, budget and redirect rejection", async () => {
  expect(NOTORGANIC_MOBILE_SCOPE.split(" ")).not.toContain("tabular:predict");
  expect(mobileTabularAccountConfig(config).scope.split(" ")).toContain("tabular:predict");
  installAccount(); await saveDeviceSession(session); let calls = 0;
  setAccountFetchForTests((async (url, init) => {
    calls++; expect(url).toBe("https://gateway.test/v1/tabular/predict"); expect(init?.redirect).toBe("error");
    const headers = new Headers(init?.headers), proof = JSON.parse(Buffer.from(headers.get("dpop")!.split(".")[1]!, "base64url").toString());
    expect(headers.get("authorization")).toBe("DPoP private-capability");
    expect(headers.get("x-notorganic-max-cost-microusd")).toBe("100000"); expect(proof).toMatchObject({ htm: "POST", htu: url });
    expect(JSON.parse(String(init?.body))).toEqual(request);
    return Response.json({ model: "v3.5_default", predictions: [.8] });
  }) as typeof fetch);
  expect((await notOrganicTabularRequest(request, undefined, config)).ok).toBe(true);
  for (const next of [{ ...session, issuer: undefined }, { ...session, issuer: "https://other.test" }, { ...session, scope: "infer:balanced" }, { ...session, accountId: undefined }]) {
    await saveDeviceSession(next); expect((await notOrganicTabularRequest(request, undefined, config)).status).toBe(403);
  }
  expect(calls).toBe(1);
});

test("logout while signing or while awaiting predictions invalidates the mobile response", async () => {
  installAccount(); await saveDeviceSession(session); let calls = 0;
  setDeviceKeyAdapterForTests({ getOrCreatePublicJwkAsync: async () => ({ kty: "EC", crv: "P-256", x: "x", y: "y" }),
    signAsync: async () => { await clearDeviceSession(); return "signature"; }, deleteKeyAsync: async () => {} });
  setAccountFetchForTests((async () => { calls++; return Response.json({ predictions: [.8] }); }) as typeof fetch);
  expect((await notOrganicTabularRequest(request, undefined, config)).status).toBe(403); expect(calls).toBe(0);
  installAccount(); await saveDeviceSession(session);
  setAccountFetchForTests((async () => { await clearDeviceSession(); return Response.json({ predictions: [.8] }); }) as typeof fetch);
  expect((await notOrganicTabularRequest(request, undefined, config)).status).toBe(403);
});

test("changing background eligibility during refresh or DPoP signing prevents tabular dispatch", async () => {
  for (const stage of ["refresh", "signing"] as const) {
    installAccount(); await saveDeviceSession({ ...session, accessExpiresAt: stage === "refresh" ? 0 : Date.now() + 60_000 });
    let current = true, sent = 0;
    if (stage === "signing") setDeviceKeyAdapterForTests({
      getOrCreatePublicJwkAsync: async () => ({ kty: "EC", crv: "P-256", x: "x", y: "y" }),
      signAsync: async () => { current = false; return "signature"; }, deleteKeyAsync: async () => {},
    });
    setAccountFetchForTests((async url => {
      if (String(url).endsWith("/v1/public/device/token")) {
        current = false;
        return Response.json({ access_token: "refreshed", token_type: "DPoP", expires_in: 300, scope: session.scope,
          refresh_token: "refreshed-refresh", refresh_expires_in: 600 });
      }
      sent++; return Response.json({ model: "v3.5_default", predictions: [.8] });
    }) as typeof fetch);
    expect((await notOrganicTabularRequest(request, undefined, config, async () => current)).status).toBe(403);
    expect(sent).toBe(0);
  }
});

test("sign-out during the final async eligibility read cannot dispatch with an old account", async () => {
  installAccount(); await saveDeviceSession(session); let reads = 0, sent = 0;
  setAccountFetchForTests((async () => { sent++; return Response.json({ predictions: [.8] }); }) as typeof fetch);
  const response = await notOrganicTabularRequest(request, undefined, config, async () => {
    if (++reads === 2) await clearDeviceSession();
    return true;
  });
  expect(response.status).toBe(403); expect(sent).toBe(0);
});

test("model catalogue uses authenticated read-only discovery and keeps unavailable pricing explicit", async () => {
  installAccount(); await saveDeviceSession({ ...session, scope: "infer:balanced" });
  setAccountFetchForTests((async (url, init) => {
    expect(url).toBe("https://gateway.test/v1/tabular/models"); expect(init?.body).toBeUndefined();
    expect(init?.redirect).toBe("error");
    const headers = new Headers(init?.headers); expect(headers.get("authorization")).toBe("DPoP private-capability");
    expect(headers.get("x-notorganic-max-cost-microusd")).toBeNull();
    return Response.json({ models: [{ id: "v3.5_default", name: "TabPFN 3.5", provider: "priorlabs", task: "regression", available: false,
      priceMicrousd: null, limits: { maxTrainRows: 500, maxTestRows: 64, maxFeatures: 32 } }] });
  }) as typeof fetch);
  expect(await loadMobileTabularModels(undefined, config)).toMatchObject([{ id: "v3.5_default", available: false, priceMicrousd: null }]);
});
