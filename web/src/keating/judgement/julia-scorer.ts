import type { LocalLabelScorer } from "@keating/learner-contracts";
import { JULIA_MODEL_ID } from "../../../../shared/julia/manifest.js";
import { createJuliaLabelScorer, juliaRow } from "../../../../shared/julia/scorer.js";
import { desktopOfflineBridge, type DesktopOfflineBridge } from "../../lib/desktop-offline";
import { juliaBrowserModel } from "../../stores/julia-model";

export const createBrowserJuliaScorer = (): LocalLabelScorer => createJuliaLabelScorer(juliaBrowserModel);

/** The native bridge returns real encoder/head weights, independent of the tutor. */
export function createDesktopJuliaScorer(bridge?: DesktopOfflineBridge): LocalLabelScorer {
  return async input => {
    const native = bridge ?? desktopOfflineBridge();
    if (!native?.scoreLabels || !native.supportedJudgementModels?.includes(JULIA_MODEL_ID) || input.signal?.aborted) return null;
    const requestId = crypto.randomUUID();
    const cancel = () => { void native.cancelScoring?.(requestId).catch(() => {}); };
    input.signal?.addEventListener("abort", cancel, { once: true });
    try {
      const result = await native.scoreLabels({ requestId, modelId: JULIA_MODEL_ID, ...juliaRow(input) });
      if (input.signal?.aborted || result?.modelId !== JULIA_MODEL_ID || !result.weights || result.weights.length !== input.labels.length
        || result.weights.some(weight => !Number.isFinite(weight) || weight < 0)) return null;
      return result.weights;
    } catch { return null; }
    finally { input.signal?.removeEventListener("abort", cancel); }
  };
}
