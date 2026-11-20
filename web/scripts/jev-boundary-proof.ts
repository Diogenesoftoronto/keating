import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { CASES, calibratedCase, digest, REVIEW_MODEL, sha, TUTOR_MODEL, type BoundaryCase } from "./jev-boundary-cases";
import { runFlueCase } from "./jev-boundary-flue";
import { liveModels, MAX_CALLS, MAX_INPUT_TOKENS, MAX_TOTAL_TOKENS, MAX_MICROUSD, MAX_TUTOR_OUTPUT, offlineModels, openingWireOverlap, ProofLedger, relayOrigin } from "./jev-boundary-transport";

/** Run from the repository root. Preflight makes zero network calls. */
export async function main(args: string[]) {
  if (args.length === 1 && ["--help", "-h"].includes(args[0]!)) {
    console.log([
      "rtk bun web/scripts/jev-boundary-proof.ts --mode preflight --out DIRECTORY",
      "rtk bun web/scripts/jev-boundary-proof.ts --mode live --out DIRECTORY [--case under,at,over,current,dense] [--reviewer relay|direct] [--relay-base ORIGIN] [--max-microusd 800000]",
      "Preflight uses deterministic model fixtures and the real Flue and draft controller. Dense preflight supplies an explicit provider-overflow response.",
      "Live reads GEMINI_API_KEY and TYPESAFE_API_KEY. The default reviewer uses the production Keating BYOK relay. A loopback origin selects a running local relay.",
      "The default cases are under, at, over and current. Dense exercises provider-confirmed overflow with identifier-heavy text. Each invocation requires a fresh output directory.",
      "The live ledger reserves at most $0.80 across 40 HTTP calls, and retains full reservations for missing provider usage. Receipts contain hashes and typed checks.",
    ].join("\n"));
    return true;
  }
  const { values } = parseArgs({ args, options: {
    mode: { type: "string", default: "preflight" }, out: { type: "string" }, case: { type: "string", default: "under,at,over,current" },
    "max-microusd": { type: "string", default: String(MAX_MICROUSD) },
    reviewer: { type: "string", default: "relay" }, "relay-base": { type: "string", default: "https://chat.keating.help" },
  } });
  if (!values.out || !["preflight", "live"].includes(values.mode!) || !["relay", "direct"].includes(values.reviewer!)) {
    throw new Error("usage: --mode preflight|live --out DIRECTORY [--case under,at,over,current,dense] [--reviewer relay|direct] [--relay-base ORIGIN] [--max-microusd 800000]");
  }
  const kinds = values.case!.split(",");
  if (!kinds.length || kinds.some(value => !CASES.includes(value as BoundaryCase)) || new Set(kinds).size !== kinds.length) throw new Error("invalid-case");
  const mode = values.mode as "preflight" | "live", reviewer = values.reviewer as "relay" | "direct";
  const origin = relayOrigin(values["relay-base"]!);
  const codePaths = [
    "packages/learner-contracts/src/judgement/state-metrics.ts", "packages/learner-contracts/src/judgement/teaching-policy.ts",
    "packages/learner-contracts/src/judgement/teaching-policy-catalog.ts", "packages/learner-contracts/src/judgement/teaching-drafts/session.ts",
    "packages/learner-contracts/src/judgement/teaching-drafts/policy.ts", "packages/learner-contracts/src/judgement/system-one.ts",
    "web/src/keating/judgement/draft-gate.ts", "web/src/keating/judgement/search-evidence.ts", "web/src/keating/judgement/custom-backend.ts",
    "web/src/keating/flue/model-messages.ts", "web/server/api/judgement/typesafe.post.ts",
    ...["cases", "flue", "transport", "proof"].map(name => "web/scripts/jev-boundary-" + name + ".ts"),
  ];
  const sources = Object.fromEntries(codePaths.map(path => [path, sha(readFileSync(new URL("../../" + path, import.meta.url), "utf8"))]));
  const sourceHash = digest(sources);
  const dir = resolve(values.out);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (["summary.json", "ledger.json", ...kinds.map(key => key + ".json")].some(file => existsSync(resolve(dir, file)))) throw new Error("choose-fresh-output-directory");
  const save = (file: string, data: unknown) => {
    const path = resolve(dir, file + ".json"), tmp = path + ".tmp";
    writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 }); renameSync(tmp, path);
  };
  const ledger = new ProofLedger(Number(values["max-microusd"]), () => save("ledger", accounting()));
  function accounting(): Record<string, unknown> {
    return { capMicrousd: ledger.cap, maxCalls: MAX_CALLS, maxReservedInputTokens: MAX_INPUT_TOKENS, maxReservedTotalTokens: MAX_TOTAL_TOKENS, maxTutorOutputTokensPerCall: MAX_TUTOR_OUTPUT,
      dispatched: ledger.rows.length, denied: ledger.denied, accountedMicrousd: ledger.rows.reduce((sum, row) => sum + row.accountedMicrousd, 0),
      actualBilledMicrousd: null, rows: ledger.rows };
  }
  const results = [];
  // Claim the ledger before any billable dispatch, including simultaneous starts in the same output directory.
  writeFileSync(resolve(dir, "ledger.json"), JSON.stringify(accounting()), { flag: "wx", mode: 0o600 });
  save("ledger", accounting());
  for (const value of kinds) {
    const kind = value as BoundaryCase;
    const fixture = calibratedCase(kind);
    const engines = mode === "preflight" ? offlineModels(kind === "dense" ? fixture.full.stateHash : undefined) : liveModels(kind, ledger, reviewer, origin);
    const result = await runFlueCase(fixture, engines);
    const fromWire = ledger.rows.filter(row => row.case === kind);
    const successful = fromWire.filter(row => row.status !== null && row.status >= 200 && row.status < 300);
    const resolved = mode === "preflight" || kind === "current" ? fromWire.length === 0
      : successful.some(row => row.role === "tutor") && successful.some(row => row.role === "reviewer")
        && successful.every(row => row.role === "tutor" ? row.reportedModel?.replace(/^models\//, "") === TUTOR_MODEL : row.reportedModel === REVIEW_MODEL);
    const networkOverlapMs = openingWireOverlap(fromWire, result.tutorResponses.slice(0, 2).map(candidate => candidate.requestHash));
    const transportPass = mode === "preflight" || kind === "current" ? fromWire.length === 0
      : (networkOverlapMs ?? 0) > 0 && successful.filter(row => row.role === "reviewer").every(row => row.responseSha256 && row.endpoint)
        && result.requests.filter(request => request.ok).every(request => successful.some(row => row.role === "reviewer" && row.semanticRequestHash === request.requestHash));
    const passed = result.passed && resolved && transportPass;
    save(kind, { ...result, passed, sourceHash, providerIdentityConfirmed: mode === "live" && kind !== "current" ? resolved : null,
      networkOverlapMs, transportPass,
      transport: mode === "preflight" ? "offline" : reviewer === "direct" ? "typesafe-direct" : origin, wire: fromWire });
    results.push({ case: kind, passed, phase: result.final?.phase, checks: result.checked, providerRequests: fromWire.length, networkOverlapMs, transportPass });
    console.log(JSON.stringify(results.at(-1)));
  }
  const passed = results.every(row => row.passed) && ledger.denied === 0;
  save("summary", { mode, passed, sourceHash, localFileHashes: sources, results, accounting: accounting(), timestamp: new Date().toISOString() });
  return passed;
}

if (import.meta.main) {
  try { if (!await main(Bun.argv.slice(2))) process.exitCode = 1; }
  catch (error) {
    // Lower-level host/provider exceptions may contain input. Only print this CLI's safe validation codes.
    const message = error instanceof Error ? error.message : "";
    console.error(message.startsWith("usage:") || ["invalid-case", "unsupported-relay-origin", "invalid-cost-cap", "choose-fresh-output-directory",
      "fixture-calibration-failed", "missing-GEMINI_API_KEY-or-TYPESAFE_API_KEY"].includes(message) ? message : "proof-run-failed");
    process.exitCode = 1;
  }
}
