import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { resolveDestination } from "../groups";
import { ModelDownloadBar } from "../../ModelDownloadBar";
import { IDLE_DOWNLOAD_PROGRESS } from "../../../lib/model-download-progress";
import {
	ProviderDialog,
	INITIAL_PROVIDER_FORM,
} from "../CustomProvidersSection";

test("every models destination has its own editor and the configuration aside", () => {
	const { group } = resolveDestination("models");
	expect(group.sections).toHaveLength(8);
	expect(new Set(group.sections.map((s) => s.component)).size).toBe(8);
	expect(group.sections.every((s) => s.aside)).toBe(true);
	for (const [alias, id] of [
		["my-models", "providers"],
		["custom-providers", "providers"],
		["web-search", "sources"],
		["ui-reasoning", "jobs"],
		["proxy", "build"],
	]) {
		expect(resolveDestination(alias).section.id).toBe(id);
		expect(resolveDestination(alias).anchor).toBe("settings-section-" + alias);
	}
});
test("the build note describes both deployment environments without editable fields", () => {
	const Pane = resolveDestination("proxy").section.component;
	const html = renderToStaticMarkup(<Pane />);
	expect(html).toContain("/api/chat-proxy");
	expect(html).toContain("Production accepts secure public HTTPS");
	expect(html).toContain("Hyperframes");
	expect(html).toContain("<dl");
	expect(html).not.toContain("<input");
});
test("custom endpoint sheet associates its labels with the editable fields", () => {
	const html = renderToStaticMarkup(
		<ProviderDialog
			dialog={{ open: true }}
			form={{ ...INITIAL_PROVIDER_FORM, type: "gateway" }}
			error=""
			saving={false}
			onChange={() => {}}
			onClose={() => {}}
			onSave={() => {}}
		/>,
	);
	for (const name of ["name", "type", "gatewayKind", "baseUrl", "apiKey"]) {
		expect(html).toContain('for="provider-form-' + name + '"');
		expect(html).toContain('id="provider-form-' + name + '"');
	}
});
test("browser download meters announce measured and unknown progress", () => {
	const progress = {
		...IDLE_DOWNLOAD_PROGRESS,
		phase: "downloading" as const,
		bytesTotal: 100,
		bytesLoaded: 25,
		percent: 25,
	};
	const measured = renderToStaticMarkup(
		<ModelDownloadBar progress={progress} modelName="Example" />,
	);
	expect(measured).toContain('role="progressbar"');
	expect(measured).toContain('aria-valuenow="25"');
	expect(
		renderToStaticMarkup(
			<ModelDownloadBar progress={{ ...progress, bytesTotal: 0 }} />,
		),
	).not.toContain("aria-valuenow");
});
