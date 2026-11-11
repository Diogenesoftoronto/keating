/**
 * Statistics for the model benchmark: how sure a score is, and whether two
 * models can actually be told apart. Pure, so the ranking rules are testable.
 */

export interface ScoreInterval {
	mean: number;
	/** 95% interval for the mean. Spans the whole range when there is too little data to estimate one. */
	low: number;
	high: number;
	n: number;
}

/**
 * Interval for the mean of bounded scores, from the observed spread.
 * With fewer than two scores the spread is unknown, so the interval is the
 * whole range rather than a falsely narrow point.
 */
export function meanInterval(values: readonly number[], bounds: readonly [number, number] = [0, 1], z = 1.96): ScoreInterval {
	const [min, max] = bounds;
	const finite = values.filter((value) => Number.isFinite(value));
	const n = finite.length;
	if (n === 0) return { mean: 0, low: min, high: max, n };
	const mean = finite.reduce((sum, value) => sum + value, 0) / n;
	if (n < 2) return { mean, low: min, high: max, n };
	const variance = finite.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1);
	// Identical scores give zero observed spread; that is a small sample, not certainty.
	// Floor the spread at what one differing score in the range would produce.
	const floor = (max - min) / (2 * Math.sqrt(n));
	const spread = Math.max(Math.sqrt(variance), floor);
	const half = z * spread / Math.sqrt(n);
	return { mean, low: Math.max(min, mean - half), high: Math.min(max, mean + half), n };
}

export function intervalsOverlap(a: ScoreInterval, b: ScoreInterval): boolean {
	return a.low <= b.high && b.low <= a.high;
}

export interface RankInput {
	key: string;
	/** The value models are ordered by, higher is better. */
	score: number;
	interval: ScoreInterval;
	signals: number;
}

export interface RankResult {
	/** Null until the model has enough evidence to be placed. */
	rank: number | null;
	/** The best-placed model this one cannot be separated from, if any. */
	tiedWithRank: number | null;
	signalsNeeded: number;
}

/**
 * Places only models with at least `minSignals` pieces of evidence. A model
 * below that is listed but not numbered: three good signals should never read
 * as "first place". Among placed models, overlapping intervals are reported as
 * ties instead of implying an order the data cannot support.
 */
export function rankByEvidence<T extends RankInput>(rows: readonly T[], minSignals: number): Array<T & RankResult> {
	const order = (a: T, b: T) => b.score - a.score || b.signals - a.signals || a.key.localeCompare(b.key);
	const placed = rows.filter((row) => row.signals >= minSignals).sort(order);
	const waiting = rows.filter((row) => row.signals < minSignals).sort((a, b) => b.signals - a.signals || order(a, b));
	const ranked = placed.map((row, index) => {
		const above = placed.slice(0, index).findIndex((other) => intervalsOverlap(other.interval, row.interval));
		return { ...row, rank: index + 1, tiedWithRank: above === -1 ? null : above + 1, signalsNeeded: 0 };
	});
	return [
		...ranked,
		...waiting.map((row) => ({ ...row, rank: null, tiedWithRank: null, signalsNeeded: minSignals - row.signals })),
	];
}

/** One sentence on what the ranking does and does not show. */
export function describeRanking(rows: readonly RankResult[], minSignals: number): string {
	const placed = rows.filter((row) => row.rank !== null);
	if (rows.length === 0) return "No sessions in this view yet.";
	if (placed.length === 0) return `No model has enough evidence to be ranked yet. A model is ranked once it has ${minSignals} signals.`;
	if (placed.length === 1) return "One model has enough evidence to be scored. Ranking needs a second one to compare it with.";
	const tiedWithFirst = placed.filter((row) => row.tiedWithRank === 1).length;
	if (tiedWithFirst === 0) return "The first-placed model is ahead by more than the uncertainty in its score.";
	if (tiedWithFirst === placed.length - 1) return `All ${placed.length} ranked models overlap: the current evidence cannot separate them.`;
	return `The top ${tiedWithFirst + 1} models overlap: the current evidence cannot separate them.`;
}
