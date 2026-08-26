import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
  TUTORIAL_SURFACES,
  TutorialSurfaceAtlas,
} from "../components/TutorialSurfaceAtlas";

describe("TutorialSurfaceAtlas", () => {
  test("keeps the current learner-facing surfaces visible and directly navigable", () => {
    const html = renderToStaticMarkup(<TutorialSurfaceAtlas />);

    expect(TUTORIAL_SURFACES.map((surface) => surface.id)).toEqual([
      "classroom",
      "models",
      "live",
      "review",
      "coming-up",
      "courses",
      "usage",
      "bench",
      "tui",
      "cli",
      "publishing",
    ]);
    for (const surface of TUTORIAL_SURFACES) {
      expect(html).toContain(`id="surface-${surface.id}"`);
      expect(html).toContain(`href="${surface.href.replaceAll("&", "&amp;")}"`);
      expect(html).toContain(`src="${surface.image}"`);
      expect(surface.alt.length).toBeGreaterThan(24);
    }
  });

  test("does not treat callback and share transitions as tutorial destinations", () => {
    const destinations = TUTORIAL_SURFACES.map((surface) => surface.href).join(" ");

    expect(destinations).not.toContain("callback");
    expect(destinations).not.toContain("/s/");
  });
});
