import { expect, test } from "bun:test";
import { extractProfileProposals } from "../keating/judgement/profile-extraction";
import { acceptedProfilePatch, type JudgementCaller } from "@keating/learner-contracts";

const backend = { backend: "local", model: "test-v1", calibrationSha256: null } as const;
const SAID = "I'm cramming for the bar exam and I want you to be blunt with me.";

const caller = (answers: Record<string, unknown>): JudgementCaller =>
  async () => ({ ok: true, response: { answers: answers as never, backend } });

const choice = (value: string, confidence: number) =>
  ({ type: "choice", choice: value, probabilities: { [value]: confidence }, confidence });

test("extraction is off by default and sends nothing to a model", async () => {
  let called = false;
  const result = await extractProfileProposals(SAID, {
    enabled: false,
    call: async () => { called = true; throw new Error("unreachable"); },
  });
  expect(called).toBe(false);
  expect(result.proposals).toEqual([]);
  expect(result.decisions).toEqual([]);
});

test("enabled extraction returns reviewable proposals that write nothing on their own", async () => {
  const result = await extractProfileProposals(SAID, {
    enabled: true,
    fields: ["motivation", "tone"],
    call: caller({ motivation: choice("exam", 0.92), tone: choice("direct", 0.9) }),
  });
  expect(result.proposals.map(p => [p.field, p.value])).toEqual([["motivation", "exam"], ["tone", "direct"]]);
  for (const proposal of result.proposals) {
    expect(proposal.evidence).toBe(SAID);
    expect(proposal.source).toBe("conversation");
  }
  // Still nothing in the profile until the learner accepts.
  expect(acceptedProfilePatch([])).toEqual({});
  expect(acceptedProfilePatch(result.proposals)).toEqual({ motivation: "exam", tone: "direct" });
});

test("abstentions are reported as decisions but never as proposals", async () => {
  const result = await extractProfileProposals(SAID, {
    enabled: true,
    fields: ["motivation", "ageBand"],
    call: caller({ motivation: choice("exam", 0.92), ageBand: choice("no-evidence", 0.99) }),
  });
  expect(result.decisions).toHaveLength(2);
  expect(result.proposals.map(p => p.field)).toEqual(["motivation"]);
});

test("the speech path is labelled so review can say where a proposal came from", async () => {
  const result = await extractProfileProposals(SAID, {
    enabled: true, fields: ["tone"], source: "speech",
    call: caller({ tone: choice("direct", 0.9) }),
  });
  expect(result.proposals[0]?.source).toBe("speech");
});
