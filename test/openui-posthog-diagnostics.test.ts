import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { openUiFleetExport, openUiFleetSql, type OpenUiFleetScope } from "../scripts/openui-diagnostics/from-posthog.js";
import { openUIDiagnosticEvent } from "../web/src/keating/openui/turn-diagnostics.js";
import { parseOpenUiDiagnosticExport, summarizeOpenUiDiagnostics, type OpenUiDiagnosticTurn } from "../packages/learner-contracts/src/openui-diagnostics.js";

const scope = { from: "2026-11-11", until: "2026-11-18", appVersion: "4.2.0" };
const start = Date.parse(scope.from) / 1000;
const row = (index: number, fields: Partial<OpenUiDiagnosticTurn> = {}): OpenUiDiagnosticTurn => ({
  schemaVersion: 1, conversationId: "classroom", turnId: "learner-" + index, turnIndex: index, model: "tutor",
  mode: "guided", cue: { kind: "implicit-action", targets: ["question"] }, reply: "released", attempted: true,
  compiled: ["question"], selected: ["question"], rendered: null,
  guidance: { source: "jev", action: "create", delivered: true, targets: ["question"] },
  draftAttempts: 2, gateIssues: ["stop_after_checkpoint"], decisionModel: "jev-1.13.0", outsideWords: null, nativePageRequested: null,
  replyElapsedMs: null, ...fields,
});

function snapshot(turn: OpenUiDiagnosticTurn, revision: number, options: { host?: string; version?: string;
  event?: string; at?: number; uuid?: string; properties?: Record<string, unknown> } = {}) {
  return {
    event: options.event ?? "openui_turn_observed", at: options.at ?? start, uuid: options.uuid ?? "0001",
    properties: { ...openUIDiagnosticEvent(turn, revision), $host: options.host ?? "chat.keating.help",
      app_version: options.version ?? scope.appVersion, ...options.properties },
  };
}

// Execute the exact exporter SQL using SQLite's window engine and the subset of HogQL scalar functions it uses.
function query(events: ReturnType<typeof snapshot>[], options: OpenUiFleetScope = scope) {
  const db = new Database(":memory:");
  try {
    db.run("CREATE TABLE events (event TEXT, properties TEXT, timestamp INTEGER, uuid TEXT)");
    db.function("JSONExtractRaw", (value, key) => JSON.stringify(JSON.parse(String(value))[String(key)]) ?? "");
    db.function("JSONExtractString", (value, key) => JSON.parse(String(value))[String(key)] ?? "");
    db.function("toInt64OrNull", value => /^-?\d+$/.test(String(value)) ? Number(value) : null);
    db.function("toUnixTimestamp", value => Number(value));
    db.function("toDateTime", (value, _zone) => Date.parse(String(value).replace(" ", "T") + "Z") / 1000);
    const insert = db.prepare("INSERT INTO events VALUES (?, ?, ?, ?)");
    for (const e of events) insert.run(e.event, JSON.stringify(e.properties), e.at, e.uuid);
    const stmt = db.query(openUiFleetSql(options));
    return { results: stmt.values(), columns: stmt.columnNames };
  } finally { db.close(); }
}

describe("read-only Keating fleet diagnostics", () => {
  test("ranks complete snapshots by numeric revision, time, UUID and enforces both hosts, version and half-open UTC range", () => {
    const winner = row(0, { rendered: ["question"], outsideWords: 0 });
    const pending = row(1, { reply: "pending", attempted: null, compiled: null, selected: null, rendered: null,
      cue: { kind: "explicit-interface", targets: ["question"], repeat: true }, guidance: null });
    const events = [
      snapshot(row(0, { rendered: [] }), 9, { at: start + 4 }),
      snapshot(winner, 10, { at: start + 1, uuid: "2" }),
      snapshot(row(0, { rendered: ["deck"] }), 10, { at: start + 1, uuid: "1" }),
      snapshot(row(0, { rendered: ["quiz"] }), 10, { at: start, uuid: "9" }),
      snapshot(pending, 77, { host: "keating.help", properties: { privateSentinel: "must-stay-local" } }),
      snapshot(row(1), 76), snapshot(row(2), 11, { host: "preview.keating.help" }),
      snapshot(row(3), 11, { version: "4.2.1" }), snapshot(row(4), 11, { event: "other" }),
      snapshot(row(5), 11, { at: Date.parse(scope.until) / 1000 }), snapshot(row(6), 11, { at: start - 1 }),
    ];
    const output = openUiFleetExport(query(events), scope);
    expect(output.turns).toEqual([{ ...winner, cue: { ...winner.cue, repeat: false } }, pending]);
    expect(JSON.stringify(output)).not.toContain("must-stay-local");
    expect(parseOpenUiDiagnosticExport(output)).toHaveLength(2);
    expect(summarizeOpenUiDiagnostics(output.turns).overall.rendered).toMatchObject({ numerator: 1, denominator: 1, unknown: 1 });
    expect(summarizeOpenUiDiagnostics(output.turns).overall.proseBesideInterface).toEqual({ observed: 1, unknown: 0, median: 0, p90: 0 });
  });
  test("keeps measured false, empty arrays, missing older optional fields and unavailable stages distinct", () => {
    const empty = row(0, { attempted: false, compiled: [], selected: [], rendered: null, gateIssues: [],
      guidance: null, decisionModel: null, cue: { kind: "direct-text", targets: [] } });
    const response = query([snapshot(empty, 1, { properties: { cue_repeat: undefined, rendered_components: undefined,
      outside_words: undefined, native_page_requested: undefined } })]);
    expect(openUiFleetExport(response, scope).turns).toEqual([empty]);
    expect(openUiFleetExport(query([]), scope)).toEqual({ schemaVersion: 1, turns: [] });
  });
  test("keeps a native proposal, a known absence and unavailable older public-tool evidence distinct", () => {
    const events = [
      snapshot(row(0, { nativePageRequested: true, compiled: [], selected: [], rendered: null }), 3),
      snapshot(row(1, { nativePageRequested: false, selected: ["question"] }), 4),
      snapshot(row(2), 5, { properties: { native_page_requested: undefined } }),
    ];
    const output = openUiFleetExport(query(events), scope).turns;
    expect(output.map(turn => turn.nativePageRequested)).toEqual([true, false, null]);
    expect(summarizeOpenUiDiagnostics(output).overall.nativePageRequested).toEqual({ numerator: 1, denominator: 2, unknown: 1, rate: 0.5 });
    expect(output[0]!.selected).toEqual([]);
  });
  test("preserves measured zero and withheld duration, and reads both old events and saved pre-timing query results", () => {
    const observed = query([snapshot(row(0, { replyElapsedMs: 0 }), 2), snapshot(row(1, { reply: "withheld", model:null, requestedModel:"minimax/requested-tutor", replyElapsedMs: 1234 }), 4),
      snapshot(row(2), 1, { properties: { reply_elapsed_ms: undefined } })]);
    expect(observed.columns).toHaveLength(42);
    const rows = openUiFleetExport(observed, scope).turns;
    expect(rows[1]).toMatchObject({model:null, requestedModel:"minimax/requested-tutor"});
    expect(rows.map(r => r.replyElapsedMs)).toEqual([0, 1234, null]);
    expect(summarizeOpenUiDiagnostics(rows).overall.replyElapsedMs).toEqual({ observed: 2, unknown: 1, median: 617, p90: 1234 });
    const omit = (...fields: string[]) => ({ columns: observed.columns.filter(key => !fields.includes(key)),
      results: observed.results.map(r => r.filter((_, i) => !fields.includes(observed.columns[i]!))) });
    const beforeRequestedModel = omit("requested_model");
    expect(beforeRequestedModel.columns).toHaveLength(41);
    expect(openUiFleetExport(beforeRequestedModel, scope).turns.every(r => r.requestedModel === undefined)).toBe(true);
    const pairsOnly = omit("requested_model", "draft_final_comparison");
    expect(pairsOnly.columns).toHaveLength(40);
    expect(openUiFleetExport(pairsOnly, scope).turns.every(r => r.finalComparison === undefined)).toBe(true);
    const beforePairs = omit("requested_model", "draft_pair_reviews", "draft_final_comparison");
    expect(beforePairs.columns).toHaveLength(39);
    expect(openUiFleetExport(beforePairs, scope).turns.every(r => r.pairReviews === undefined)).toBe(true);
    const assessment = ["requested_model", "draft_final_comparison", "draft_pair_reviews", "assessment_opt_out", "assessment_checkpoints"];
    const beforeAssessment = omit(...assessment);
    expect(beforeAssessment.columns).toHaveLength(37);
    expect(openUiFleetExport(beforeAssessment, scope).turns.every(r => r.assessment === undefined)).toBe(true);
    const beforeSelection = omit(...assessment, "draft_selection");
    expect(beforeSelection.columns).toHaveLength(36);
    expect(openUiFleetExport(beforeSelection, scope).turns.every(r => r.selection === undefined)).toBe(true);
    const beforeChallenges = omit(...assessment, "draft_selection", "coding_challenge_languages");
    expect(beforeChallenges.columns).toHaveLength(35);
    expect(openUiFleetExport(beforeChallenges,scope).turns.every(r=>r.codingChallengeLanguages === undefined)).toBe(true);
    const beforeWords = omit(...assessment, "draft_selection","coding_challenge_languages","editor_outside_words");
    expect(beforeWords.columns).toHaveLength(34);
    expect(openUiFleetExport(beforeWords,scope).turns.every(r=>r.editorOutsideWords === undefined)).toBe(true);
    const code = [...assessment, "draft_selection", "editable_code", "cue_code_language", "guidance_code_language","editor_outside_words","coding_challenge_languages"];
    const beforeCode = omit(...code);
    expect(beforeCode.columns).toHaveLength(31);
    expect(openUiFleetExport(beforeCode, scope).turns.every(r => r.editableCode === undefined)).toBe(true);
    const previous = omit(...code, "native_page", "guidance_reason");
    expect(previous.columns).toHaveLength(29);
    expect(openUiFleetExport(previous, scope).turns.map(r => [r.replyElapsedMs, r.nativePage])).toEqual([[0, undefined], [1234, undefined], [null, undefined]]);
    const legacy = omit(...code, "native_page", "guidance_reason", "reply_elapsed_ms");
    expect(legacy.columns).toHaveLength(28);
    expect(openUiFleetExport(legacy, scope).turns.map(r => r.replyElapsedMs)).toEqual([null, null, null]);
  });
  test("retains native execution, mixed presentation evidence and a plan reason with no offered targets", () => {
    const native = row(0, { nativePageRequested: true, selected: [], rendered: [], cue: {kind:"implicit-action", targets:["question"], repeat:false}, nativePage: {
      succeeded: true, failed: false, attached: true, saved: true, mounted: true, ready: true, visible: null, opened: false, frameFailed: false },
      guidance: { source: "jev", action: "none", targets: [], delivered: false, reason: "plain-reply" } });
    expect(openUiFleetExport(query([snapshot(native, 2)]), scope).turns).toEqual([native]);
    expect(() => openUiFleetExport(query([snapshot(native, 2, {properties:{native_page:{...native.nativePage, html:"private"}}})]), scope)).toThrow("Invalid OpenUI");
    expect(() => openUiFleetExport(query([snapshot(native, 2, {properties:{guidance_reason:"raw text"}})]), scope)).toThrow("Invalid OpenUI");
  });
  test("round trips only a released, bounded selection and preserves unknown historical rules", () => {
    const outcomes = [row(0, {selection:{attempt:2, review:"verified", rule:"requested-prediction-over-prose"}}),
      row(1, {selection:{attempt:1, review:"best-effort", rule:"presentation-only-checkpoint-retained"}}),
      row(2, {selection:{attempt:2, review:"best-effort"}}), row(3)];
    expect(openUiFleetExport(query(outcomes.map(turn => snapshot(turn, 2))), scope).turns.map(r => r.selection))
      .toEqual(outcomes.map(r => r.selection));
    for (const bad of [{attempt:0,review:"best-effort"}, {attempt:11, review:"verified"},
      {attempt:1, review:"verified", rule:"presentation-only-checkpoint-retained"}, {attempt:1, review:"best-effort", note:"private"}]) {
      expect(() => openUiFleetExport(query([snapshot(row(0), 2, {properties:{draft_selection:bad}})]), scope)).toThrow("Invalid OpenUI");
    }
    expect(() => parseOpenUiDiagnosticExport([{...outcomes[0],reply:"withheld"}])).toThrow("Invalid OpenUI");
  });
  test("round trips measurable code languages, requested language and actual planning evidence", () => {
    const code = row(0,{cue:{kind:"implicit-action",targets:["editable-code"],codeLanguage:"python",repeat:false},
      editableCode:["python"],editorOutsideWords:0,guidance:{source:"other",action:"none",delivered:true,targets:[],codeLanguage:"python"}});
    expect(openUiFleetExport(query([snapshot(code,3)]),scope).turns).toEqual([code]);
    expect(openUiFleetExport(query([snapshot({...code,editableCode:[],editorOutsideWords:null},4)]),scope).turns[0]!.editableCode).toEqual([]);
    expect(() => openUiFleetExport(query([snapshot(code,3,{properties:{editable_code:["print('private')"]}})]),scope)).toThrow("Invalid OpenUI");
    const challenge = row(1,{cue:{kind:"explicit-interface",targets:["coding-challenge"],codeLanguage:"typescript",repeat:false},
      selected:["coding-challenge"],editableCode:[],codingChallengeLanguages:["typescript"]});
    expect(openUiFleetExport(query([snapshot(challenge,7)]),scope).turns).toEqual([challenge]);
    expect(()=>openUiFleetExport(query([snapshot(challenge,7,{properties:{coding_challenge_languages:["PRIVATE source"]}})]),scope)).toThrow("Invalid OpenUI");
  });
  test("round trips both Jev comparisons, including a preference that failed its individual review", () => {
    const pairReviews: OpenUiDiagnosticTurn["pairReviews"] = [
      { pair: 1, candidateAttempts: [1, 2], status: "compared", preferredAttempt: 2, model: "jev-1.14.0",
        eligibleAttempts: [1], finalistAttempt: 1, candidateIssueIds: [{ attempt: 1, issues: [] }, { attempt: 2, issues: ["checkpoint_answer_leaked"] }], startedAtMs: 100, finishedAtMs: 172 },
      { pair: 2, candidateAttempts: [3, 4], status: "compared", preferredAttempt: 3, model: "jev-1.14.0",
        eligibleAttempts: [], finalistAttempt: null, startedAtMs: 108, finishedAtMs: 184 },
    ];
    const finalComparison = { candidateAttempts: [1, 4] as const, preferredAttempt: 4,
      probabilities: { draft_1: 0.46, draft_4: 0.54 }, confidence: 0.08, model: "jev-1.14.0" };
    const rows = [row(0, { pairReviews }), row(1, { pairReviews: [] }), row(2), row(3, { pairReviews: [
      pairReviews[0]!, { ...pairReviews[1]!, eligibleAttempts: [4], finalistAttempt: 4 }], finalComparison })];
    const exported = openUiFleetExport(query(rows.map(turn => snapshot(turn, 1))), scope).turns;
    expect(exported.map(turn => turn.pairReviews)).toEqual(rows.map(turn => turn.pairReviews));
    expect(exported[3]!.finalComparison).toEqual(finalComparison);
    expect(() => openUiFleetExport(query([snapshot(row(0), 1, { properties: {
      draft_pair_reviews: [{ ...pairReviews[0], tutorDraft: "private reply" }],
    } })]), scope)).toThrow("Invalid OpenUI");
  });
  test("refuses row caps, silent partial pages, added columns, mixed scopes and incompatible latest snapshots", () => {
    const response = query([snapshot(row(0), 1), snapshot(row(1), 1), snapshot(row(2), 1)], { ...scope, maxTurns: 1 });
    expect(() => openUiFleetExport(response, { ...scope, maxTurns: 1 })).toThrow("Incomplete");
    expect(() => openUiFleetExport({ ...response, results: response.results.slice(0, 1) }, scope)).toThrow("Incomplete");
    expect(() => openUiFleetExport({ ...query([]), hasMore: true }, scope)).toThrow("Incomplete");
    expect(() => openUiFleetExport({ ...query([]), columns: [...response.columns, "content"] }, scope)).toThrow("column");
    expect(() => openUiFleetExport(query([snapshot(row(0), 1)]), { ...scope, appVersion: "4.1" })).toThrow("scope");
    const bad = query([snapshot(row(0), 1), snapshot(row(0), 2, { properties: { cue_targets: ["private-text"] } })]);
    expect(() => openUiFleetExport(bad, scope)).toThrow("Invalid OpenUI diagnostic turn");
  });
  test("rejects injection, invalid dates and unbounded limits without making a network call", () => {
    for (const invalid of [{ appVersion: "4.2' OR 1" }, { from: "2026-02-31" }, { from: scope.until }, { maxTurns: Infinity }]) {
      expect(() => openUiFleetSql({ ...scope, ...invalid })).toThrow();
    }
  });
  test("round-trips the assessment observation and keeps an event without it unobserved", () => {
    const pressed = row(0, { selected: ["simulation"], compiled: ["simulation"], assessment: { optOut: true, checkpoints: ["simulation-brief"] } });
    const withheld = row(1, { reply: "withheld", selected: [], assessment: { optOut: true, checkpoints: null } });
    const turns = openUiFleetExport(query([snapshot(pressed, 2), snapshot(withheld, 2), snapshot(row(2), 2),
      snapshot(row(3), 2, { properties: { assessment_opt_out: undefined, assessment_checkpoints: undefined } })]), scope).turns;
    expect(turns.map(r => r.assessment)).toEqual([pressed.assessment, withheld.assessment, undefined, undefined]);
    expect(summarizeOpenUiDiagnostics(turns).assessmentOptOut).toMatchObject({ optOuts: 2, notReleased: 1,
      checkpointAfterOptOut: { numerator: 1, denominator: 1, unknown: 1 } });
    expect(() => openUiFleetExport(query([snapshot(row(0), 2, { properties: { assessment_opt_out: true, assessment_checkpoints: ["No quiz, thanks"] } })]), scope))
      .toThrow("Invalid OpenUI");
  });
});
