import { resolve } from "node:path";
import { createTestRenderer } from "@opentui/core/testing";
import { CodeRenderable, type BaseRenderable } from "@opentui/core";
import { buildRegistry } from "textbook-sh";

// Registry import failures are warnings in Textbook; make them fatal here.
let importFailed = false;
const warn = console.warn;
let renderFailed = false;
const reportError = console.error;
console.error = (...args: unknown[]) => {
  renderFailed = true;
  reportError(...args);
};
console.warn = (...args: unknown[]) => {
  importFailed = true;
  warn(...args);
};
const registry = await buildRegistry({ cwd: resolve("textbook"), pattern: "**/*.stories.ts" });
console.warn = warn;
if (importFailed || registry.allStories.length === 0) {
  throw new Error("Textbook failed to discover a complete, nonempty story catalog");
}

function codeBlocks(root: BaseRenderable): CodeRenderable[] {
  return [
    ...(root instanceof CodeRenderable ? [root] : []),
    ...root.getChildren().flatMap(codeBlocks),
  ];
}

for (const [width, height] of [[60, 20], [120, 36]] as const) {
  for (const story of registry.allStories) {
    const setup = await createTestRenderer({ width, height, exitOnCtrlC: false });
    try {
      setup.renderer.root.add(await story.render(setup.renderer));
      await setup.flush();
      await Promise.all(codeBlocks(setup.renderer.root)
        .filter((block) => block.isHighlighting)
        .map((block) => block.highlightingDone));
      await setup.flush();
      if (!setup.captureCharFrame().trim()) throw new Error("Story rendered an empty frame");
      console.log(`Rendered ${story.id} at ${width}x${height}`);
    } finally {
      setup.renderer.destroy();
    }
    if (renderFailed) throw new Error(`OpenTUI reported an error rendering or destroying ${story.id}`);
  }
}
console.error = reportError;
console.log(`Textbook: ${registry.allStories.length} stories loaded and rendered at both sizes.`);
