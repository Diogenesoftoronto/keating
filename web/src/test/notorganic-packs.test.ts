import { describe, expect, it } from "bun:test";
import {
	DEFAULT_NOTORGANIC_PACK_ID,
	NOTORGANIC_PACKS,
	getNotOrganicPack,
	isNotOrganicPackId,
} from "../notorganic-provider/packs";

describe("Not Organic Keating pack catalog", () => {
	it("matches the provider grant ids and advertised values", () => {
		expect(NOTORGANIC_PACKS.map((pack) => [pack.id, pack.priceUsd])).toEqual([
			["keating_pack_10", 10],
			["keating_pack_25", 25],
			["keating_pack_50", 50],
		]);
		expect(DEFAULT_NOTORGANIC_PACK_ID).toBe("keating_pack_10");
		expect(getNotOrganicPack("keating_pack_25")?.popular).toBe(true);
		expect(isNotOrganicPackId("keating_pack_50")).toBe(true);
		expect(isNotOrganicPackId("starter")).toBe(false);
	});
});
