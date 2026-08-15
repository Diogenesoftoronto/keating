import { describe, expect, test } from "bun:test";

import {
  overlayResponseTone,
  overlayTitleLines,
  truncateOverlayLabel,
} from "../src/tui/overlay.js";

describe("TUI overlays", () => {
  test("truncates display labels without losing a visible ellipsis", () => {
    expect(truncateOverlayLabel("A very long model response option", 12)).toBe("A very long…");
    expect(truncateOverlayLabel("Exact", 12)).toBe("Exact");
  });

  test("bounds overlay titles horizontally and vertically", () => {
    const lines = overlayTitleLines(
      "Generate review cards?\nGenerate a deterministic local deck for an unusually long topic name?",
      24,
      2,
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("Generate review cards?");
    expect(lines.every((line) => [...line].length <= 24)).toBe(true);
    expect(lines[1]?.endsWith("…")).toBe(true);
  });

  test("uses semantic response tones while retaining textual labels", () => {
    expect(overlayResponseTone("Yes")).toBe("success");
    expect(overlayResponseTone("No")).toBe("danger");
    expect(overlayResponseTone("0 · Again")).toBe("danger");
    expect(overlayResponseTone("1 · Hard")).toBe("warning");
    expect(overlayResponseTone("2 · Good")).toBe("info");
    expect(overlayResponseTone("3 · Easy")).toBe("success");
    expect(overlayResponseTone("Cancel")).toBe("mutedText");
  });
});
