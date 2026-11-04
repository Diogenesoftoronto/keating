/**
 * One Keating turn in a study room: lease the turn, make a single
 * tool-constrained model call over the shared transcript, and report the
 * decision. Network and model access are injected so this runs in tests.
 */
import type { Api, AssistantMessageEventStream, Context, Model } from "@earendil-works/pi-ai";
import type { RoomOperationInput, RoomViewerSnapshot } from "./contracts";
import {
  buildFacilitatorContext,
  parseFacilitatorDecision,
  type FacilitatorDecision,
  type TurnPlan,
} from "./facilitation";

export type FacilitatorStreamFn = (
  model: Model<Api>,
  context: Context,
  options: { signal?: AbortSignal; hostedWebSearch: false },
) => Promise<AssistantMessageEventStream> | AssistantMessageEventStream;

export interface FacilitatorTurnDependencies {
  apply: (operation: RoomOperationInput) => Promise<RoomViewerSnapshot>;
  stream: FacilitatorStreamFn;
  newTurnId: () => string;
  onPreview?: (turnId: string, text: string) => void;
}

export interface FacilitatorTurnInput {
  facilitatorId: string;
  plan: Extract<TurnPlan, { run: true }>;
  model: Model<Api>;
  modelLabel: string;
  persona: string;
  presentAccountIds: readonly string[];
  signal?: AbortSignal;
}

export type FacilitatorTurnResult =
  | { status: "skipped"; reason: string }
  | { status: "completed"; decision: FacilitatorDecision; snapshot: RoomViewerSnapshot }
  | { status: "failed"; error: string; snapshot?: RoomViewerSnapshot };

/** Server refusals that mean "someone else has it" rather than a failure. */
const SKIP_CODES = new Set([
  "room_turn_stale",
  "room_turn_busy",
  "room_keating_paused",
  "room_not_facilitator",
  "room_facilitator_replaced",
  "room_turn_expired",
  "room_ended",
]);

function errorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : undefined;
}

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 480);
}

export async function runFacilitatorTurn(
  input: FacilitatorTurnInput,
  dependencies: FacilitatorTurnDependencies,
): Promise<FacilitatorTurnResult> {
  if (input.signal?.aborted) return { status: "skipped", reason: "aborted" };
  const turnId = dependencies.newTurnId();
  let began: RoomViewerSnapshot;
  try {
    began = await dependencies.apply({
      type: "turn.begin",
      facilitatorId: input.facilitatorId,
      turnId,
      throughSeq: input.plan.throughSeq,
    });
  } catch (error) {
    const code = errorCode(error);
    if (code && SKIP_CODES.has(code)) return { status: "skipped", reason: code };
    return { status: "failed", error: errorText(error) };
  }

  let decision: FacilitatorDecision;
  try {
    input.signal?.throwIfAborted();
    const context = buildFacilitatorContext({
      snapshot: began,
      persona: input.persona,
      throughSeq: input.plan.throughSeq,
      trigger: input.plan.trigger,
      presentAccountIds: input.presentAccountIds,
    });
    const stream = await dependencies.stream(input.model, context, {
      signal: input.signal,
      hostedWebSearch: false,
    });
    for await (const _event of stream) {
      input.signal?.throwIfAborted();
    }
    const final = await stream.result();
    input.signal?.throwIfAborted();
    if (final.stopReason !== "stop" && final.stopReason !== "toolUse") {
      throw new Error(final.errorMessage || `The model stopped (${final.stopReason}).`);
    }
    decision = parseFacilitatorDecision(final);
    // A later tool can turn an apparent public reply into a private or mixed
    // decision. Nothing may leave this browser until the whole choice is known.
    if (decision.kind === "speak") dependencies.onPreview?.(turnId, decision.content);
  } catch (error) {
    const aborted = input.signal?.aborted;
    const message = aborted ? "The turn was cancelled." : errorText(error);
    try {
      const snapshot = await dependencies.apply({
        type: "turn.complete",
        facilitatorId: input.facilitatorId,
        turnId,
        outcome: "failed",
        model: input.modelLabel,
        detail: message,
      });
      if (aborted) return { status: "skipped", reason: "aborted" };
      return { status: "failed", error: message, snapshot };
    } catch {
      if (aborted) return { status: "skipped", reason: "aborted" };
      return { status: "failed", error: message };
    }
  }

  try {
    const snapshot = await dependencies.apply(
      decision.kind === "speak"
        ? {
            type: "turn.complete",
            facilitatorId: input.facilitatorId,
            turnId,
            outcome: "spoke",
            body: decision.content,
            ...(decision.addressedTo.length ? { addressedTo: decision.addressedTo } : {}),
            model: input.modelLabel,
          }
        : decision.kind === "private-fork"
          ? {
              type: "turn.complete",
              facilitatorId: input.facilitatorId,
              turnId,
              outcome: "offered-private",
              privateFork: decision.proposal,
              model: input.modelLabel,
            }
        : {
            type: "turn.complete",
            facilitatorId: input.facilitatorId,
            turnId,
            outcome: "passed",
            model: input.modelLabel,
            ...(decision.reason ? { detail: decision.reason } : {}),
          },
    );
    return { status: "completed", decision, snapshot };
  } catch (error) {
    const code = errorCode(error);
    if (code && SKIP_CODES.has(code)) return { status: "skipped", reason: code };
    if (decision.kind === "private-fork") {
      // A model can name a source or recipient that the server rejects. Free
      // our still-current turn rather than leaving the group waiting on it.
      // If completion actually succeeded but its response was lost, the lease
      // check rejects this cleanup without changing the completed decision.
      try {
        const snapshot = await dependencies.apply({
          type: "turn.complete",
          facilitatorId: input.facilitatorId,
          turnId,
          outcome: "failed",
          model: input.modelLabel,
          detail: "The private continuation could not be offered from that source.",
        });
        return { status: "failed", error: errorText(error), snapshot };
      } catch {
        // A replaced/expired turn belongs to the server's current facilitator.
      }
    }
    return { status: "failed", error: errorText(error) };
  }
}
