import { expect, test } from "bun:test";

/** theme.ts imports React Native, so the scale is read from source like the other foundation checks. */
test("native reading sizes are 2 up from the first scale while title and heading keep theirs", async () => {
  const theme = await Bun.file("src/constants/theme.ts").text();
  expect(theme).toContain("title: { fontSize: 24, lineHeight: 30");
  expect(theme).toContain("heading: { fontSize: 18, lineHeight: 24");
  expect(theme).toContain("body: { fontSize: 18, lineHeight: 26");
  expect(theme).toContain("label: { fontSize: 16, lineHeight: 22");
  expect(theme).toContain("caption: { fontSize: 14, lineHeight: 19");
});

test("native model selector lets long model names wrap to a second line", async () => {
  const sheet = await Bun.file("src/components/ModelSelectorSheet.tsx").text();
  expect(sheet).toContain("<Text numberOfLines={2} style={styles.modelName}>");
});
