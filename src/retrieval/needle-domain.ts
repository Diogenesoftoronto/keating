/**
 * Offline subject-field classification through the local Needle tool-call
 * runtime. Keyword lookup stays in `shared/pedagogy/domains.ts`; this is the
 * rung above it, and a null decision means escalate, never guess.
 */
import { createNeedleCaller, loadNeedleConfig, needleModelIdentity, type NeedleCaller } from "./needle-runtime.js";
import { FIELDS } from "../../shared/pedagogy/domains.js";
import { decideLocalModelField, type LocalModelFieldDecision } from "../../packages/learner-contracts/src/judgement/domain-classification.js";

export interface NeedleDomainOptions {
  /** Explicit deterministic test boundary. Production resolves the local runtime config. */
  runtime?: { model: string; call: NeedleCaller };
}

export interface NeedleDomainResult extends LocalModelFieldDecision {
  readonly model: string;
}

/** Classify one topic; null means the runtime was unavailable, never "general". */
export async function classifyDomainField(cwd: string, topic: string, options: NeedleDomainOptions = {}): Promise<NeedleDomainResult | null> {
  try {
    const text = topic.trim();
    if (!text || text.length > 500 || text.includes("\0")) return null;
    const config = options.runtime ? null : await loadNeedleConfig(cwd);
    const runtime = options.runtime ?? (config ? { model: needleModelIdentity(config), call: createNeedleCaller(config) } : null);
    if (!runtime) return null;
    const response = await runtime.call({ texts: [text], classify: [text] });
    if (!response) return null;
    const classification = response?.classifications?.[0];
    const decision = decideLocalModelField(
      classification && typeof classification.field === "string" ? { field: classification.field, confidence: classification.confidence ?? null } : null,
      FIELDS,
    );
    return Object.freeze({ ...decision, model: runtime.model });
  } catch { return null; }
}
