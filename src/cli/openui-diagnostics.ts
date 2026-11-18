import { readFileSync } from "node:fs";
import {
  OPENUI_DIAGNOSTIC_CUES, OPENUI_DIAGNOSTIC_EXPORT_SCHEMA, OPENUI_DIAGNOSTIC_MODES,
  parseOpenUiDiagnosticExport, queryOpenUiDiagnosticTurns,
} from "../../packages/learner-contracts/src/openui-diagnostics.js";

const usage = [
  "keating openui-diagnostics <export.json|-> [--model ID] [--decision-model ID] [--mode MODE] [--cue KIND] [--experiment ID] [--view summary|unmet|combined-unmet|action-unmet|native|editable-code|draft-loss|render-loss|withheld|released-drafts|assessment-opt-out] [--limit N]",
  "keating openui-diagnostics schema",
  "",
  "Print JSON describing interface use, matched trigger-to-response delays and declared experiment pairs.",
  "Pass - to read a JSON export from standard input. Optional filters select the triggering turn.",
  "Turn views return the total matching turns and up to N examples (default 10, range 1–50).",
  "Use --view unmet to find learner cues missed on the same turn. Unobserved selections have a separate count.",
  "Use --view native for public page requests and outcome evidence, or --view combined-unmet for known misses across both sources.",
  "Use --view assessment-opt-out for released replies with a checkpoint signal after an explicit learner opt-out.",
  "Modes: " + OPENUI_DIAGNOSTIC_MODES.join(", "),
  "Cues: " + OPENUI_DIAGNOSTIC_CUES.join(", "),
  "",
  "From the repository root",
  "  rtk bun src/cli/main.ts openui-diagnostics web/src/keating/openui/examples/november-audit.json --cue implicit-action --view unmet --limit 2",
].join("\n");

export function runOpenUiDiagnosticCommand(args: string[]): void {
  if (args.includes("--help") || args.includes("-h")) { console.log(usage); return; }
  if (args.length === 1 && args[0] === "schema") {
    console.log(JSON.stringify(OPENUI_DIAGNOSTIC_EXPORT_SCHEMA, null, 2));
    return;
  }
  const [filename, ...options] = args;
  if (!filename || filename.startsWith("--") || filename === "schema") throw new Error(usage);
  const query: Record<string, unknown> = {};
  let experimentId: string | undefined;
  const seen = new Set<string>();
  for (let i = 0; i < options.length; i++) {
    const option = options[i]!;
    const equals = option.indexOf("=");
    const name = equals === -1 ? option : option.slice(0, equals);
    const value = equals === -1 ? options[++i] : option.slice(equals + 1);
    if (!value || value.startsWith("--") || seen.has(name)) throw new Error(usage);
    seen.add(name);
    if (name === "--experiment") experimentId = value;
    else if (name === "--decision-model") query.decisionModel = value;
    else if (name === "--limit") query.limit = /^\d+$/.test(value) ? Number(value) : NaN;
    else if (["--model", "--mode", "--cue", "--view"].includes(name)) query[name.slice(2)] = value;
    else throw new Error(usage);
  }
  const raw = readFileSync(filename === "-" ? 0 : filename, "utf8");
  let json: unknown;
  try { json = JSON.parse(raw); } catch { throw new Error("The diagnostic export contains invalid JSON."); }
  console.log(JSON.stringify(queryOpenUiDiagnosticTurns(parseOpenUiDiagnosticExport(json), query, experimentId), null, 2));
}
