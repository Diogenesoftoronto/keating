import { decodeSystemDesignTextRuns } from "@keating/learner-contracts";

/** Only call on sanitized SVG. Decoded labels remain text, never markup or attributes. */
export function decodeSystemDesignSvgLabels(svg: string, enabled = false): string {
  if (!enabled) return svg;
  const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
  if (parsed.documentElement.localName !== "svg" || parsed.getElementsByTagName("parsererror").length) throw new Error("Invalid generated SVG.");
  for (const label of Array.from(parsed.getElementsByTagNameNS("http://www.w3.org/2000/svg", "text"))) {
    const nodes: Node[] = [];
    const collectText = (node: Node) => {
      if (node.nodeType === 3) nodes.push(node);
      else for (const child of Array.from(node.childNodes)) collectText(child);
    };
    collectText(label);
    const decoded = decodeSystemDesignTextRuns(nodes.map((node) => node.textContent ?? ""));
    nodes.forEach((node, index) => { node.textContent = decoded[index]!; });
  }
  return new XMLSerializer().serializeToString(parsed.documentElement);
}
