import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import {
	closeCreditWaitlist,
	CreditWaitlistPanel,
	getActiveCreditWaitlistRequest,
	promptCreditWaitlist,
} from "../components/CreditWaitlistDialog";
import { NOTORGANIC_PACKS } from "../notorganic-provider/packs";

const originalWindow = (globalThis as { window?: unknown }).window;

describe("credit waitlist", () => {
	beforeEach(() => {
		(globalThis as { window?: unknown }).window = globalThis;
	});

	afterEach(() => {
		closeCreditWaitlist();
		if (originalWindow === undefined) {
			delete (globalThis as { window?: unknown }).window;
		} else {
			(globalThis as { window?: unknown }).window = originalWindow;
		}
	});

	test("retains the selected pack and pricing experiment variant", () => {
		promptCreditWaitlist("keating_pack_25", "test");
		expect(getActiveCreditWaitlistRequest()).toMatchObject({
			packId: "keating_pack_25",
			pricingVariant: "test",
		});
	});

	test("never claims an email was captured when registration fails", () => {
		const html = renderToStaticMarkup(
			<CreditWaitlistPanel
				pack={NOTORGANIC_PACKS[0]}
				state="error"
				onJoin={() => {}}
				onDismiss={() => {}}
			/>,
		);
		expect(html).toContain("Your email couldn&#x27;t be saved");
		expect(html).toContain("Join the email waitlist");
		expect(html).not.toContain("You&#x27;re on the list");
	});
});
