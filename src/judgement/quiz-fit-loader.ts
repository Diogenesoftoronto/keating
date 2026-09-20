/** Verified, source-bound local projections; rebuild before exposing predictions. */
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import type { JudgementBackendKey, UiQuestion } from "../../packages/learner-contracts/src/index.js";
import { predictTree } from "../../packages/learner-contracts/src/judgement/boosting.js";
import { predictBoostingProbability, validateBoostingArtifact, type BoostingArtifact } from "../../packages/learner-contracts/src/judgement/boosting-artifact.js";
import { extractQuizBoostingFeatures, QUIZ_BOOSTING_TARGET } from "../../packages/learner-contracts/src/judgement/quiz-boosting-features.js";
import { stateDir } from "../core/paths.js";
import { readBoundedBoostingJson } from "./boosting-artifact.js";
import { buildCliQuizBoostingDataset } from "./quiz-boosting-dataset.js";
import { evaluateQuizShallowTree } from "./quiz-boosting-fit.js";
import { cliQuizPerformanceCanonical as canonical, cliQuizPerformanceDigest as digest } from "./quiz-performance-store.js";

const invalid = (): never => { throw new Error("quiz_fit_invalid"); };
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);

export async function loadCliQuizFit(cwd: string, path: string, expectedFileSha256: string, options: { now?: () => number } = {}) {
  try {
    if (!/^[a-f0-9]{64}$/u.test(expectedFileSha256)) return invalid();
    const workspace = resolve(cwd), filePath = resolve(workspace, path), directory = stateDir(workspace);
    const { value, sha256 } = await readBoundedBoostingJson(filePath);
    if (sha256 !== expectedFileSha256 || !object(value) || !object(value.sourceBinding)) return invalid();
    const built = await buildCliQuizBoostingDataset(workspace, value.sourceBinding.selection, options);
    if (canonical(value.dataset) !== canonical(built.dataset) || canonical(value.sourceBinding) !== canonical(built.binding)) return invalid();
    const shallow = evaluateQuizShallowTree(built.dataset);
    if (shallow.status !== "validated" || !object(value.boosting)) return invalid();
    const prepared = validateBoostingArtifact(value.boosting);
    const boosting: BoostingArtifact = prepared.complete(createHash("sha256").update(prepared.identityInput).digest("hex"));
    if (canonical(boosting) !== canonical(value.boosting)
      || canonical({ schemaVersion: boosting.input.schemaVersion, policy: boosting.input.policy,
        features: boosting.input.features, observations: boosting.input.observations }) !== canonical(built.dataset)
      || boosting.input.framework.version !== "1.2.10" || boosting.input.framework.parameters.depth !== 3
      || boosting.input.framework.parameters.iterations !== 300) return invalid();
    const selected = boosting.status === "validated" && boosting.metrics.beatsBaseline === true
      && boosting.metrics.brier < shallow.comparison!.candidateBrier ? "boosting" as const : "shallow-tree" as const;
    const report = { schemaVersion: 1 as const, target: QUIZ_BOOSTING_TARGET, sourceBinding: built.binding,
      dataset: built.dataset, shallow, boosting, selected };
    const fitSha256 = digest(report);
    if (canonical(value) !== canonical({ ...report, fitSha256 }) || stateDir(workspace) !== directory) return invalid();
    // No tree, rows, or source selection escape this closure. The exposed backend
    // is a detached immutable key, so callers cannot retarget this model.
    const backend: Readonly<JudgementBackendKey> = Object.freeze(structuredClone(built.binding.sourceBackend));
    async function current(): Promise<boolean> {
      try {
        if (stateDir(workspace) !== directory) return false;
        const file = await readBoundedBoostingJson(filePath);
        if (file.sha256 !== expectedFileSha256) return false;
        const source = await buildCliQuizBoostingDataset(workspace, built.binding.selection, options);
        if (stateDir(workspace) !== directory || source.binding.bindingSha256 !== built.binding.bindingSha256) return false;
        return (await readBoundedBoostingJson(filePath)).sha256 === expectedFileSha256 && stateDir(workspace) === directory;
      } catch { return false; }
    }
    // Recheck after all asynchronous source loading before handing out a handle.
    if (!await current()) return invalid();
    return Object.freeze({ fitSha256, fileSha256: sha256, target: QUIZ_BOOSTING_TARGET, method: selected, backend,
      predict(question: UiQuestion, rawProbability: number): number | null {
        try {
          const features = extractQuizBoostingFeatures(question, rawProbability);
          if (!features) return null;
          const probability = selected === "boosting" ? predictBoostingProbability(boosting.model, features) : predictTree(shallow.tree, features);
          return Number.isFinite(probability) && probability >= 0 && probability <= 1 ? probability : null;
        } catch { return null; }
      }, current });
  } catch { return invalid(); }
}
