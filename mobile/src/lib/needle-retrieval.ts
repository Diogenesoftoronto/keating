import { createNeedleRetrieval, needleRecallPrompt, needleSourceWindows, needleQueryText, type NeedleEmbed, type NeedleSource, type NeedleSearchResult } from "@keating/learner-contracts";
import type { ChatSession, StudyArtifact } from "./types";

export interface MobileRecallTurn { sessionId: string; messageId: string; createdAt: number; query: string }

/** Recall historical learner text only. Assistant prose, attachments and the current turn never become learner evidence. */
export function mobileNeedleSources(sessions: readonly ChatSession[], turn: MobileRecallTurn): NeedleSource[] {
  return [...sessions].sort((a, b) => a.updatedAt - b.updatedAt).slice(-32).flatMap(session => {
    const cutoff = session.id === turn.sessionId ? session.messages.findIndex(message => message.id === turn.messageId) : -1;
    const previous = session.id === turn.sessionId ? (cutoff < 0 ? [] : session.messages.slice(0, cutoff)) : session.messages;
    return previous.slice(-64).filter(message => message.role === "user" && Number.isFinite(message.createdAt)
      && (session.id === turn.sessionId ? message.createdAt <= turn.createdAt : message.createdAt < turn.createdAt))
      .flatMap(message => needleSourceWindows({ id: JSON.stringify([session.id, message.id]), kind: "learner-message",
        text: message.content, sessionId: session.id, messageId: message.id }));
  }).slice(-128);
}

export function mobileNeedleArtifactSources(artifacts: readonly StudyArtifact[]): NeedleSource[] {
  return [...artifacts].sort((a, b) => a.createdAt - b.createdAt).slice(-64)
    .flatMap(artifact => needleSourceWindows({ id: JSON.stringify(["artifact", artifact.id]), kind: "artifact", artifactId: artifact.id,
      sessionId: artifact.sessionId, messageId: artifact.messageId, text: artifact.content }, 2)).slice(-128);
}

const nativeEmbed: NeedleEmbed = async (texts, signal) => (await import("./needle-model")).embedNeedleTexts(texts, signal);

export function createMobileNeedleRecall(embed: NeedleEmbed = nativeEmbed) {
  const index = createNeedleRetrieval(embed);
  let generation = 0;
  return {
    clear() { generation++; index.clear(); },
    async prompt(sessions: readonly ChatSession[], turn: MobileRecallTurn, options: {
      signal: AbortSignal; current: () => boolean; currentSessions: () => readonly ChatSession[];
      onResult?: (result: NeedleSearchResult, current: () => boolean) => void;
    }): Promise<string> {
      const epoch = ++generation;
      const sources = mobileNeedleSources(sessions, turn);
      const pin = JSON.stringify(sources);
      const current = () => {
        const live = options.currentSessions();
        const trigger = live.find(session => session.id === turn.sessionId)?.messages.find(message => message.id === turn.messageId);
        return epoch === generation && !options.signal.aborted && options.current() && trigger?.role === "user" && trigger.content === turn.query && trigger.createdAt === turn.createdAt
          && JSON.stringify(mobileNeedleSources(live, turn)) === pin;
      };
      const result = await index.search(needleQueryText(turn.query), sources, { signal: options.signal, current });
      if (!current() || !result) return "";
      try { options.onResult?.(structuredClone(result), current); } catch { /* Optional admission cannot interrupt a reply. */ }
      return needleRecallPrompt(result);
    },
  };
}

export function createMobileNeedleSearch(embed: NeedleEmbed = nativeEmbed) { return createNeedleRetrieval(embed); }
