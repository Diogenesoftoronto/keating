import type { Context } from "@earendil-works/pi-ai";
import type { ActiveWork, TeachingPolicyTurn } from "@keating/learner-contracts";
import { learningMessageId } from "../learning-intelligence/source-navigation";
import { presentationsFromAssistantText } from "./active-work-host";
import { stripReviewNotice } from "./review-notice";

type Row = { element: Element; sourceId: string; displayId: string; publicText: string };
const mounted = new Map<string, Set<Row>>();

/** Associate the existing visible row with its one original Pi message only while mounted. */
export function registerQuestionSourceRow(sessionId: string, element: Element, sourceId: string, displayId: string, text: string) {
  if (!text.includes("openui")) return;
  const rows = mounted.get(sessionId) ?? new Set<Row>();
  const row = { element, sourceId, displayId, publicText: stripReviewNotice(text) };
  rows.add(row);
  mounted.set(sessionId, rows);
  return () => { rows.delete(row); if (!rows.size) mounted.delete(sessionId); };
}

/** Bind a conversational answer to its actual preceding visible Question. Never send browser row or session identifiers. */
export function previousQuestionPresentation(sessionId: string | undefined, messages: Context["messages"],
  work: ActiveWork | undefined): TeachingPolicyTurn["previousQuestionPresentation"] {
  const open = work?.openInteractions;
  if (!sessionId || !open || open.length !== 1 || work?.truncated || messages.at(-1)?.role !== "user") return;
  const awaiting = open[0]!;
  if (awaiting.state !== "awaiting" || !["question", "question-group"].includes(awaiting.component)) return;
  return presentationAt(sessionId, messages, awaiting, messages.length - 2);
}

/**
 * For a typed answer only: the awaiting card may sit a few tutor messages back when the replies since then asked
 * nothing new ("Take your time."). Any later tutor question, card or tool use ends the search.
 */
export function openCardPresentation(sessionId: string | undefined, messages: Context["messages"],
  work: ActiveWork | undefined, maxSkipped = 3): TeachingPolicyTurn["previousQuestionPresentation"] {
  const open = work?.openInteractions;
  if (!sessionId || !open || open.length !== 1 || work?.truncated || messages.at(-1)?.role !== "user") return;
  const awaiting = open[0]!;
  if (awaiting.state !== "awaiting" || !["question", "question-group"].includes(awaiting.component)) return;
  let skipped = 0;
  for (let index = messages.length - 2; index >= 0; index--) {
    const message = messages[index]!;
    if (message.role === "user") continue;
    if (message.role !== "assistant") return;
    const found = presentationAt(sessionId, messages, awaiting, index);
    if (found) return found;
    if (!Array.isArray(message.content) || message.content.some(part => part.type === "toolCall")) return;
    const text = message.content.flatMap(part => part.type === "text" ? [part.text] : []).join("\n");
    if (/[?？]/u.test(text) || /[`~]{3}/u.test(text) || ++skipped > maxSkipped) return;
  }
}

function presentationAt(sessionId: string, messages: Context["messages"], awaiting: ActiveWork["openInteractions"][number],
  index: number): TeachingPolicyTurn["previousQuestionPresentation"] {
  const previous = messages[index];
  if (previous?.role !== "assistant" || !Array.isArray(previous.content) || previous.content.some(part => part.type === "toolCall")) return;
  const parts = previous.content.filter(part => part.type === "text");
  if (parts.length !== 1) return;
  const sourceId = learningMessageId(previous, index);
  const text = stripReviewNotice(parts[0]!.text);
  const candidates = [...(mounted.get(sessionId) ?? [])].filter(row => row.sourceId === sourceId && row.element.isConnected);
  if (candidates.length !== 1 || candidates[0]!.publicText !== text
    || messages.filter((message, i) => message.role === "assistant" && learningMessageId(message, i) === sourceId).length !== 1) return;
  const row = candidates[0]!;
  const textParts = row.element.querySelectorAll("[data-openui-diagnostic-part]");
  if (textParts.length !== 1 || textParts[0]!.getAttribute("data-openui-diagnostic-part") !== "ready") return;
  const documents = textParts[0]!.querySelectorAll("[data-openui-document]");
  if (documents.length !== 1 || documents[0]!.getAttribute("data-openui-document") !== awaiting.documentId) return;
  const shared = documents[0]!.querySelector(":scope > [data-shared-openui-document]");
  if (!shared || shared.getAttribute("data-shared-openui-document") !== awaiting.documentId
    || shared.getAttribute("data-openui-diagnostic-nodes") !== awaiting.component) return;
  try {
    // Flue's display ID can differ from the Pi source ID. Use the exact scope the
    // renderer used and compile the preceding public text to confirm its node ID.
    const nodes = presentationsFromAssistantText(text, { sessionId, messageId: row.displayId }, null);
    if (nodes.length === 1 && nodes[0]!.documentId === awaiting.documentId && nodes[0]!.nodeId === awaiting.nodeId
      && nodes[0]!.component === awaiting.component) {
      return { assistantTurnIndex: index, documentId: awaiting.documentId, nodeId: awaiting.nodeId };
    }
  } catch { /* An unresolvable presentation leaves the checkpoint protected. */ }
}
