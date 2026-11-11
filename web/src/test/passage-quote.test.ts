import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import {
	MAX_QUOTE_CONTEXT,
	MAX_QUOTE_LABEL,
	MAX_QUOTE_LENGTH,
	MAX_QUOTES_PER_TURN,
	createPassageQuote,
	normalizeQuoteWhitespace,
	parseQuotedTurn,
	passageQuoteDisplayText,
	resolveQuote,
	serializeQuotedTurn,
	type PassageQuote,
} from "../keating/passage-quote";

const message = (exact: string, extra: Partial<PassageQuote> = {}): PassageQuote => ({
	source: { kind: "message", id: "assistant-3-1700000000000", label: "Keating's reply" },
	exact,
	...extra,
});

describe("passage quote anchors", () => {
	test("round-trips a quoted turn and reads naturally", () => {
		const turn = {
			quotes: [
				message("Energy is conserved in a closed system.", { prefix: "First, ", suffix: " That means" }),
				{ source: { kind: "artifact" as const, id: "plan-7", revision: 4, label: "Study plan" }, exact: "Week 2: derivatives" },
			],
			question: "Why does that hold?\nAnd when does it fail?",
		};
		const text = serializeQuotedTurn(turn);
		expect(text.startsWith("From Keating's reply:\n> Energy is conserved in a closed system.\n\nFrom Study plan:\n> Week 2: derivatives\n\nWhy does that hold?")).toBe(true);
		expect(parseQuotedTurn(text)).toEqual(turn);
	});

	test("a quote with no question round-trips with an empty question", () => {
		const text = serializeQuotedTurn({ quotes: [message("Only this.")], question: "  " });
		expect(parseQuotedTurn(text)).toEqual({ quotes: [message("Only this.")], question: "" });
	});

	test("the anchor comment cannot be closed early by quoted text", () => {
		const quote = message("a --> b", { prefix: "x -- y -->", suffix: "<!-- z" });
		const text = serializeQuotedTurn({ quotes: [quote], question: "q" });
		expect(text.match(/-->/g)?.length).toBe(2); // the quoted passage itself, and the real close
		expect(parseQuotedTurn(text)?.quotes[0]).toEqual(quote);
	});

	test("malformed envelopes are not parsed and display as readable text", () => {
		const valid = serializeQuotedTurn({ quotes: [message("Passage.")], question: "Q?" });
		const cases = [
			"plain text",
			valid.replace("v1 {", "v1 {oops"),
			valid.replace("From Keating's reply:", "From somewhere else:"),
			valid.replace('"kind":"message"', '"kind":"script"'),
			valid.replace('"quotes":[', '"quotes":"nope","x":['),
			valid.replace("> Passage.", ">  Passage."),
			"<!-- keating-quotes v1 {\"quotes\":[]} -->",
			`From Keating's reply:\n> a\n\n<!-- keating-quotes v1 ${JSON.stringify({ quotes: [{ source: { kind: "message", id: "" } }] })} -->`,
			`From Keating's reply:\n> a\n\n<!-- keating-quotes v1 ${JSON.stringify({ quotes: [{ source: { kind: "message", id: "m", revision: -1 } }] })} -->`,
			`From Keating's reply:\n> a\n\n<!-- keating-quotes v1 ${JSON.stringify({ quotes: [{ source: { kind: "message", id: "m" }, prefix: "x".repeat(500) }] })} -->`,
		];
		for (const text of cases) {
			expect(() => parseQuotedTurn(text)).not.toThrow();
			expect(parseQuotedTurn(text)).toBeNull();
			expect(passageQuoteDisplayText(text)).not.toContain("<!--");
		}
		expect(parseQuotedTurn(undefined as unknown as string)).toBeNull();
	});

	test("too many quotes in an envelope are rejected and serialisation caps them", () => {
		const many = Array.from({ length: MAX_QUOTES_PER_TURN + 2 }, (_, index) => message(`passage ${index}`));
		const text = serializeQuotedTurn({ quotes: many, question: "q" });
		expect(parseQuotedTurn(text)?.quotes).toHaveLength(MAX_QUOTES_PER_TURN);
		const forged = `${many.map((quote) => `From Keating's reply:\n> ${quote.exact}`).join("\n\n")}\n\n<!-- keating-quotes v1 ${JSON.stringify({ quotes: many.map((quote) => ({ source: quote.source })) })} -->`;
		expect(parseQuotedTurn(forged)).toBeNull();
	});

	test("creation normalises whitespace and enforces bounds", () => {
		const created = createPassageQuote({
			source: { kind: "message", id: " m1 ", label: `  A\n label ${"x".repeat(200)}` },
			exact: "  one\n\n two\t three  ",
			prefix: "p".repeat(200),
			suffix: "s".repeat(200),
		})!;
		expect(created.truncated).toBe(false);
		expect(created.quote.exact).toBe("one two three");
		expect(created.quote.source.id).toBe("m1");
		expect(created.quote.source.label!.length).toBeLessThanOrEqual(MAX_QUOTE_LABEL);
		expect(created.quote.prefix!.length).toBeLessThanOrEqual(MAX_QUOTE_CONTEXT);
		expect(created.quote.suffix!.length).toBeLessThanOrEqual(MAX_QUOTE_CONTEXT);

		const long = createPassageQuote({ source: { kind: "document", id: "d" }, exact: "word ".repeat(600) })!;
		expect(long.truncated).toBe(true);
		expect(long.quote.exact.length).toBeLessThanOrEqual(MAX_QUOTE_LENGTH);

		expect(createPassageQuote({ source: { kind: "message", id: "m" }, exact: "   " })).toBeNull();
		expect(createPassageQuote({ source: { kind: "elsewhere", id: "m" }, exact: "x" })).toBeNull();
		expect(createPassageQuote({ source: { kind: "message", id: "x".repeat(500) }, exact: "x" })).toBeNull();
		expect(createPassageQuote({ source: { kind: "artifact", id: "a", revision: "3" }, exact: "x" })!.quote.source.revision).toBe(3);
		expect(createPassageQuote({ source: { kind: "artifact", id: "a", revision: 1.5 }, exact: "x" })).toBeNull();
	});

	test("never splits a surrogate pair when truncating", () => {
		const exact = `${"a".repeat(MAX_QUOTE_LENGTH - 1)}😀tail`;
		const created = createPassageQuote({ source: { kind: "message", id: "m" }, exact })!;
		expect(/[\uD800-\uDBFF]$/.test(created.quote.exact)).toBe(false);
	});
});

describe("resolveQuote", () => {
	test("finds a passage despite whitespace differences", () => {
		const text = "Heat flows\n  from hot to cold.   Always.";
		const resolved = resolveQuote(message("from hot to cold."), text);
		expect(resolved).toEqual({ status: "found", start: 11, end: 28 });
		expect(normalizeQuoteWhitespace(text).slice(11, 28)).toBe("from hot to cold.");
	});

	test("reports outdated when the passage is gone", () => {
		expect(resolveQuote(message("from cold to hot"), "Heat flows from hot to cold.")).toEqual({ status: "outdated" });
	});

	test("prefix and suffix disambiguate repeated passages", () => {
		const text = "Step one: add the numbers. Step two: add the numbers again, then divide.";
		const first = resolveQuote(message("add the numbers", { prefix: "Step one: ", suffix: ". Step two" }), text);
		const second = resolveQuote(message("add the numbers", { prefix: "Step two: ", suffix: " again" }), text);
		expect(first).toEqual({ status: "found", start: 10, end: 25 });
		expect(second).toEqual({ status: "found", start: 37, end: 52 });
	});

	test("an ambiguous repeat with no context is outdated rather than guessed", () => {
		expect(resolveQuote(message("ab"), "ab ab")).toEqual({ status: "outdated" });
	});

	test("property: any quoted slice of a text resolves to that slice", () => {
		fc.assert(
			fc.property(fc.string({ minLength: 1, maxLength: 200 }), fc.nat(), fc.nat(), (raw, a, b) => {
				const text = normalizeQuoteWhitespace(raw);
				if (!text) return;
				const start = a % text.length;
				const end = start + 1 + (b % (text.length - start));
				const exact = normalizeQuoteWhitespace(text.slice(start, end));
				if (!exact) return;
				const offset = text.indexOf(exact, start - 1 < 0 ? 0 : start - 1);
				const prefix = text.slice(Math.max(0, offset - MAX_QUOTE_CONTEXT), offset);
				const suffix = text.slice(offset + exact.length, offset + exact.length + MAX_QUOTE_CONTEXT);
				const resolved = resolveQuote(message(exact, { prefix, suffix }), text);
				if (resolved.status === "found") expect(text.slice(resolved.start, resolved.end)).toBe(exact);
				// Only exact repeats with identical surroundings may be ambiguous.
				else expect(text.indexOf(exact) !== text.lastIndexOf(exact)).toBe(true);
			}),
		);
	});

	test("property: serialise/parse round-trips arbitrary bounded quotes", () => {
		const quote = fc.record({
			source: fc.record({
				kind: fc.constantFrom("message" as const, "artifact" as const, "document" as const),
				id: fc.stringMatching(/^[A-Za-z0-9_:-]{1,40}$/),
				label: fc.option(fc.stringMatching(/^[A-Za-z0-9' ]{1,30}$/).map((value) => value.trim()).filter(Boolean), { nil: undefined }),
				revision: fc.option(fc.nat(10_000), { nil: undefined }),
			}),
			exact: fc.string({ minLength: 1, maxLength: 300 }),
			prefix: fc.option(fc.string({ maxLength: 60 }), { nil: undefined }),
			suffix: fc.option(fc.string({ maxLength: 60 }), { nil: undefined }),
		});
		fc.assert(
			fc.property(fc.array(quote, { minLength: 1, maxLength: MAX_QUOTES_PER_TURN }), fc.string({ maxLength: 200 }), (raw, question) => {
				const quotes = raw.flatMap((item) => {
					const created = createPassageQuote(item);
					return created ? [created.quote] : [];
				});
				if (!quotes.length) return;
				const parsed = parseQuotedTurn(serializeQuotedTurn({ quotes, question }));
				expect(parsed).toEqual({ quotes, question: question.trim() });
			}),
		);
	});
});
