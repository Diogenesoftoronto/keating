import { expect, test } from "bun:test";
import {
  PROFILE_ABSTAIN_OPTION,
  PROFILE_FIELD_SPECS,
  acceptedProfilePatch,
  decideProfileField,
  isValidProfileEvidence,
  profileFieldQuestion,
  profileFieldSpec,
  profileProposalFrom,
  type ExtractableProfileField,
  type ProfileProposal,
} from "../src/judgement/profile-extraction.js";
import type { ChoiceAnswer } from "../src/judgement/contracts.js";
import { defaultDeclaredProfile } from "../src/learner-profile-declared.js";

const SAID = "I am studying for the MCAT in the spring.";

function answer(choice: string, confidence: number): ChoiceAnswer {
  return { type: "choice", choice, probabilities: { [choice]: confidence }, confidence };
}

test("every field spec produces a question with a rubric per value plus an abstain option", () => {
  for (const { field, values } of PROFILE_FIELD_SPECS) {
    const question = profileFieldQuestion(field);
    expect(question.type).toBe("choice");
    const criteria = Object.keys(question.criteria);
    expect(criteria.sort()).toEqual([...values, PROFILE_ABSTAIN_OPTION].sort());
    for (const key of criteria) expect((question.criteria[key] ?? "").trim().length).toBeGreaterThan(0);
  }
});

test("the abstain option is never a member of any field vocabulary", () => {
  for (const { values } of PROFILE_FIELD_SPECS) expect(values).not.toContain(PROFILE_ABSTAIN_OPTION);
});

test("a confident in-vocabulary answer extracts and keeps the learner sentence intact", () => {
  const decision = decideProfileField("motivation", answer("exam", 0.91), SAID);
  expect(decision).toMatchObject({ field: "motivation", value: "exam", reason: "extracted", confidence: 0.91 });
  expect(decision.evidence).toBe(SAID);
});

test("extraction abstains rather than guessing on ambiguous or unusable input", () => {
  expect(decideProfileField("motivation", answer(PROFILE_ABSTAIN_OPTION, 0.99), SAID))
    .toMatchObject({ value: null, reason: "no-evidence" });
  expect(decideProfileField("motivation", answer("exam", 0.4), SAID))
    .toMatchObject({ value: null, reason: "below-confidence", confidence: 0.4 });
  expect(decideProfileField("motivation", answer("vibes", 0.99), SAID))
    .toMatchObject({ value: null, reason: "no-evidence" });
  expect(decideProfileField("motivation", null, SAID))
    .toMatchObject({ value: null, reason: "invalid-response" });
  expect(decideProfileField("motivation", answer("exam", 1.5), SAID))
    .toMatchObject({ value: null, reason: "invalid-response" });
});

test("evidence must be an intact sentence within bounds", () => {
  expect(isValidProfileEvidence("ok")).toBe(false);
  expect(isValidProfileEvidence("x".repeat(241))).toBe(false);
  expect(isValidProfileEvidence(SAID)).toBe(true);
  expect(decideProfileField("motivation", answer("exam", 0.99), "no"))
    .toMatchObject({ value: null, reason: "invalid-evidence", evidence: null });
});

test("unanswered and declined never collapse into each other", () => {
  // Silence: the model found nothing. This must stay "" — an absent patch key —
  // and must never be reported as a decline.
  const silent = decideProfileField("ageBand", answer(PROFILE_ABSTAIN_OPTION, 0.99), "I want to learn chemistry.");
  expect(silent.reason).toBe("no-evidence");
  expect(silent.value).toBeNull();
  expect(profileProposalFrom(silent, "conversation")).toBeNull();
  expect(acceptedProfilePatch([])).not.toHaveProperty("ageBand");
  expect(defaultDeclaredProfile().ageBand).toBe("");

  // A spoken decline is a declared fact and survives to the profile.
  const declined = decideProfileField("ageBand", answer("prefer-not-to-say", 0.95), "I'd rather not give my age.");
  expect(declined).toMatchObject({ value: "prefer-not-to-say", reason: "extracted" });
  const proposal = profileProposalFrom(declined, "conversation");
  expect(acceptedProfilePatch([proposal!])).toMatchObject({ ageBand: "prefer-not-to-say" });
});

test("nothing reaches the profile without an accept", () => {
  const extracted = decideProfileField("tone", answer("direct", 0.88), "Just tell me straight, no fluff.");
  const proposal = profileProposalFrom(extracted, "conversation")!;
  // Extracted but not accepted: the patch is empty.
  expect(acceptedProfilePatch([])).toEqual({});
  // Accepted: it appears, and only then.
  expect(acceptedProfilePatch([proposal])).toEqual({ tone: "direct" });
});

test("an accepted proposal outside its vocabulary is dropped rather than written", () => {
  const forged: ProfileProposal = { field: "tone", value: "sarcastic", evidence: SAID, confidence: 1, source: "conversation" };
  expect(acceptedProfilePatch([forged])).toEqual({});
});

test("interests accumulate and deduplicate; enum fields take the last accepted value", () => {
  const interest = (value: string, source: ProfileProposal["source"] = "anki-import"): ProfileProposal =>
    ({ field: "interests", value, evidence: SAID, confidence: null, source });
  const patch = acceptedProfilePatch([
    interest("organic chemistry"),
    interest("organic chemistry"),
    interest("physiology"),
    { field: "depth", value: "overview", evidence: SAID, confidence: 0.9, source: "conversation" },
    { field: "depth", value: "rigorous", evidence: SAID, confidence: 0.9, source: "conversation" },
  ]);
  expect(patch).toEqual({ interests: ["organic chemistry", "physiology"], depth: "rigorous" });
});

test("decisions are frozen and unknown fields are rejected loudly", () => {
  expect(Object.isFrozen(decideProfileField("depth", answer("rigorous", 0.9), SAID))).toBe(true);
  expect(() => profileFieldSpec("shoeSize" as ExtractableProfileField)).toThrow(RangeError);
});

/* --- orchestration ------------------------------------------------------ */

import {
  ALL_EXTRACTABLE_PROFILE_FIELDS,
  extractProfileFields,
} from "../src/judgement/profile-extraction.js";
import type { JudgementCaller } from "../src/judgement/contracts.js";

const backend = { backend: "local", model: "test-v1", calibrationSha256: null } as const;

const caller = (answers: Record<string, unknown>): JudgementCaller =>
  async () => ({ ok: true, response: { answers: answers as never, backend } });

test("one pass asks every field about one sentence and decides each", async () => {
  const said = "I'm a working nurse studying for my certification, and I want it blunt.";
  const decisions = await extractProfileFields(said, ["motivation", "tone", "ageBand"], caller({
    motivation: answer("exam", 0.9),
    tone: answer("direct", 0.88),
    ageBand: answer(PROFILE_ABSTAIN_OPTION, 0.95),
  }));
  expect(decisions.map((d) => [d.field, d.value])).toEqual([
    ["motivation", "exam"],
    ["tone", "direct"],
    ["ageBand", null],
  ]);
  for (const decision of decisions) expect(decision.evidence).toBe(said);
});

test("an empty field list asks every extractable field", async () => {
  const decisions = await extractProfileFields(SAID, [], caller({}));
  expect(decisions.map((d) => d.field)).toEqual([...ALL_EXTRACTABLE_PROFILE_FIELDS]);
});

test("a missing answer for a requested field abstains rather than dropping the field", async () => {
  const decisions = await extractProfileFields(SAID, ["motivation", "depth"], caller({ motivation: answer("exam", 0.9) }));
  expect(decisions).toHaveLength(2);
  expect(decisions[1]).toMatchObject({ field: "depth", value: null, reason: "invalid-response" });
});

test("backend failure, a thrown caller and an abort all abstain coherently", async () => {
  const fields = ["motivation", "tone"] as const;
  const shapes: JudgementCaller[] = [
    async () => ({ ok: false, error: { code: "unavailable" } as never }),
    async () => { throw new Error("network"); },
  ];
  for (const call of shapes) {
    const decisions = await extractProfileFields(SAID, fields, call);
    expect(decisions.map((d) => d.value)).toEqual([null, null]);
    expect(decisions.every((d) => d.reason === "invalid-response")).toBe(true);
  }
  const aborted = new AbortController();
  aborted.abort();
  const decisions = await extractProfileFields(SAID, fields, caller({ motivation: answer("exam", 0.99) }), { signal: aborted.signal });
  expect(decisions.map((d) => d.value)).toEqual([null, null]);
});

test("a failed pass proposes nothing, so a broken backend cannot half-fill a review card", async () => {
  const decisions = await extractProfileFields(SAID, [], async () => { throw new Error("down"); });
  const proposals = decisions.map((d) => profileProposalFrom(d, "conversation")).filter(Boolean);
  expect(proposals).toEqual([]);
  expect(acceptedProfilePatch([])).toEqual({});
});

test("unusable evidence never reaches the backend", async () => {
  let called = false;
  const decisions = await extractProfileFields("no", ["tone"], async () => { called = true; throw new Error("unreachable"); });
  expect(called).toBe(false);
  expect(decisions[0]).toMatchObject({ reason: "invalid-evidence", value: null, evidence: null });
});
