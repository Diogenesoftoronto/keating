import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ModelPicker, orderedPickerItems, type PickerItem } from "../components/ModelPicker";
import { NOTORGANIC_DEFAULT_MODEL } from "../notorganic-provider";

const cloud: PickerItem = {
 id: `notorganic::${NOTORGANIC_DEFAULT_MODEL.api}::${NOTORGANIC_DEFAULT_MODEL.id}`, name: NOTORGANIC_DEFAULT_MODEL.name,
 group: "notorganic", pinnedLabel: "Provider default",
};
const other: PickerItem = { id: "other-model", name: "Other model", group: "Other provider" };
const browser: PickerItem = { id: "browser-model", name: "Browser model", group: "On this device" };
const items = [browser, other, cloud];

describe("provider default pinning", () => {
 it("stays first after switching to another model without changing the selection", () => {
  for (const selected of [cloud.id, other.id, browser.id]) {
   const ordered = orderedPickerItems(items, "", selected);
   expect(ordered[0]).toBe(cloud);
   expect(ordered.filter(item => item.id === cloud.id)).toHaveLength(1);
   if (selected !== cloud.id) expect(ordered[1].id).toBe(selected);
  }
  expect(items).toEqual([browser, other, cloud]);
 });

 it("keeps the default above search results while matching other models normally", () => {
  expect(orderedPickerItems(items, " OTHER ", browser.id)).toEqual([cloud, other]);
  expect(orderedPickerItems(items, "notorganic", other.id)).toEqual([cloud]);
  expect(orderedPickerItems(items, "no matching name", other.id)).toEqual([cloud]);
 });

 it("does not restore a default excluded by the caller or pin image/speech models", () => {
  expect(orderedPickerItems([browser, other], "", other.id)).toEqual([other, browser]);
  expect(orderedPickerItems([browser, other], "browser", other.id)).toEqual([browser]);
  expect(orderedPickerItems([], "", cloud.id)).toEqual([]);
 });

 it("renders Provider default first and retains the other model's selected state", () => {
  const html = renderToStaticMarkup(<ModelPicker open label="Find a model" items={items}
   selected={other.id} onSelect={() => { throw new Error("Rendering must not select a model"); }} onClose={() => {}} />);
  expect(html.indexOf("Provider default")).toBeLessThan(html.indexOf("Selected model"));
  expect(html.indexOf(cloud.name)).toBeLessThan(html.indexOf(other.name));
  expect(html).toMatch(/aria-pressed="false"[^>]*>[\s\S]*?GPT-6 Luna/);
  expect(html).toMatch(/aria-pressed="true"[^>]*>[\s\S]*?Other model/);
  expect(html.match(/Provider default/g)).toHaveLength(1);
 });

	it("keeps the default label when it is also selected", () => {
  const html = renderToStaticMarkup(<ModelPicker open label="Find a model" items={items}
   selected={cloud.id} onSelect={() => {}} onClose={() => {}} />);
  expect(html).toContain("Provider default");
  expect(html).not.toContain("Selected model");
		expect(html).toContain('aria-label="Selected"');
	});

	it("lists recently used models after the selection, and drops the heading while searching", () => {
		const recentA: PickerItem = { id: "recent-a", name: "Recent A", group: "Provider A", recent: true };
		const plainB: PickerItem = { id: "plain-b", name: "Plain B", group: "Provider A" };
		const list = [plainB, other, recentA, cloud];
		expect(orderedPickerItems(list, "", other.id).map(item => item.id)).toEqual([cloud.id, other.id, recentA.id, plainB.id]);
		// A recent model that is also selected appears once, as the selection.
		expect(orderedPickerItems(list, "", recentA.id).map(item => item.id)).toEqual([cloud.id, recentA.id, plainB.id, other.id]);
		expect(orderedPickerItems(list, "recent", other.id).map(item => item.id)).toEqual([cloud.id, recentA.id]);
		const html = renderToStaticMarkup(<ModelPicker open label="Find a model" items={list} selected={other.id} onSelect={() => {}} onClose={() => {}} />);
		expect(html.indexOf("Selected model")).toBeLessThan(html.indexOf("Recently used"));
		expect(html.indexOf("Recently used")).toBeLessThan(html.indexOf("Recent A"));
		expect(html.indexOf("Recent A")).toBeLessThan(html.indexOf("Plain B"));
	});

	it("renders a recovery action for an unavailable selection", () => {
		const html = renderToStaticMarkup(<ModelPicker open label="Find a model" items={[
			{ ...other, providerStatus: "setup-required" }, { ...cloud, providerStatus: "connected" }, browser,
		]} selected={other.id} error="Provider is not connected." errorAction={<button type="button">Open provider settings</button>}
			onSelect={() => {}} onClose={() => {}} />);
		expect(html).toContain('data-provider-status="connected"');
		expect(html).toContain('data-provider-status="setup-required"');
		expect(html.match(/data-provider-status=/g)).toHaveLength(2);
		expect(html).toContain('aria-label="Other provider setup help"');
		expect(html).toMatch(/popover="auto" role="tooltip"[^>]*>Connect Other provider to use this model/);
		expect(html).not.toContain("model-picker__item-action");
		expect(html).toContain("Provider is not connected.");
		expect(html).toContain("Open provider settings");
	});
});
