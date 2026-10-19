import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { decodeSystemDesignSvgLabels } from "../src/lib/system-design-svg";

const previousParser = Object.getOwnPropertyDescriptor(globalThis, "DOMParser");
const previousSerializer = Object.getOwnPropertyDescriptor(globalThis, "XMLSerializer");
beforeAll(() => {
  Object.defineProperty(globalThis, "DOMParser", { value: DOMParser, configurable: true });
  Object.defineProperty(globalThis, "XMLSerializer", { value: XMLSerializer, configurable: true });
});
afterAll(() => {
  if (previousParser) Object.defineProperty(globalThis, "DOMParser", previousParser);
  else Reflect.deleteProperty(globalThis, "DOMParser");
  if (previousSerializer) Object.defineProperty(globalThis, "XMLSerializer", previousSerializer);
  else Reflect.deleteProperty(globalThis, "XMLSerializer");
});

describe("native system-design SVG label decoding", () => {
  test("default and explicit disabled paths preserve the original SVG byte for byte", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>&amp;#47; API</text></svg>';
    expect(decodeSystemDesignSvgLabels(svg)).toBe(svg);
    expect(decodeSystemDesignSvgLabels(svg, false)).toBe(svg);
  });

  test("opted decoding changes text labels and nested tspans without touching attributes or styles", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" aria-label="&amp;#65;"><style>.label::after{content:"&amp;#65;"}</style><text data-label="&amp;#65;"><tspan>&amp;#47; API &amp;#128640;</tspan></text></svg>';
    const rendered = new DOMParser().parseFromString(decodeSystemDesignSvgLabels(svg, true), "image/svg+xml");
    expect(rendered.getElementsByTagName("text")[0]?.textContent).toBe("/ API 🚀");
    expect(rendered.getElementsByTagName("text")[0]?.getAttribute("data-label")).toBe("&#65;");
    expect(rendered.documentElement.getAttribute("aria-label")).toBe("&#65;");
    expect(rendered.getElementsByTagName("style")[0]?.textContent).toContain("&#65;");
  });

  test("markup-looking learner labels remain a single text node and never create SVG or script elements", () => {
    const label = '<script>alert(1)</script><image href="javascript:alert(1)"/>';
    const encoded = Array.from(label, (character) => `&amp;#${character.codePointAt(0)};`).join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg"><text><tspan>${encoded}</tspan></text></svg>`;
    const output = decodeSystemDesignSvgLabels(svg, true);
    const rendered = new DOMParser().parseFromString(output, "image/svg+xml");
    expect(rendered.getElementsByTagName("text")[0]?.textContent).toBe(label);
    expect(rendered.getElementsByTagName("script").length).toBe(0);
    expect(rendered.getElementsByTagName("image").length).toBe(0);
    expect(rendered.getElementsByTagName("tspan")[0]?.childNodes.length).toBe(1);
    expect(output).toContain("&lt;script&gt;");
  });

  test("entity-looking learner text is decoded once and stays literal", () => {
    // Original learner label is the literal text '&#60;', not a less-than sign.
    const output = decodeSystemDesignSvgLabels('<svg xmlns="http://www.w3.org/2000/svg"><text>&amp;#38;&amp;#35;&amp;#54;&amp;#48;&amp;#59;</text></svg>', true);
    expect(new DOMParser().parseFromString(output, "image/svg+xml").getElementsByTagName("text")[0]?.textContent).toBe("&#60;");
  });

  test("entities split across Mermaid tspans decode once while retaining every original element", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text><tspan data-part="first">&amp;</tspan><tspan data-part="second">#62;</tspan></text><text><tspan>&amp;#38;</tspan><tspan>#60;</tspan></text></svg>';
    const rendered = new DOMParser().parseFromString(decodeSystemDesignSvgLabels(svg, true), "image/svg+xml");
    const labels = rendered.getElementsByTagName("text");
    expect(labels[0]?.textContent).toBe(">");
    expect(labels[1]?.textContent).toBe("&#60;");
    const spans = rendered.getElementsByTagName("tspan");
    expect(spans.length).toBe(4);
    expect(spans[0]?.getAttribute("data-part")).toBe("first");
    expect(spans[1]?.getAttribute("data-part")).toBe("second");
  });
});
