/**
 * Not Organic credit-pack catalog shown by Keating.
 *
 * Dependency-free so the Vite client and Nitro checkout allowlist share one
 * source of truth. Product ids match the provider's grant catalog.
 */

export type NotOrganicPackId = "keating_pack_10" | "keating_pack_25" | "keating_pack_50";

export interface NotOrganicPack {
	id: NotOrganicPackId;
	label: string;
	priceUsd: number;
	blurb: string;
	popular?: boolean;
}

export const NOTORGANIC_PACKS: NotOrganicPack[] = [
	{
		id: "keating_pack_10",
		label: "Starter",
		priceUsd: 10,
		blurb: "Try Keating's hosted model with room to learn a few topics deeply.",
	},
	{
		id: "keating_pack_25",
		label: "Plus",
		priceUsd: 25,
		blurb: "Enough for regular study sessions, quizzes, and animations.",
		popular: true,
	},
	{
		id: "keating_pack_50",
		label: "Pro",
		priceUsd: 50,
		blurb: "For daily learners and long-running projects.",
	},
];

export const DEFAULT_NOTORGANIC_PACK_ID: NotOrganicPackId = "keating_pack_10";

export function getNotOrganicPack(id: string): NotOrganicPack | undefined {
	return NOTORGANIC_PACKS.find((pack) => pack.id === id);
}

export function isNotOrganicPackId(id: string): id is NotOrganicPackId {
	return NOTORGANIC_PACKS.some((pack) => pack.id === id);
}
