import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ModelPicker, orderedPickerItems, type PickerItem } from "../components/ModelPicker";
import { NOTORGANIC_DEFAULT_MODEL } from "../notorganic-provider";

const cloud: PickerItem = {
 id: "notorganic::openai-completions::balanced", name: NOTORGANIC_DEFAULT_MODEL.name,
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
  expect(html).toMatch(/aria-pressed="false"[^>]*>[\s\S]*?Inkling Small/);
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
});
