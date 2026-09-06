/**
 * A closed arithmetic language for simulation readouts.
 *
 * Keating's OpenUI compiler never evaluates model-authored code, and this does
 * not change that: the grammar below has no calls, no property access, no
 * assignment, and no identifiers except the parameter ids declared on the same
 * node. It is parsed and evaluated by this file — nothing reaches `eval`, the
 * `Function` constructor, or the DOM.
 *
 *   expr   := term (("+" | "-") term)*
 *   term   := factor (("*" | "/" | "%") factor)*
 *   factor := unary ("^" factor)?
 *   unary  := ("-" | "+")? primary
 *   primary := number | parameterId | "(" expr ")"
 *
 * Evaluation is total: a division by zero, an overflow, or a non-finite result
 * yields `undefined` for the caller to render as "no value" rather than
 * throwing into a render pass.
 */

export const MAX_SIMULATION_EXPRESSION_LENGTH = 512;
const MAX_DEPTH = 24;

export type SimulationExpressionError =
	| { kind: "too-long" }
	| { kind: "unexpected-character"; index: number; character: string }
	| { kind: "unknown-parameter"; name: string }
	| { kind: "syntax"; message: string }
	| { kind: "too-deep" };

export type SimulationExpressionParse =
	| { ok: true; node: SimulationExpressionNode; parameters: string[] }
	| { ok: false; error: SimulationExpressionError };

export type SimulationExpressionNode =
	| { kind: "number"; value: number }
	| { kind: "parameter"; name: string }
	| { kind: "unary"; operator: "-"; operand: SimulationExpressionNode }
	| { kind: "binary"; operator: "+" | "-" | "*" | "/" | "%" | "^"; left: SimulationExpressionNode; right: SimulationExpressionNode };

type Token =
	| { type: "number"; value: number }
	| { type: "identifier"; value: string }
	| { type: "operator"; value: "+" | "-" | "*" | "/" | "%" | "^" }
	| { type: "paren"; value: "(" | ")" };

const OPERATORS = new Set(["+", "-", "*", "/", "%", "^"]);

function tokenize(source: string): { ok: true; tokens: Token[] } | { ok: false; error: SimulationExpressionError } {
	const tokens: Token[] = [];
	let index = 0;
	while (index < source.length) {
		const character = source[index]!;
		if (character === " " || character === "\t" || character === "\n" || character === "\r") {
			index += 1;
			continue;
		}
		if (character === "(" || character === ")") {
			tokens.push({ type: "paren", value: character });
			index += 1;
			continue;
		}
		if (OPERATORS.has(character)) {
			tokens.push({ type: "operator", value: character as "+" });
			index += 1;
			continue;
		}
		if (character >= "0" && character <= "9") {
			let end = index;
			while (end < source.length && source[end]! >= "0" && source[end]! <= "9") end += 1;
			if (source[end] === ".") {
				end += 1;
				while (end < source.length && source[end]! >= "0" && source[end]! <= "9") end += 1;
			}
			const value = Number(source.slice(index, end));
			if (!Number.isFinite(value)) return { ok: false, error: { kind: "syntax", message: "A numeric literal is not finite." } };
			tokens.push({ type: "number", value });
			index = end;
			continue;
		}
		if (isIdentifierStart(character)) {
			let end = index;
			while (end < source.length && isIdentifierPart(source[end]!)) end += 1;
			tokens.push({ type: "identifier", value: source.slice(index, end) });
			index = end;
			continue;
		}
		return { ok: false, error: { kind: "unexpected-character", index, character } };
	}
	return { ok: true, tokens };
}

function isIdentifierStart(character: string): boolean {
	return (character >= "a" && character <= "z") || (character >= "A" && character <= "Z") || character === "_";
}

function isIdentifierPart(character: string): boolean {
	return isIdentifierStart(character) || (character >= "0" && character <= "9") || character === "-";
}

/**
 * Parse an expression, resolving identifiers against the declared parameters.
 * An identifier that is not a declared parameter is rejected, so an expression
 * can never reach for anything the node did not define.
 */
export function parseSimulationExpression(source: string, parameterIds: readonly string[]): SimulationExpressionParse {
	if (source.length > MAX_SIMULATION_EXPRESSION_LENGTH) return { ok: false, error: { kind: "too-long" } };
	const lexed = tokenize(source);
	if (!lexed.ok) return { ok: false, error: lexed.error };
	const known = new Set(parameterIds);
	const used = new Set<string>();
	const tokens = lexed.tokens;
	let position = 0;

	const peek = (): Token | undefined => tokens[position];

	function parseExpression(depth: number): SimulationExpressionNode {
		if (depth > MAX_DEPTH) throw { kind: "too-deep" } satisfies SimulationExpressionError;
		let left = parseTerm(depth + 1);
		for (;;) {
			const token = peek();
			if (token?.type !== "operator" || (token.value !== "+" && token.value !== "-")) return left;
			position += 1;
			left = { kind: "binary", operator: token.value, left, right: parseTerm(depth + 1) };
		}
	}

	function parseTerm(depth: number): SimulationExpressionNode {
		if (depth > MAX_DEPTH) throw { kind: "too-deep" } satisfies SimulationExpressionError;
		let left = parseFactor(depth + 1);
		for (;;) {
			const token = peek();
			if (token?.type !== "operator" || (token.value !== "*" && token.value !== "/" && token.value !== "%")) return left;
			position += 1;
			left = { kind: "binary", operator: token.value, left, right: parseFactor(depth + 1) };
		}
	}

	function parseFactor(depth: number): SimulationExpressionNode {
		if (depth > MAX_DEPTH) throw { kind: "too-deep" } satisfies SimulationExpressionError;
		const left = parseUnary(depth + 1);
		const token = peek();
		if (token?.type === "operator" && token.value === "^") {
			position += 1;
			// Right-associative: 2^3^2 is 2^(3^2).
			return { kind: "binary", operator: "^", left, right: parseFactor(depth + 1) };
		}
		return left;
	}

	function parseUnary(depth: number): SimulationExpressionNode {
		if (depth > MAX_DEPTH) throw { kind: "too-deep" } satisfies SimulationExpressionError;
		const token = peek();
		if (token?.type === "operator" && (token.value === "-" || token.value === "+")) {
			position += 1;
			const operand = parseUnary(depth + 1);
			return token.value === "-" ? { kind: "unary", operator: "-", operand } : operand;
		}
		return parsePrimary(depth + 1);
	}

	function parsePrimary(depth: number): SimulationExpressionNode {
		if (depth > MAX_DEPTH) throw { kind: "too-deep" } satisfies SimulationExpressionError;
		const token = peek();
		if (!token) throw { kind: "syntax", message: "The expression ended early." } satisfies SimulationExpressionError;
		if (token.type === "number") {
			position += 1;
			return { kind: "number", value: token.value };
		}
		if (token.type === "identifier") {
			if (!known.has(token.value)) throw { kind: "unknown-parameter", name: token.value } satisfies SimulationExpressionError;
			position += 1;
			used.add(token.value);
			return { kind: "parameter", name: token.value };
		}
		if (token.type === "paren" && token.value === "(") {
			position += 1;
			const inner = parseExpression(depth + 1);
			const closing = peek();
			if (closing?.type !== "paren" || closing.value !== ")") throw { kind: "syntax", message: "A parenthesis is unclosed." } satisfies SimulationExpressionError;
			position += 1;
			return inner;
		}
		throw { kind: "syntax", message: "An operator appeared where a value was expected." } satisfies SimulationExpressionError;
	}

	try {
		const node = parseExpression(0);
		if (position !== tokens.length) return { ok: false, error: { kind: "syntax", message: "The expression has trailing input." } };
		return { ok: true, node, parameters: [...used] };
	} catch (error) {
		return { ok: false, error: error as SimulationExpressionError };
	}
}

/** True when `source` is a well-formed expression over `parameterIds`. */
export function isValidSimulationExpression(source: string, parameterIds: readonly string[]): boolean {
	return parseSimulationExpression(source, parameterIds).ok;
}

/**
 * Evaluate a parsed expression. Returns undefined rather than throwing for any
 * input that cannot produce a finite number, so a readout degrades to "no
 * value" instead of breaking the surface around it.
 */
export function evaluateSimulationExpression(
	node: SimulationExpressionNode,
	values: Readonly<Record<string, number>>,
): number | undefined {
	const result = evaluate(node, values);
	return result !== undefined && Number.isFinite(result) ? result : undefined;
}

function evaluate(node: SimulationExpressionNode, values: Readonly<Record<string, number>>): number | undefined {
	switch (node.kind) {
		case "number": return node.value;
		case "parameter": {
			const value = values[node.name];
			return typeof value === "number" && Number.isFinite(value) ? value : undefined;
		}
		case "unary": {
			const operand = evaluate(node.operand, values);
			return operand === undefined ? undefined : -operand;
		}
		case "binary": {
			const left = evaluate(node.left, values);
			const right = evaluate(node.right, values);
			if (left === undefined || right === undefined) return undefined;
			switch (node.operator) {
				case "+": return left + right;
				case "-": return left - right;
				case "*": return left * right;
				case "/": return right === 0 ? undefined : left / right;
				case "%": return right === 0 ? undefined : left % right;
				case "^": return safePower(left, right);
			}
		}
	}
}

function safePower(base: number, exponent: number): number | undefined {
	// Fractional powers of a negative base are complex, and huge exponents are a
	// cheap way to hang a render pass.
	if (base < 0 && !Number.isInteger(exponent)) return undefined;
	if (Math.abs(exponent) > 1024) return undefined;
	const result = base ** exponent;
	return Number.isFinite(result) ? result : undefined;
}
