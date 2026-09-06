import type { UiCodingChallengeNode } from "@keating/learner-contracts";

export interface CodingCaseResult {
	id: string;
	passed: boolean;
	actual?: unknown;
	error?: string;
}

export interface CodingRunResult {
	cases: CodingCaseResult[];
	durationMs: number;
}

export function buildCodingProgram(code: string, entrypoint: string, tests: UiCodingChallengeNode["tests"]): string {
	if (!/^[A-Za-z_$][\w$]*$/.test(entrypoint)) throw new Error("The exercise needs a valid function name.");
	return `"use strict";
const __keatingSend = self.postMessage.bind(self);
const __keatingStart = performance.now();
const exports = {};
const module = { exports };
${code}
;
(async () => {
  const solve = typeof ${entrypoint} === "function" ? ${entrypoint} : module.exports[${JSON.stringify(entrypoint)}];
  if (typeof solve !== "function") throw new Error(${JSON.stringify(`Define a function named ${entrypoint}.`)});
  const cases = ${JSON.stringify(tests)};
  const same = (a, b) => {
    if (a === b) return true;
    if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && same(a[key], b[key]));
  };
  const results = [];
  for (const item of cases) {
    try {
      const value = await solve(...structuredClone(item.args));
      const serialized = JSON.stringify(value);
      const actual = serialized === undefined ? "undefined" : serialized.length > 2048 ? serialized.slice(0, 2048) + "…" : JSON.parse(serialized);
      results.push({ id: item.id, passed: same(value, item.expected), actual });
    } catch (error) {
      results.push({ id: item.id, passed: false, error: String(error instanceof Error ? error.message : error).slice(0, 400) });
    }
  }
  __keatingSend({ kind: "result", cases: results, durationMs: Math.round(performance.now() - __keatingStart) });
})().catch(error => __keatingSend({ kind: "error", message: String(error.message || error).slice(0, 400) }));`;
}

/** Only trusted transport code executes in this opaque iframe. Learner code is a Worker script. */
export const CODING_RUNNER_DOCUMENT = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; worker-src blob:; connect-src 'none'"><script>
let running = false;
addEventListener("message", event => {
  if (event.source !== parent || running || typeof event.data?.program !== "string" || typeof event.data?.token !== "string") return;
  running = true;
  const token = event.data.token;
  const send = data => parent.postMessage({ token, ...data }, "*");
  const url = URL.createObjectURL(new Blob([event.data.program], { type: "text/javascript" }));
  let worker;
  try {
    worker = new Worker(url);
    const timer = setTimeout(() => { worker.terminate(); send({ kind: "error", message: "Time limit reached. Check for a loop that never ends." }); }, 3000);
    worker.onmessage = event => { clearTimeout(timer); worker.terminate(); send(event.data); };
    worker.onerror = event => { clearTimeout(timer); worker.terminate(); send({ kind: "error", message: event.message || "The program could not run." }); };
  } catch (error) { send({ kind: "error", message: error.message || "This browser could not start the code runner." }); }
  URL.revokeObjectURL(url);
});
parent.postMessage({ kind: "coding-ready" }, "*");
</script>`;

export async function runCodingChallenge(node: UiCodingChallengeNode, source: string, signal?: AbortSignal): Promise<CodingRunResult> {
	let code = source;
	if (node.language === "typescript") {
		const { transpileTsToJs } = await import("../../keating/nodepod-runtime");
		code = await transpileTsToJs(source, "exercise.ts");
	}
	if (signal?.aborted) throw new DOMException("Run stopped", "AbortError");
	const program = buildCodingProgram(code, node.entrypoint, node.tests);
	return new Promise((resolve, reject) => {
		const frame = document.createElement("iframe");
		frame.setAttribute("sandbox", "allow-scripts");
		frame.setAttribute("aria-hidden", "true");
		frame.hidden = true;
		frame.title = "Isolated coding exercise runner";
		const token = crypto.randomUUID();
		let settled = false;
		const cleanup = () => {
			window.clearTimeout(timer);
			window.removeEventListener("message", receive);
			signal?.removeEventListener("abort", abort);
			frame.remove();
		};
		const fail = (error: Error) => { if (!settled) { settled = true; cleanup(); reject(error); } };
		const abort = () => fail(new DOMException("Run stopped", "AbortError"));
		const receive = (event: MessageEvent) => {
			if (event.source !== frame.contentWindow) return;
			if (event.data?.kind === "coding-ready") { frame.contentWindow?.postMessage({ token, program }, "*"); return; }
			if (event.data?.token !== token || settled) return;
			if (event.data.kind === "error") { fail(new Error(String(event.data.message).slice(0, 400))); return; }
			if (event.data.kind !== "result" || !Array.isArray(event.data.cases)) return;
			const cases = event.data.cases as CodingCaseResult[];
			if (cases.length !== node.tests.length || cases.some((item, index) => item?.id !== node.tests[index]?.id || typeof item.passed !== "boolean")) { fail(new Error("The runner returned incomplete test results.")); return; }
			settled = true;
			cleanup();
			resolve({ cases, durationMs: Number.isFinite(event.data.durationMs) ? event.data.durationMs : 0 });
		};
		const timer = window.setTimeout(() => fail(new Error("The code runner did not respond. Try again.")), 8000);
		window.addEventListener("message", receive);
		signal?.addEventListener("abort", abort, { once: true });
		frame.srcdoc = CODING_RUNNER_DOCUMENT;
		document.body.append(frame);
	});
}
