/**
 * Dio credit-pack catalog and advertised token pricing.
 *
 * Dependency-free so both the Vite client (pricing page, purchase dialog) and
 * the Nitro server (checkout, webhook) share one source of truth. Amounts are
 * USD; token rates are USD per million tokens and must match the model pricing
 * configured on the Bifrost gateway so credits draw down at the advertised
 * rate.
 */

export interface DioTokenRates {
	/** USD per 1M input tokens. */
	inputPerMTok: number;
	/** USD per 1M output tokens. */
	outputPerMTok: number;
}

export const DIO_TOKEN_RATES: DioTokenRates = {
	inputPerMTok: 1,
	outputPerMTok: 4,
};

export type DioPackId = "starter" | "plus" | "pro";

export interface DioPack {
	id: DioPackId;
	label: string;
	priceUsd: number;
	blurb: string;
	popular?: boolean;
}

export const DIO_PACKS: DioPack[] = [
	{
		id: "starter",
		label: "Starter",
		priceUsd: 10,
		blurb: "Try Keating's hosted model with room to learn a few topics deeply.",
	},
	{
		id: "plus",
		label: "Plus",
		priceUsd: 25,
		blurb: "Enough for regular study sessions, quizzes, and animations.",
		popular: true,
	},
	{
		id: "pro",
		label: "Pro",
		priceUsd: 50,
		blurb: "For daily learners and long-running projects.",
	},
];

export const DEFAULT_DIO_PACK_ID: DioPackId = "starter";

export function getDioPack(id: string): DioPack | undefined {
	return DIO_PACKS.find((pack) => pack.id === id);
}

export function isDioPackId(id: string): id is DioPackId {
	return DIO_PACKS.some((pack) => pack.id === id);
}

/** Millions of input tokens a dollar amount buys at the advertised rate. */
export function inputMTokForUsd(usd: number, rates: DioTokenRates = DIO_TOKEN_RATES): number {
	return usd / rates.inputPerMTok;
}

/** Millions of output tokens a dollar amount buys at the advertised rate. */
export function outputMTokForUsd(usd: number, rates: DioTokenRates = DIO_TOKEN_RATES): number {
	return usd / rates.outputPerMTok;
}

/** Human-readable token volume for a pack, e.g. "up to 10M in / 2.5M out". */
export function formatPackTokenVolume(pack: DioPack, rates: DioTokenRates = DIO_TOKEN_RATES): string {
	const input = formatMTok(inputMTokForUsd(pack.priceUsd, rates));
	const output = formatMTok(outputMTokForUsd(pack.priceUsd, rates));
	return `up to ${input} input / ${output} output tokens`;
}

function formatMTok(millions: number): string {
	const rounded = Number.isInteger(millions) ? millions.toString() : millions.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
	return `${rounded}M`;
}
