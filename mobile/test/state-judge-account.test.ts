import { describe, expect, test } from "bun:test";
import {
  backgroundActivityAllowed,
  configuredJudgeKey,
  hostedPredictionAllowed,
  judgeEnabled,
  memoryRequestKey,
} from "../src/state/judge-config";
import { activityAccountOf, memoryScopeOf, quizIdentityOf, type AccountScopeInput } from "../src/state/account-scope";

const revisions = { hosted: 3, local: 7 };
const judge = (overrides = {}) => ({ judgementHosted: false, judgementLocalModel: "off" as const, judgementMemory: true, ...overrides });

describe("judge configuration keys", () => {
  test("the judge key changes with settings and calibration revisions", () => {
    const base = configuredJudgeKey(judge(), revisions);
    expect(base).toBe('[false,"off",3,7]');
    expect(configuredJudgeKey(judge({ judgementHosted: true }), revisions)).not.toBe(base);
    expect(configuredJudgeKey(judge({ judgementLocalModel: "julia-1" }), revisions)).not.toBe(base);
    expect(configuredJudgeKey(judge(), { hosted: 4, local: 7 })).not.toBe(base);
  });

  test("the memory request key also binds identity and the memory toggle", () => {
    expect(memoryRequestKey("id-1", judge(), revisions)).toBe('["id-1",true,false,"off",3,7]');
    expect(memoryRequestKey("id-2", judge(), revisions)).not.toBe(memoryRequestKey("id-1", judge(), revisions));
    expect(memoryRequestKey("id-1", judge({ judgementMemory: false }), revisions)).not.toBe(memoryRequestKey("id-1", judge(), revisions));
  });

  test("a judge is enabled by hosted consent or any on-device model", () => {
    expect(judgeEnabled(judge())).toBe(false);
    expect(judgeEnabled(judge({ judgementHosted: true }))).toBe(true);
    expect(judgeEnabled(judge({ judgementLocalModel: "julia-1" }))).toBe(true);
  });

  test("hosted predictions are allowed by hosted consent or the MiniCPM local model only", () => {
    expect(hostedPredictionAllowed(judge())).toBe(false);
    expect(hostedPredictionAllowed(judge({ judgementHosted: true }))).toBe(true);
    expect(hostedPredictionAllowed(judge({ judgementLocalModel: "minicpm5-2b-int4" }))).toBe(true);
    expect(hostedPredictionAllowed(judge({ judgementLocalModel: "julia-1" }))).toBe(false);
  });
});

describe("background activity gate", () => {
  const gate = (overrides = {}) => ({
    appActive: true, hasRepository: true, scope: "scope", granted: true,
    preference: "tabular-model", expectedPreference: "tabular-model", chatMode: "background", ...overrides,
  });
  const on = judge({ judgementHosted: true });

  test("opens only when every condition holds", () => {
    expect(backgroundActivityAllowed(gate(), on)).toBe(true);
    expect(backgroundActivityAllowed(gate({ appActive: false }), on)).toBe(false);
    expect(backgroundActivityAllowed(gate({ hasRepository: false }), on)).toBe(false);
    expect(backgroundActivityAllowed(gate({ scope: null }), on)).toBe(false);
    expect(backgroundActivityAllowed(gate({ granted: false }), on)).toBe(false);
    expect(backgroundActivityAllowed(gate({ preference: "other" }), on)).toBe(false);
    expect(backgroundActivityAllowed(gate({ chatMode: "foreground" }), on)).toBe(false);
    expect(backgroundActivityAllowed(gate(), judge())).toBe(false);
  });
});

describe("account scopes", () => {
  const input = (overrides: Partial<AccountScopeInput> = {}): AccountScopeInput => ({
    status: "signed-in",
    session: { issuer: "https://issuer", accountId: "acct-1", scope: "openid tabular:predict" },
    account: null,
    activityIssuer: "https://issuer",
    ...overrides,
  });

  test("quiz identity combines status, issuer and the best available account id", () => {
    expect(quizIdentityOf(input())).toBe("signed-in:https://issuer:acct-1");
    expect(quizIdentityOf(input({ session: null, account: { did: "did:x" } }))).toBe("signed-in::did:x");
    expect(quizIdentityOf(input({ session: null, account: { id: "a", did: "d" } }))).toBe("signed-in::a");
    expect(quizIdentityOf(input({ status: "signed-out", session: null }))).toBe("signed-out::");
  });

  test("activity account needs a signed-in session from the trusted issuer", () => {
    expect(activityAccountOf(input())).toEqual({ scope: JSON.stringify(["https://issuer", "acct-1"]), granted: true });
    expect(activityAccountOf(input({ activityIssuer: "https://other" })).scope).toBeNull();
    expect(activityAccountOf(input({ status: "signed-out" })).scope).toBeNull();
    expect(activityAccountOf(input({ session: { issuer: "https://issuer", accountId: undefined, scope: "x" } })).scope).toBeNull();
  });

  test("activity account prefers the DID over the id and reports the tabular grant", () => {
    const noAccountId = input({ session: { issuer: "https://issuer", scope: "tabular:predict" }, account: { id: "id", did: "did" } });
    expect(activityAccountOf(noAccountId).scope).toBe(JSON.stringify(["https://issuer", "did"]));
    expect(activityAccountOf(input({ session: { issuer: "https://issuer", accountId: "a", scope: "openid" } })).granted).toBe(false);
    expect(activityAccountOf(input({ session: null })).granted).toBe(false);
  });

  test("memory scope is account-bound, device-local when signed out, and unknown while loading", () => {
    expect(memoryScopeOf(input())).toBe(JSON.stringify(["notorganic", "https://issuer", "acct-1"]));
    expect(memoryScopeOf(input({ status: "signed-out", session: null }))).toBe("device-local");
    expect(memoryScopeOf(input({ status: "loading", session: null }))).toBeNull();
    expect(memoryScopeOf(input({ session: { issuer: "https://issuer", scope: "" }, account: null }))).toBeNull();
  });
});
