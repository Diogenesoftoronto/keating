import { readFileSync } from "node:fs";
import { parseOpenUiDiagnosticExport, type OpenUiDiagnosticTurn } from "../../packages/learner-contracts/src/openui-diagnostics.js";

const PROJECT_QUERY_URL = "https://us.posthog.com/api/projects/473463/query/";
const HOSTS = ["keating.help", "chat.keating.help"];
const PROPERTIES = [
  "diagnostic_schema", "diagnostic_revision", "conversation_id", "turn_id", "turn_index", "model", "decision_mode",
  "cue_kind", "cue_targets", "cue_repeat", "reply_outcome", "ui_attempted", "compiled_components", "selected_components",
  "rendered_components", "guidance_source", "guidance_action", "guidance_delivered", "guidance_targets",
  "draft_attempts", "gate_issues", "decision_model", "outside_words", "native_page_requested", "reply_elapsed_ms", "native_page", "guidance_reason",
  "requested_model", "editable_code", "cue_code_language", "guidance_code_language", "editor_outside_words", "coding_challenge_languages", "draft_selection",
  "assessment_opt_out", "assessment_checkpoints", "draft_pair_reviews", "draft_final_comparison",
] as const;
const COLUMNS = [...PROPERTIES, "observation_host", "observation_version", "observation_second", "total_turns"];
type Property = typeof PROPERTIES[number];

export interface OpenUiFleetScope { from: string; until: string; appVersion: string; maxTurns?: number }

function instant(text: string): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text) ? text + "T00:00:00Z" : text;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(date) || !Number.isFinite(Date.parse(date))
    || new Date(date).toISOString().replace(".000Z", "Z") !== date) {
    throw new Error("Use a UTC date or a UTC timestamp with whole seconds.");
  }
  return date;
}

function validateScope(scope: OpenUiFleetScope) {
  const from = instant(scope.from), until = instant(scope.until);
  if (until <= from) throw new Error("The end of the window must be after the start.");
  if (!/^[0-9a-zA-Z][0-9a-zA-Z.+_-]{0,63}$/.test(scope.appVersion)) throw new Error("Invalid app version.");
  const maxTurns = scope.maxTurns ?? 1000;
  if (!Number.isInteger(maxTurns) || maxTurns < 1 || maxTurns > 5000) throw new Error("Use a turn limit between 1 and 5000.");
  return { from, until, appVersion: scope.appVersion, maxTurns };
}

/** One read-only HogQL query. Rank whole snapshots before projecting nullable measurements. */
export function openUiFleetSql(scope: OpenUiFleetScope): string {
  const { from, until, appVersion, maxTurns } = validateScope(scope);
  const sqlTime = (iso: string) => "toDateTime('" + iso.slice(0, 19).replace("T", " ") + "', 'UTC')";
  const properties = PROPERTIES.map(key => "        JSONExtractRaw(properties, '" + key + "') AS " + key);
  return [
    "SELECT", "    " + [...PROPERTIES, "observation_host", "observation_version", "observation_second", "count() OVER () AS total_turns"].join(",\n    "),
    "FROM (", "    SELECT", ...properties.map(expr => expr + ","),
    "        JSONExtractString(properties, '$host') AS observation_host,",
    "        JSONExtractString(properties, 'app_version') AS observation_version,",
    "        toUnixTimestamp(timestamp) AS observation_second,",
    "        row_number() OVER (",
    "            PARTITION BY JSONExtractString(properties, 'conversation_id'), JSONExtractString(properties, 'turn_id')",
    "            ORDER BY toInt64OrNull(JSONExtractRaw(properties, 'diagnostic_revision')) DESC NULLS FIRST, timestamp DESC, uuid DESC",
    "        ) AS snapshot_rank",
    "    FROM events",
    "    WHERE event = 'openui_turn_observed'",
    "      AND JSONExtractString(properties, '$host') IN ('keating.help', 'chat.keating.help')",
    "      AND JSONExtractString(properties, 'app_version') = '" + appVersion + "'",
    "      AND timestamp >= " + sqlTime(from) + " AND timestamp < " + sqlTime(until),
    ")", "WHERE snapshot_rank = 1", "ORDER BY conversation_id, turn_id", "LIMIT " + (maxTurns + 1),
  ].join("\n");
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readRaw(value: unknown): unknown {
  if (value === "" || value === null) return null; // Missing nullable event properties are unobserved.
  if (typeof value !== "string") throw new Error("Expected a raw JSON property from the bounded fleet query.");
  try { return JSON.parse(value); }
  catch { throw new Error("Invalid raw JSON in a diagnostic property."); }
}

function fromProperties(fields: Record<Property, unknown>): OpenUiDiagnosticTurn {
  const p = fields;
  if (typeof p.diagnostic_revision !== "number" || !Number.isSafeInteger(p.diagnostic_revision) || p.diagnostic_revision < 1) {
    throw new Error("Invalid diagnostic revision.");
  }
  const noGuidance = [p.guidance_source, p.guidance_action, p.guidance_delivered, p.guidance_targets, p.guidance_reason, p.guidance_code_language].every(v => v === null);
  const row = {
    schemaVersion: p.diagnostic_schema, conversationId: p.conversation_id, turnId: p.turn_id, turnIndex: p.turn_index,
    model: p.model, mode: p.decision_mode, ...(p.requested_model === null ? {} : { requestedModel: p.requested_model }),
    cue: { kind: p.cue_kind, targets: p.cue_targets, ...(p.cue_repeat === null ? {} : { repeat: p.cue_repeat }),
      ...(p.cue_code_language === null ? {} : { codeLanguage: p.cue_code_language }) },
    reply: p.reply_outcome, replyElapsedMs: p.reply_elapsed_ms, attempted: p.ui_attempted,
    compiled: p.compiled_components, selected: p.selected_components, rendered: p.rendered_components,
    guidance: noGuidance ? null : { source: p.guidance_source, action: p.guidance_action,
      delivered: p.guidance_delivered, targets: p.guidance_targets, ...(p.guidance_reason === null ? {} : { reason: p.guidance_reason }),
      ...(p.guidance_code_language === null ? {} : { codeLanguage: p.guidance_code_language }) },
    ...(p.draft_attempts === null ? {} : { draftAttempts: p.draft_attempts }),
    ...(p.draft_selection === null ? {} : { selection: p.draft_selection }),
    ...(p.draft_pair_reviews === null ? {} : { pairReviews: p.draft_pair_reviews }),
    ...(p.draft_final_comparison === null ? {} : { finalComparison: p.draft_final_comparison }),
    ...(p.gate_issues === null ? {} : { gateIssues: p.gate_issues }),
    decisionModel: p.decision_model, outsideWords: p.outside_words, nativePageRequested: p.native_page_requested,
    ...(p.native_page === null ? {} : {nativePage: p.native_page}),
    ...(p.editable_code === null ? {} : {editableCode: p.editable_code}),
    ...(p.coding_challenge_languages === null ? {} : {codingChallengeLanguages: p.coding_challenge_languages}),
    ...(p.editor_outside_words === null ? {} : {editorOutsideWords: p.editor_outside_words}),
    // The checkpoint list alone cannot say what the learner asked for.
    ...(p.assessment_opt_out === null ? {} : {assessment: {optOut: p.assessment_opt_out, checkpoints: p.assessment_checkpoints}}),
  };
  return parseOpenUiDiagnosticExport([row])[0]!;
}

/** Accept only this query's column set and complete results. Never copy arbitrary event properties. */
export function openUiFleetExport(response: unknown, scope: OpenUiFleetScope) {
  const { from, until, appVersion, maxTurns } = validateScope(scope);
  if (!object(response) || !Array.isArray(response.results) || !Array.isArray(response.columns)) {
    throw new Error("Expected the complete diagnostic HogQL result with its original column names.");
  }
  const { results, columns } = response;
  const beforeRequestedModel = COLUMNS.filter(key => key !== "requested_model");
  const beforeFinalComparison = beforeRequestedModel.filter(key => key !== "draft_final_comparison");
  const beforePairReviews = beforeFinalComparison.filter(key => key !== "draft_pair_reviews");
  const beforeAssessment = beforePairReviews.filter(key => key !== "assessment_opt_out" && key !== "assessment_checkpoints");
  const beforeSelection = beforeAssessment.filter(key => key !== "draft_selection");
  const beforeChallenges = beforeSelection.filter(key => key !== "coding_challenge_languages");
  const beforeWords = beforeChallenges.filter(key => key !== "editor_outside_words");
  const beforeCode = beforeWords.filter(key => !["editable_code", "cue_code_language", "guidance_code_language"].includes(key));
  const beforeNative = beforeCode.filter(key => key !== "native_page" && key !== "guidance_reason");
  const schemas = [COLUMNS, beforeRequestedModel, beforeFinalComparison, beforePairReviews, beforeAssessment, beforeSelection, beforeChallenges, beforeWords, beforeCode, beforeNative, beforeNative.filter(key => key !== "reply_elapsed_ms")];
  if (!schemas.some(expected => columns.length === expected.length && expected.every(key => columns.includes(key)))) {
    throw new Error("Expected the complete diagnostic HogQL result with its original column names.");
  }
  if (response.hasMore || response.has_more || response.next || results.length > maxTurns) {
    throw new Error("Incomplete fleet export. Narrow the UTC window and run again.");
  }
  const fromSecond = Date.parse(from) / 1000, untilSecond = Date.parse(until) / 1000;
  const idx = new Map(columns.map((key, i) => [key, i]));
  const turns: OpenUiDiagnosticTurn[] = [];
  const ids = new Set<string>(), positions = new Set<string>();
  for (const entry of results) {
    if (!Array.isArray(entry) || entry.length !== columns.length) throw new Error("Incomplete diagnostic result row.");
    const get = (name: string): unknown => entry[idx.get(name)!];
    if (Number(get("total_turns")) !== results.length) throw new Error("Incomplete fleet export. Narrow the UTC window and run again.");
    const second = Number(get("observation_second"));
    if (!HOSTS.includes(String(get("observation_host"))) || get("observation_version") !== appVersion
      || !Number.isSafeInteger(second) || second < fromSecond || second >= untilSecond) throw new Error("Snapshot outside the requested production scope.");
    const values = Object.fromEntries(PROPERTIES.map(key => [key, idx.has(key) ? readRaw(get(key)) : null])) as Record<Property, unknown>;
    const turn = fromProperties(values);
    const id = JSON.stringify([turn.conversationId, turn.turnId]), position = JSON.stringify([turn.conversationId, turn.turnIndex]);
    if (ids.has(id) || positions.has(position)) throw new Error("Conflicting turn identities in ranked fleet result.");
    ids.add(id);
    positions.add(position);
    turns.push(turn);
  }
  turns.sort((a, b) => a.conversationId.localeCompare(b.conversationId) || a.turnIndex - b.turnIndex);
  return { schemaVersion: 1 as const, turns };
}

const USAGE = "Usage: bun scripts/openui-diagnostics/from-posthog.ts --from <UTC> --until <UTC> --app-version <version> [--max-turns N] [--sql | --input <query-result.json|->]";

async function main(args: string[]) {
  if (args.includes("--help")) { console.log(USAGE); return; }
  const values = new Map<string, string>();
  let sqlOnly = false;
  for (let i = 0; i < args.length; i++) {
    const key = args[i]!;
    if (key === "--sql" && !sqlOnly) { sqlOnly = true; continue; }
    const value = args[++i];
    if (!["--from", "--until", "--app-version", "--max-turns", "--input"].includes(key) || values.has(key) || !value || value.startsWith("--")) throw new Error(USAGE);
    values.set(key, value);
  }
  if (!values.has("--from") || !values.has("--until") || !values.has("--app-version") || (sqlOnly && values.has("--input"))) throw new Error(USAGE);
  const scope = { from: values.get("--from")!, until: values.get("--until")!, appVersion: values.get("--app-version")!,
    maxTurns: values.has("--max-turns") ? Number(values.get("--max-turns")) : undefined };
  const query = openUiFleetSql(scope);
  if (sqlOnly) { console.log(query); return; }
  let response: unknown;
  const input = values.get("--input");
  if (input) {
    const raw = readFileSync(input === "-" ? 0 : input, "utf8");
    try { response = JSON.parse(raw); }
    catch { throw new Error("Input is not a JSON query result."); }
  } else {
    const credential = process.env.POSTHOG_PERSONAL_API_KEY;
    if (!credential) throw new Error("Set POSTHOG_PERSONAL_API_KEY for project 473463 with query:read permission, or use --sql.");
    const http = await fetch(PROJECT_QUERY_URL, { method: "POST", redirect: "error", signal: AbortSignal.timeout(60_000),
      headers: { Authorization: "Bearer " + credential, "Content-Type": "application/json" },
      body: JSON.stringify({ query: { kind: "HogQLQuery", query } }) });
    if (!http.ok) throw new Error("PostHog query failed with HTTP " + http.status + ".");
    response = await http.json();
  }
  console.log(JSON.stringify(openUiFleetExport(response, scope)));
}

if (import.meta.main) main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Fleet export failed.");
  process.exitCode = 1;
});
