import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { authRecoveryProvider, ProviderAuthRecovery } from "../components/ProviderAuthRecovery";

const onRecover = async () => false;

describe("provider authentication recovery", () => {
	it("offers account sign-in for a selected Not Organic model despite generic credential text", () => {
		const html = renderToStaticMarkup(<ProviderAuthRecovery selectedProvider="notorganic" failedProvider="openai"
			recovery="Re-enter the provider credentials." onRecover={onRecover} />);
		expect(html).toContain("Sign in / Sign up</button>");
		expect(html).toContain("Sign in or sign up with Not Organic");
		expect(html).not.toContain("Re-enter API key");
		expect(html).not.toContain("Need a key?");
	});

	it("keeps API key recovery and its setup guide for other selected providers", () => {
		const html = renderToStaticMarkup(<ProviderAuthRecovery selectedProvider="openai" failedProvider="notorganic"
			onRecover={onRecover} />);
		expect(html).toContain("Re-enter API key</button>");
		expect(html).toContain("Need a key?");
		expect(html).not.toContain("Sign in / Sign up");
	});

	it("uses the failed message provider when no model selection is available", () => {
		expect(authRecoveryProvider(undefined, "notorganic")).toBe("notorganic");
		expect(authRecoveryProvider(" ", "openai")).toBe("openai");
		const html = renderToStaticMarkup(<ProviderAuthRecovery failedProvider="notorganic" onRecover={onRecover} />);
		expect(html).toContain("Sign in / Sign up</button>");
	});

	it("authenticates the provider that will retry the message after a model change", () => {
		expect(authRecoveryProvider("notorganic", "openai")).toBe("notorganic");
		expect(authRecoveryProvider("openai", "notorganic")).toBe("openai");
	});
});
