import { INTERACTION_REASONS, TUTOR_RATE_LIMIT_REASON, isDecisionPlanningFailure, type TeachingDraftSnapshot } from "@keating/learner-contracts";
import {
  classifyOpenUiCue, isOpenUiDiagnosticGateIssue, normalizeOpenUiComponent, observeAssessmentOptOut, projectOpenUiPairReviews, projectOpenUiFinalComparison, projectTeachingDraftSelection, type OpenUiDiagnosticTurn,
} from "../../../../packages/learner-contracts/src/openui-diagnostic-turn";
import { learningMessageId, learningMessageText } from "../learning-intelligence/source-navigation";
import { isPrivateForkContextMessage } from "../private-fork-provenance";
import { LEARNER_RESPONSE_TAG, parseLearnerResponse } from "../learner-response";
import { parseReviewNotice } from "../judgement/review-notice";
import { inspectAssessmentCheckpoints, inspectOpenUIDiagnosticText, inspectSelectedOpenUIDiagnosticText } from "./diagnostic-components";
import { inspectEditableCodeEvidence } from "./editable-code-evidence";
import { recordedCodePracticeLanguage } from "../editable-code-language";
import { diagnosticConversationId, diagnosticSourceId, openUIDiagnosticStore } from "./turn-diagnostics";
import { noteNativeToolEvent, readNativeTurn, type NativeMessage, type NativeResultEvent } from "./native-page-evidence";

type Row = OpenUiDiagnosticTurn;
type Message = NativeMessage & { provider?: string; model?: string; responseModel?: string };
type Store = typeof openUIDiagnosticStore;
type Reviewer = { backend: string; model: string };
const union = (a: readonly string[], b: readonly string[]): string[] => [...new Set([...a, ...b])].sort();
const isUserEntry = (message: Message) =>
  (message.role === "user" || message.role === "user-with-attachments") && !isPrivateForkContextMessage(message);
const identity = (value?: string): string | null => value && /^[a-z0-9][a-z0-9._:/+-]{0,158}$/i.test(value) ? value : null;
const responseTypes = new WeakMap<Message, "answer" | "repair" | "plain">();
function responseType(message: Message) {
  const cached = responseTypes.get(message);
  if (cached) return cached;
  const text = learningMessageText(message);
  const envelope = text.trimStart().startsWith(`<${LEARNER_RESPONSE_TAG}`) ? parseLearnerResponse(text) : null;
  const type = envelope?.kind === "openui-action" && envelope.payload?.type === "regenerate-interaction"
    ? "repair" : envelope ? "answer" : "plain";
  responseTypes.set(message, type);
  return type;
}
const isLearner = (message: Message) => isUserEntry(message) && responseType(message) !== "repair";
function tutorIdentity(message: Message): string | null {
  const actual = identity(message.responseModel ?? message.model);
  return actual && message.provider && !actual.startsWith(message.provider + "/") ? identity(`${message.provider}/${actual}`) : actual;
}
function requestedNativePage(message: Message): boolean {
  if (message.stopReason !== "toolUse" && message.stopReason !== "stop") return false;
  const parts = message.content ?? message.parts;
  return Array.isArray(parts) && parts.some(part => part?.type === "toolCall" && part.name === "interactive_page");
}

/** Only active, real web turns may receive draft observations. A stale wrapper keeps its original handle. */
const active = new Map<string, ReturnType<typeof start>>();
export const activeOpenUIDiagnosticTurn = (sessionId: string) => active.get(sessionId);

function start(conversationId: string, turnIndex: number, learner: Message, modelMode: "baseline" | "unknown", store: Store, startedAt: number) {
  const row: Row = {
    schemaVersion: 1, conversationId, turnId: `learner-${turnIndex}`, turnIndex,
    model: null, mode: modelMode, cue: responseType(learner) === "answer" ? { kind: "none", targets: [] } : classifyOpenUiCue(learningMessageText(learner)),
    reply: "pending", replyElapsedMs: null, attempted: null, compiled: null, selected: null, rendered: null, guidance: null, outsideWords: null, nativePageRequested: null,
  };
  // A structured answer is not the learner's own prose. Unreadable words leave the observation absent.
  const optOut = responseType(learner) === "answer" ? null : observeAssessmentOptOut(learningMessageText(learner));
  if (optOut !== null) row.assessment = { optOut, checkpoints: null };
  const finish = store.begin(structuredClone(row));
  // Flue appends the public message object before emitting message_end. A turn
  // can have several tool rounds; only the exact final message supplies a time.
  const publicMessageEnds = new WeakMap<Message, number>();
  let ended = false;
  let round = 0;
  let completedAttempts = 0;
  let finalSelection: { tutor: string; evidence: NonNullable<Row["selection"]> } | undefined;
  const byTutor = new Map<string | null, { attempted: boolean; components: string[] }>();
  const nativeEvents = new Map<string, boolean>();
  let offers = new Map<string | null, boolean>();
  function useTutor(model: string | null) {
    row.model = model;
    const candidates = byTutor.get(model);
    row.attempted = candidates?.attempted ?? null;
    row.compiled = candidates?.components ?? null;
    if (row.guidance) row.guidance.delivered = offers.get(model) ?? null;
  }
  return {
    turnIndex,
    nativeEvent(event: NativeResultEvent) { noteNativeToolEvent(nativeEvents, event); },
    publicMessageEnded(message: Message, at: number) {
      if (!publicMessageEnds.has(message)) publicMessageEnds.set(message, at);
    },
    beginRound() {
      const token = ++round;
      finalSelection = undefined;
      delete row.requestedModel;
      delete row.decisionFailure;
      delete row.pairReviews;
      delete row.finalComparison;
      const attemptTutors = new Map<number, string>();
      // A tool-call round can have its own plan. Preserve the turn's authored
      // candidates by actual tutor, and attribute the final round's offer separately.
      row.guidance = null;
      row.mode = modelMode;
      offers = new Map();
      useTutor(null);
      completedAttempts = row.draftAttempts ?? 0;
      row.draftAttempts = completedAttempts;
      row.gateIssues ??= [];
      row.decisionModel = null;
      return {
        generationRequested(tutor: string) {
          if (ended || token !== round) return;
          const id = identity(tutor);
          if (id) row.requestedModel = id;
        },
        plan(snapshot: TeachingDraftSnapshot, reviewer: Reviewer | null) {
          if (ended || token !== round) return;
          if (isDecisionPlanningFailure(snapshot.decisionFailure)) row.decisionFailure = { ...snapshot.decisionFailure };
          const pairReviews = projectOpenUiPairReviews(snapshot.pairReviews);
          if (pairReviews) row.pairReviews = pairReviews;
          const finalComparison = projectOpenUiFinalComparison(snapshot.finalComparison);
          if (finalComparison) row.finalComparison = finalComparison;
          const selection = projectTeachingDraftSelection(snapshot);
          const tutor = selection && attemptTutors.get(selection.attempt);
          if (selection && tutor) finalSelection = { tutor, evidence: selection };
          row.draftAttempts = Math.max(row.draftAttempts ?? 0, completedAttempts + snapshot.attempt);
          row.gateIssues = union(row.gateIssues ?? [], snapshot.attempts.flatMap(item => item.checks.flatMap(check =>
            check.status !== "pass" && !check.applicability && isOpenUiDiagnosticGateIssue(check.id) ? [check.id] : [])));
          if (snapshot.attempts.some(a => a.status === "generation-error" && a.generationFailure === TUTOR_RATE_LIMIT_REASON))
            row.gateIssues = union(row.gateIssues, [TUTOR_RATE_LIMIT_REASON]);
          if (!snapshot.interaction || !reviewer) return;
          row.mode = "guided";
          row.decisionModel = identity(reviewer.model);
          const codeLanguage = recordedCodePracticeLanguage(snapshot.interaction);
          row.guidance = {
            source: reviewer.backend === "system-one" && /^jev[-.]/i.test(reviewer.model) ? "jev" : "other",
            action: snapshot.interaction.action, delivered: offers.get(row.model) ?? null,
            ...(snapshot.interaction.reason && INTERACTION_REASONS.includes(snapshot.interaction.reason) ? { reason: snapshot.interaction.reason } : {}),
            ...(codeLanguage ? {codeLanguage} : {}),
            targets: union([], snapshot.interaction.families.flatMap(family =>
              family.components.flatMap(name => normalizeOpenUiComponent(name) ?? []))),
          };
        },
        candidate(message: Message, offered: boolean | null, attempt?: number) {
          if (ended || token !== round) return;
          const actual = tutorIdentity(message);
          if (actual && attempt !== undefined) attemptTutors.set(attempt, actual);
          if (offered !== null) offers.set(actual, offers.get(actual) === true || offered);
          const observed = inspectOpenUIDiagnosticText(learningMessageText(message));
          const earlier = byTutor.get(actual);
          byTutor.set(actual, { attempted: !!earlier?.attempted || observed.attempted, components: union(earlier?.components ?? [], observed.components) });
          useTutor(actual);
        },
      };
    },
    end(message: Message | undefined, sourceId: string | null, nativePageTutors: ReadonlySet<string | null> = new Set(),
      history?: { messages: readonly Message[]; start: number; end: number }) {
      if (ended) return;
      ended = true;
      const text = learningMessageText(message);
      const notice = parseReviewNotice(text);
      const withheld = notice?.kind === "withheld";
      if (message?.stopReason === "aborted") row.reply = "cancelled";
      else if (message?.stopReason === "error") row.reply = "error";
      else if (withheld) row.reply = "withheld";
      else if (message?.stopReason === "stop" || message?.stopReason === "length") row.reply = "released";
      else row.reply = "unknown";
      const endedAt = message && publicMessageEnds.get(message);
      if ((row.reply === "released" || row.reply === "withheld") && endedAt !== undefined && endedAt >= startedAt) {
        const elapsed = Math.round(endedAt - startedAt);
        if (Number.isSafeInteger(elapsed)) row.replyElapsedMs = elapsed;
      }
      if (row.reply === "released" && message) {
        useTutor(tutorIdentity(message));
        if (finalSelection && row.model === finalSelection.tutor) row.selection = finalSelection.evidence;
        const content = message.content ?? message.parts;
        const hasText = typeof content === "string" || Array.isArray(content)
          && content.some(part => part?.type === "text" && typeof part.text === "string");
        if (hasText) {
          const output = inspectSelectedOpenUIDiagnosticText(notice?.text ?? text);
          row.selected = output.components;
          row.codingChallengeLanguages = output.codingChallengeLanguages;
          const editor = inspectEditableCodeEvidence(notice?.text ?? text);
          row.editableCode = editor.editableCode;
          row.editorOutsideWords = editor.editorOutsideWords;
          row.outsideWords = output.outsideWords;
          if (row.assessment) row.assessment.checkpoints = inspectAssessmentCheckpoints(notice?.text ?? text);
          // An unwrapped generator's final assistant message is also a model candidate.
          if (round === 0) { row.attempted = output.attempted; row.compiled = output.components; }
        }
      } else if (withheld) {
        row.selected = [];
      } else if (message?.stopReason === "toolUse") {
        useTutor(tutorIdentity(message));
      }
      if (row.reply !== "released" && row.model === null && byTutor.size === 1) useTutor([...byTutor.keys()][0]!);
      // Attribute only public requests to the tutor on the row. A tool call from a
      // different tutor in the same turn cannot establish this tutor's behavior.
      const publicParts = message?.content ?? message?.parts;
      if (nativePageTutors.has(row.model)) row.nativePageRequested = true;
      else if (!nativePageTutors.size && (typeof publicParts === "string" || Array.isArray(publicParts))
        && (row.reply === "released" || message?.stopReason === "toolUse")) row.nativePageRequested = false;
      const native = history && readNativeTurn(history.messages, history.start, history.end, nativeEvents,
        author => tutorIdentity(author) === row.model, row.nativePageRequested ?? null);
      if (native) row.nativePage = native.evidence;
      finish(structuredClone(row), sourceId ? diagnosticSourceId(sourceId) : null, native?.refs, native?.complete);
    },
  };
}

export function observeOpenUITurns(options: {
  sessionId: string;
  messages: () => readonly Message[];
  mode: () => "baseline" | "unknown";
  capture: (event: string, properties: Record<string, unknown>) => void;
  store?: Store;
  now?: () => number;
}) {
  const { sessionId } = options;
  const store = options.store ?? openUIDiagnosticStore;
  const now = options.now ?? (() => performance.now());
  const conversationId = diagnosticConversationId(sessionId);
  const unregister = store.registerCapture(conversationId, options.capture);
  let turn: ReturnType<typeof start> | undefined;
  let learnerPosition = -1;
  let firstNewResponse = 0;
  let previouslySeen = options.messages().length;

  function finish(messages: readonly Message[]) {
    if (!turn) return;
    let final = -1;
    let end = firstNewResponse;
    const nativePageTutors = new Set<string | null>();
    for (let index = firstNewResponse; index < messages.length; index++) {
      const message = messages[index]!;
      if (isUserEntry(message)) break;
      end = index + 1;
      if (message.role !== "assistant") continue;
      final = index;
      if (requestedNativePage(message)) nativePageTutors.add(tutorIdentity(message));
    }
    const assistant = messages[final];
    turn.end(assistant, assistant ? learningMessageId(assistant, final) : null, nativePageTutors,
      { messages, start: firstNewResponse, end });
    if (active.get(sessionId) === turn) active.delete(sessionId);
    turn = undefined;
  }
  function begin(messages: readonly Message[], index: number, responseStart: number) {
    if (index < 0 || (turn && index === learnerPosition)) return;
    const startedAt = now();
    finish(messages);
    learnerPosition = index;
    if (!isLearner(messages[index]!)) return;
    firstNewResponse = responseStart;
    const ordinal = messages.slice(0, index).filter(isLearner).length;
    turn = start(conversationId, ordinal, messages[index]!, options.mode(), store, startedAt);
    active.set(sessionId, turn);
  }
  return {
    observe(event: NativeResultEvent & { message?: Message }) {
      const messages = options.messages();
      if (event.type === "agent_start") {
        const first = messages.findIndex((message, index) => index >= previouslySeen && isUserEntry(message));
        // With no new learner entry, this can be a resumed or retried turn. Only
        // newly generated assistant messages may be attributed to that run.
        begin(messages, first < 0 ? messages.findLastIndex(isUserEntry) : first, first < 0 ? messages.length : first + 1);
      } else if (event.type === "message_end" && event.message && isUserEntry(event.message)) {
        const position = messages.lastIndexOf(event.message);
        if (position >= 0) begin(messages, position, position + 1);
      } else if (event.type === "tool_execution_end") {
        turn?.nativeEvent(event);
      } else if (event.type === "message_end" && event.message?.role === "assistant") {
        turn?.publicMessageEnded(event.message, now());
      } else if (event.type === "agent_end") {
        finish(messages);
        previouslySeen = messages.length;
      }
    },
    dispose() {
      if (turn) { turn.end(undefined, null); if (active.get(sessionId) === turn) active.delete(sessionId); }
      unregister();
    },
  };
}
