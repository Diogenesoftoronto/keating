/** Source-bound quiz fitting. A small inspectable tree gates the ensemble. */
import { compareAgainstBaseline, fitDecisionTree, predictTree, type TrainingRow } from "../../packages/learner-contracts/src/judgement/boosting.js";
import { MAX_BOOSTING_BYTES, validateBoostingDataset, type BoostingDataset, type BoostingArtifact } from "../../packages/learner-contracts/src/judgement/boosting-artifact.js";
import { QUIZ_BOOSTING_FEATURES, QUIZ_BOOSTING_TARGET } from "../../packages/learner-contracts/src/judgement/quiz-boosting-features.js";
import { fitBoostingArtifact } from "./boosting-artifact.js";
import { buildCliQuizBoostingDataset } from "./quiz-boosting-dataset.js";
import { cliQuizPerformanceCanonical as canonical, cliQuizPerformanceDigest as digest } from "./quiz-performance-store.js";

const TREE_OPTIONS = { maxDepth: 3, minimumSamplesPerLeaf: 8 } as const;
const POLICY = { minFitRows: 40, minFitGroups: 8, minValidationRows: 20,
  minValidationGroups: 6, maxValidationEce: 0.15, maxTreeDepth: 3 } as const;

export function evaluateQuizShallowTree(value: unknown) {
  const dataset = validateBoostingDataset(value);
  if (canonical(dataset.features) !== canonical(QUIZ_BOOSTING_FEATURES)
    || canonical(dataset.policy) !== canonical(POLICY)
    || dataset.observations.some(row => canonical(Object.keys(row.features).sort()) !== canonical([...QUIZ_BOOSTING_FEATURES].sort())
      || row.baseline !== row.features.jevProbability || row.baseline < 0 || row.baseline > 1)) {
    throw new Error("quiz_fit_dataset_invalid");
  }
  const rows: TrainingRow[] = dataset.observations.map(row => ({ features: row.features, label: row.label === 1, heldOut: row.split === "validation" }));
  const fit = dataset.observations.filter(row => row.split === "fit");
  const validation = dataset.observations.filter(row => row.split === "validation");
  const counts = { fitRows: fit.length, fitGroups: new Set(fit.map(row => row.groupId)).size,
    validationRows: validation.length, validationGroups: new Set(validation.map(row => row.groupId)).size };
  const enough = counts.fitRows >= POLICY.minFitRows && counts.fitGroups >= POLICY.minFitGroups
    && counts.validationRows >= POLICY.minValidationRows && counts.validationGroups >= POLICY.minValidationGroups
    && new Set(fit.map(row => row.label)).size === 2 && new Set(validation.map(row => row.label)).size === 2;
  const tree = fitDecisionTree(rows, TREE_OPTIONS);
  const comparison = compareAgainstBaseline(rows, features => predictTree(tree, features), features => features.jevProbability!);
  const reliability = Array.from({ length: 10 }, (_, index) => {
    const selected = validation.map(row => ({ probability: predictTree(tree, row.features), label: row.label }))
      .filter(row => Math.min(9, Math.floor(row.probability * 10)) === index);
    return { lower: index / 10, upper: (index + 1) / 10, count: selected.length,
      meanProbability: selected.length ? selected.reduce((sum, row) => sum + row.probability, 0) / selected.length : null,
      observedFrequency: selected.length ? selected.reduce((sum, row) => sum + row.label, 0) / selected.length : null };
  });
  const ece = validation.length ? reliability.reduce((sum, bin) => sum + bin.count * Math.abs((bin.meanProbability ?? 0) - (bin.observedFrequency ?? 0)), 0) / validation.length : null;
  const status = !enough ? "insufficient" : comparison?.beatsBaseline && ece !== null && ece <= POLICY.maxValidationEce ? "validated" : "failed-validation";
  return { method: "cart-gini-v1" as const, options: { ...TREE_OPTIONS }, tree, counts, comparison, reliability, ece, status };
}

/** The application source is rebuilt both before and after the asynchronous trainer. */
export async function fitCliQuizPerformance(cwd: string, selection: unknown, options: {
  train: (dataset: BoostingDataset) => Promise<unknown>;
  now?: () => number;
}) {
  const built = await buildCliQuizBoostingDataset(cwd, selection, options);
  const shallow = evaluateQuizShallowTree(built.dataset);
  let boosting: BoostingArtifact | null = null;
  if (shallow.status === "validated") {
    const exported = await options.train(structuredClone(built.dataset));
    if (!exported || typeof exported !== "object" || Array.isArray(exported)) throw new Error("quiz_fit_trainer_invalid");
    const { framework, model } = exported as { framework?: unknown; model?: unknown };
    boosting = fitBoostingArtifact({ ...built.dataset, framework, model });
    if (boosting.input.framework.version !== "1.2.10" || boosting.input.framework.parameters.depth !== 3
      || boosting.input.framework.parameters.iterations !== 300) throw new Error("quiz_fit_trainer_invalid");
  }
  const current = await buildCliQuizBoostingDataset(cwd, built.binding.selection, options);
  if (current.binding.bindingSha256 !== built.binding.bindingSha256) throw new Error("quiz_fit_source_changed");
  // Both candidates and the raw incumbent use the same declared held-out rows.
  // Retain the simpler model unless the ensemble measurably improves on it.
  const selected = shallow.status !== "validated" ? null : boosting?.status === "validated"
    && boosting.metrics.beatsBaseline === true && boosting.metrics.brier < shallow.comparison!.candidateBrier ? "boosting" : "shallow-tree";
  const result = { schemaVersion: 1 as const, target: QUIZ_BOOSTING_TARGET, sourceBinding: built.binding,
    dataset: built.dataset, shallow, boosting, selected };
  const complete = { ...result, fitSha256: digest(result) };
  if (Buffer.byteLength(canonical(complete)) > MAX_BOOSTING_BYTES) throw new Error("quiz_fit_output_too_large");
  return complete;
}
