/**
 * Fitting the thresholds that are currently typed by hand.
 *
 * Several constants in the codebase are a linear model's coefficients written
 * from intuition and never fitted. The labels to fit them against already
 * exist — correct/incorrect, lapse/no-lapse, returned/abandoned — so the
 * missing piece is a fitter, not more data collection.
 *
 * A depth-limited tree comes first on purpose. If a depth-3 tree cannot beat
 * the hand-written constants, an ensemble will not either, and unlike an
 * ensemble the tree can be read and argued with.
 */

export interface TrainingRow {
  /** Named features. A missing feature is absent, not zero. */
  readonly features: Readonly<Record<string, number>>;
  readonly label: boolean;
  /**
   * Rows withheld from model-driven ranking. Without a holdout the model only
   * ever sees items it already chose and its own confidence becomes
   * self-confirming, so this flag is what keeps the loop honest.
   */
  readonly heldOut?: boolean;
}

export interface TreeLeaf {
  readonly kind: "leaf";
  /** Fraction of training rows at this leaf with a true label. */
  readonly probability: number;
  readonly sampleSize: number;
}

export interface TreeSplit {
  readonly kind: "split";
  readonly feature: string;
  /** Rows with `feature <= threshold` go left. */
  readonly threshold: number;
  readonly left: DecisionTree;
  readonly right: DecisionTree;
  readonly sampleSize: number;
}

export type DecisionTree = TreeLeaf | TreeSplit;

export interface TreeOptions {
  readonly maxDepth?: number;
  readonly minimumSamplesPerLeaf?: number;
}

const DEFAULT_TREE_OPTIONS = { maxDepth: 3, minimumSamplesPerLeaf: 8 } as const;

function labelRate(rows: readonly TrainingRow[]): number {
  if (rows.length === 0) return 0;
  return rows.filter((row) => row.label).length / rows.length;
}

/** Gini impurity. Zero when every row at the node shares a label. */
function impurity(rows: readonly TrainingRow[]): number {
  const rate = labelRate(rows);
  return 2 * rate * (1 - rate);
}

function leafFor(rows: readonly TrainingRow[]): TreeLeaf {
  return { kind: "leaf", probability: labelRate(rows), sampleSize: rows.length };
}

function candidateThresholds(rows: readonly TrainingRow[], feature: string): number[] {
  const values = new Set<number>();
  for (const row of rows) {
    const value = row.features[feature];
    if (Number.isFinite(value)) values.add(value);
  }
  const sorted = [...values].sort((left, right) => left - right);
  // Split at midpoints so a threshold never coincides with an observed value,
  // which would make the split order-dependent.
  return sorted.slice(0, -1).map((value, index) => (value + sorted[index + 1]) / 2);
}

/**
 * Fit a depth-limited binary tree by greedy impurity reduction.
 *
 * Held-out rows are excluded from fitting so they can score the result
 * honestly. Rows missing a feature are skipped for that feature only, rather
 * than being imputed to zero — an absent signal is not a zero signal.
 */
export function fitDecisionTree(
  rows: readonly TrainingRow[],
  options: TreeOptions = {},
): DecisionTree {
  const maxDepth = options.maxDepth ?? DEFAULT_TREE_OPTIONS.maxDepth;
  const minimumLeaf = options.minimumSamplesPerLeaf ?? DEFAULT_TREE_OPTIONS.minimumSamplesPerLeaf;
  const trainable = rows.filter((row) => row.heldOut !== true);

  const build = (subset: readonly TrainingRow[], depth: number): DecisionTree => {
    if (depth >= maxDepth || subset.length < minimumLeaf * 2 || impurity(subset) === 0) {
      return leafFor(subset);
    }
    const features = new Set<string>();
    for (const row of subset) for (const key of Object.keys(row.features)) features.add(key);

    let best: { feature: string; threshold: number; gain: number; left: TrainingRow[]; right: TrainingRow[] } | null = null;
    const parentImpurity = impurity(subset);

    for (const feature of [...features].sort()) {
      for (const threshold of candidateThresholds(subset, feature)) {
        const left: TrainingRow[] = [];
        const right: TrainingRow[] = [];
        for (const row of subset) {
          const value = row.features[feature];
          if (!Number.isFinite(value)) continue;
          (value <= threshold ? left : right).push(row);
        }
        if (left.length < minimumLeaf || right.length < minimumLeaf) continue;
        const total = left.length + right.length;
        const weighted = (left.length / total) * impurity(left) + (right.length / total) * impurity(right);
        const gain = parentImpurity - weighted;
        if (gain > (best?.gain ?? 0) + 1e-12) best = { feature, threshold, gain, left, right };
      }
    }

    if (best === null) return leafFor(subset);
    return {
      kind: "split",
      feature: best.feature,
      threshold: best.threshold,
      left: build(best.left, depth + 1),
      right: build(best.right, depth + 1),
      sampleSize: subset.length,
    };
  };

  return build(trainable, 0);
}

/** Predict P(label). A row missing the split feature stops at the current node. */
export function predictTree(tree: DecisionTree, features: Readonly<Record<string, number>>): number {
  let node = tree;
  for (;;) {
    if (node.kind === "leaf") return node.probability;
    const value = features[node.feature];
    if (!Number.isFinite(value)) return nodeProbability(node);
    node = value <= node.threshold ? node.left : node.right;
  }
}

/** Sample-weighted mean probability beneath a node. */
function nodeProbability(node: DecisionTree): number {
  if (node.kind === "leaf") return node.probability;
  const total = node.left.sampleSize + node.right.sampleSize;
  if (total === 0) return 0;
  return (nodeProbability(node.left) * node.left.sampleSize
    + nodeProbability(node.right) * node.right.sampleSize) / total;
}

export function treeDepth(tree: DecisionTree): number {
  return tree.kind === "leaf" ? 0 : 1 + Math.max(treeDepth(tree.left), treeDepth(tree.right));
}

/** Features the tree actually used. A feature absent here earned no split. */
export function treeFeatures(tree: DecisionTree): string[] {
  const found = new Set<string>();
  const walk = (node: DecisionTree): void => {
    if (node.kind === "leaf") return;
    found.add(node.feature);
    walk(node.left);
    walk(node.right);
  };
  walk(tree);
  return [...found].sort();
}

export interface BaselineComparison {
  readonly candidateBrier: number;
  readonly baselineBrier: number;
  /** Positive when the candidate is better; Brier is an error, so lower wins. */
  readonly improvement: number;
  readonly beatsBaseline: boolean;
  readonly sampleSize: number;
}

/**
 * Score a fitted model against the incumbent on held-out rows only.
 *
 * Returns null when nothing was held out: a model evaluated on its own training
 * rows will always look good, and reporting that number would be worse than
 * reporting none.
 */
export function compareAgainstBaseline(
  rows: readonly TrainingRow[],
  candidate: (features: Readonly<Record<string, number>>) => number,
  baseline: (features: Readonly<Record<string, number>>) => number,
): BaselineComparison | null {
  const heldOut = rows.filter((row) => row.heldOut === true);
  if (heldOut.length === 0) return null;

  let candidateError = 0;
  let baselineError = 0;
  for (const row of heldOut) {
    const actual = row.label ? 1 : 0;
    candidateError += (candidate(row.features) - actual) ** 2;
    baselineError += (baseline(row.features) - actual) ** 2;
  }
  const candidateBrier = candidateError / heldOut.length;
  const baselineBrier = baselineError / heldOut.length;
  return {
    candidateBrier,
    baselineBrier,
    improvement: baselineBrier - candidateBrier,
    beatsBaseline: candidateBrier < baselineBrier,
    sampleSize: heldOut.length,
  };
}

/**
 * Deterministically mark a fraction of rows as held out.
 *
 * Assignment is by index rather than at random so the same dataset always
 * produces the same split, which is what makes two fitting runs comparable.
 */
export function withHoldout(rows: readonly TrainingRow[], fraction: number): TrainingRow[] {
  if (!Number.isFinite(fraction) || fraction <= 0) return rows.map((row) => ({ ...row, heldOut: false }));
  const stride = Math.max(2, Math.round(1 / Math.min(1, fraction)));
  return rows.map((row, index) => ({ ...row, heldOut: index % stride === 0 }));
}
