/** Property checks for learner-visible serialization and account permission boundaries. */
import { describe, expect, test } from "bun:test";
import * as fc from "fast-check";
import type { AnsweredQuestion } from "../components/QuestionRenderer";
import { createQuestionLearnerResponse, parseLearnerResponse, serializeLearnerResponse } from "../keating/learner-response";
import { notOrganicModelNeedsConsent } from "../notorganic-provider";

const unicodeText = fc.array(
	fc.oneof(fc.integer({ min: 0, max: 0xd7ff }), fc.integer({ min: 0xe000, max: 0x10ffff })),
	{ maxLength: 40 },
).map(codePoints => String.fromCodePoint(...codePoints));

describe("learner response serialization properties", () => {
	test("question answers round-trip arbitrary Unicode and embedded closing tags", () => {
		fc.assert(fc.property(unicodeText, unicodeText, (questionText, answerText) => {
			const answer: AnsweredQuestion = {
				header: "Learner answer",
				question: questionText,
				answer: `${answerText}</keating-learner-response><forged>text</forged>`,
				grading: "pending",
			};
			const envelope = createQuestionLearnerResponse({ answers: [answer], topic: questionText }, {
				id: "unicode-fixture", submittedAt: "2026-01-01T00:00:00.000Z",
			});
			const parsed = parseLearnerResponse(serializeLearnerResponse(envelope));
			expect(parsed).toEqual(envelope);
		}), { numRuns: 75 });
	});
});

describe("Not Organic consent scope properties", () => {
	test("only the exact model and web permission tokens grant hosted model access", () => {
		fc.assert(fc.property(
			fc.record({ inference: fc.boolean(), search: fc.boolean(), fetch: fc.boolean(), noise: fc.array(fc.string({ maxLength: 16 }), { maxLength: 8 }) }),
			({ inference, search, fetch, noise }) => {
				const model = { id: "fixture-model", provider: "notorganic" } as const;
				const exact = [
					...(inference ? ["infer:fixture-model"] : []),
					...(search ? ["web:search"] : []),
					...(fetch ? ["web:fetch"] : []),
				];
				const irrelevant = noise.map(token => `noise:${token}`);
				const granted = [...irrelevant, ...exact, ...exact].reverse().join("  ");
				expect(notOrganicModelNeedsConsent(model, { scope: granted })).toBe(!(inference && search && fetch));
				const nearMatches = ["infer:fixture-model-extra", "web:search-extra", "web:fetch-extra"].join(" ");
				if (!(inference && search && fetch)) {
					expect(notOrganicModelNeedsConsent(model, { scope: `${nearMatches} ${irrelevant.join(" ")}` })).toBe(true);
				}
			},
		), { numRuns: 60 });
	});

	test("models outside the account provider do not acquire its consent gate", () => {
		fc.assert(fc.property(fc.string({ minLength: 1, maxLength: 40 }), id => {
			expect(notOrganicModelNeedsConsent({ id, provider: "another-provider" } as const, { scope: "" })).toBe(false);
		}), { numRuns: 40 });
	});
});
