#!/usr/bin/env bun
/**
 * Keeps the three places that describe Not Organic configuration honest:
 *
 *   1. devenv.nix          -- non-secret defaults for the dev shell
 *   2. web/.env.example    -- the full variable list operators copy from
 *   3. web/src/notorganic-provider/OPERATIONS.md -- the deployment contract
 *
 * Documentation that drifts is worse than no documentation, because an operator
 * follows it and gets a 503 with no clue why. This fails the build when the code
 * reads a NOTORGANIC variable nobody documented, or when the three files
 * disagree.
 */
import { readFile } from "node:fs/promises";
import { Glob } from "bun";

const DEVENV = "devenv.nix";
const ENV_EXAMPLE = "web/.env.example";
const OPERATIONS = "web/src/notorganic-provider/OPERATIONS.md";

/** Variables the checker governs. Everything else is left alone. */
const GOVERNED = /^(?:VITE_)?NOTORGANIC[A-Z0-9_]*$/;

function governed(names: Iterable<string>): Set<string> {
	return new Set([...names].filter((name) => GOVERNED.test(name)));
}

function sorted(values: Iterable<string>): string[] {
	return [...values].sort();
}

/** Variables actually read by application code. */
async function readByCode(): Promise<Set<string>> {
	const found = new Set<string>();
	const patterns = [
		/process\.env\.([A-Z0-9_]+)/g,
		/process\.env\[["'`]([A-Z0-9_]+)["'`]\]/g,
		/import\.meta\.env\.([A-Z0-9_]+)/g,
		/\benv\.([A-Z0-9_]+)/g,
		/\benv\(["'`]([A-Z0-9_]+)["'`]\)/g,
		// Names passed as string literals to config helpers, e.g.
		// positiveIntegerEnv("NOTORGANIC_MAX_COST_MICROUSD", env).
		/["'`]((?:VITE_)?NOTORGANIC[A-Z0-9_]*)["'`]/g,
	];
	for (const root of ["web/src", "web/server"]) {
		const glob = new Glob("**/*.{ts,tsx}");
		for await (const file of glob.scan({ cwd: root })) {
			// Tests deliberately set these to exercise disabled/enabled paths.
			if (file.includes("/test/") || file.endsWith(".test.ts")) continue;
			const source = await readFile(`${root}/${file}`, "utf8");
			for (const pattern of patterns) {
				for (const match of source.matchAll(pattern)) found.add(match[1]);
			}
		}
	}
	return governed(found);
}

async function declaredInDevenv(): Promise<Set<string>> {
	const source = await readFile(DEVENV, "utf8");
	const block = source.match(/\n\s*env\s*=\s*\{([\s\S]*?)\n\s*\};/);
	if (!block) throw new Error(`${DEVENV}: no "env = { ... }" block found.`);
	return governed(
		[...block[1].matchAll(/^\s*([A-Z0-9_]+)\s*=/gm)].map((match) => match[1]),
	);
}

async function declaredInEnvExample(): Promise<Set<string>> {
	const source = await readFile(ENV_EXAMPLE, "utf8");
	return governed(
		[...source.matchAll(/^([A-Z0-9_]+)=/gm)].map((match) => match[1]),
	);
}

async function documentedInOperations(): Promise<Set<string>> {
	const source = await readFile(OPERATIONS, "utf8");
	return governed([...source.matchAll(/\b((?:VITE_)?NOTORGANIC[A-Z0-9_]*)\b/g)].map((m) => m[1]));
}

function report(
	problems: string[],
	label: string,
	missing: Set<string>,
	where: string,
	fix: string,
): void {
	if (missing.size === 0) return;
	problems.push(
		`${label}\n  missing from ${where}: ${sorted(missing).join(", ")}\n  fix: ${fix}`,
	);
}

function difference(a: Set<string>, b: Set<string>): Set<string> {
	return new Set([...a].filter((value) => !b.has(value)));
}

const [code, devenv, example, operations] = await Promise.all([
	readByCode(),
	declaredInDevenv(),
	declaredInEnvExample(),
	documentedInOperations(),
]);

const problems: string[] = [];

report(
	problems,
	"Code reads Not Organic variables that operators cannot discover.",
	difference(code, example),
	ENV_EXAMPLE,
	`document each variable in ${ENV_EXAMPLE}.`,
);
report(
	problems,
	"Not Organic variables are undocumented in the deployment contract.",
	difference(example, operations),
	OPERATIONS,
	`describe each variable in ${OPERATIONS}.`,
);
report(
	problems,
	"The dev shell declares variables that are absent from the example file.",
	difference(devenv, example),
	ENV_EXAMPLE,
	`add them to ${ENV_EXAMPLE}, or drop them from ${DEVENV}.`,
);
report(
	problems,
	"The example file declares variables the dev shell does not default.",
	difference(example, devenv),
	DEVENV,
	`add a non-secret default to the env block in ${DEVENV}.`,
);

if (problems.length > 0) {
	console.error("Not Organic configuration documentation is out of date.\n");
	for (const problem of problems) console.error(`- ${problem}\n`);
	process.exit(1);
}

console.log(
	`Not Organic configuration docs agree across ${DEVENV}, ${ENV_EXAMPLE}, and ${OPERATIONS}.\n` +
		`  variables: ${sorted(code).join(", ") || "(none read by code)"}`,
);
