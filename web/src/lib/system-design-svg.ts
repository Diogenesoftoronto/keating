import { decodeSystemDesignTextRuns } from "@keating/learner-contracts";

/** Mermaid's SVG text renderer preserves numeric entities. Decode text nodes, never markup. */
export function decodeSystemDesignSvgLabels(svg: string): string {
  const document = new DOMParser().parseFromString(svg, "image/svg+xml");
  if (document.querySelector("parsererror")) throw new Error("Invalid diagram SVG.");
  for (const text of document.querySelectorAll("text")) {
    const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT);
    const nodes: Node[] = [];
    let node = walker.nextNode();
    while (node) {
      nodes.push(node);
      node = walker.nextNode();
    }
    const decoded = decodeSystemDesignTextRuns(nodes.map((entry) => entry.textContent ?? ""));
    nodes.forEach((entry, index) => { entry.textContent = decoded[index]!; });
  }
  return new XMLSerializer().serializeToString(document.documentElement);
}
