const FORBIDDEN_ELEMENTS = new Set(["script", "foreignobject", "iframe", "object", "embed", "link", "meta", "base"]);
const URL_ATTRIBUTES = new Set(["href", "xlink:href", "src"]);

function hasUnsafeCss(value: string): boolean {
	const lower = value.toLowerCase();
	return lower.includes("javascript:") || lower.includes("@import") || lower.includes("expression(");
}

function isSafeUrlAttribute(value: string): boolean {
	const trimmed = value.trim().toLowerCase();
	return (
		trimmed === "" ||
		trimmed.startsWith("#") ||
		trimmed.startsWith("data:image/png") ||
		trimmed.startsWith("data:image/jpeg") ||
		trimmed.startsWith("data:image/gif") ||
		trimmed.startsWith("data:image/webp")
	);
}

// Mermaid emits SVG markup that is not always well-formed XML — most commonly
// HTML entities (e.g. `&nbsp;`) that are undefined in XML, which makes the
// strict `image/svg+xml` parser bail with a <parsererror>. Parsing that output
// as HTML instead is lenient about entities and, per the HTML spec's SVG
// attribute-adjustment table, preserves camelCase SVG attributes like
// `viewBox`/`preserveAspectRatio`. We try strict XML first (to keep behavior
// identical for well-formed input) and only fall back to the HTML parser when
// XML parsing fails, so a valid diagram is never silently dropped.
function parseSvgRoot(svg: string): SVGElement | null {
	const xmlDoc = new DOMParser().parseFromString(svg, "image/svg+xml");
	if (!xmlDoc.querySelector("parsererror")) {
		const xmlRoot = xmlDoc.documentElement;
		if (xmlRoot && xmlRoot.tagName.toLowerCase() === "svg") {
			return xmlRoot as unknown as SVGElement;
		}
	}

	// Lenient fallback: parse as HTML and pull the first <svg> element.
	const htmlDoc = new DOMParser().parseFromString(svg, "text/html");
	const htmlRoot = htmlDoc.querySelector("svg");
	return htmlRoot ?? null;
}

export function sanitizeSvg(svg: string): string {
	if (typeof DOMParser === "undefined" || typeof XMLSerializer === "undefined") {
		return "";
	}

	const root = parseSvgRoot(svg);
	if (!root) return "";
	const doc = root.ownerDocument;
	const showElement = typeof NodeFilter === "undefined" ? 1 : NodeFilter.SHOW_ELEMENT;

	const removals: Element[] = [];
	const walker = doc.createTreeWalker(root, showElement);
	let current: Node | null = walker.currentNode;

	while (current) {
		const element = current as Element;
		const tagName = element.tagName.toLowerCase();
		if (FORBIDDEN_ELEMENTS.has(tagName)) {
			removals.push(element);
		} else {
			for (const attribute of Array.from(element.attributes)) {
				const name = attribute.name.toLowerCase();
				const value = attribute.value;
				if (name.startsWith("on")) {
					element.removeAttribute(attribute.name);
					continue;
				}
				if (name === "style" && hasUnsafeCss(value)) {
					element.removeAttribute(attribute.name);
					continue;
				}
				if (URL_ATTRIBUTES.has(name) && !isSafeUrlAttribute(value)) {
					element.removeAttribute(attribute.name);
				}
			}
			if (tagName === "style" && hasUnsafeCss(element.textContent ?? "")) {
				removals.push(element);
			}
		}
		current = walker.nextNode();
	}

	for (const element of removals) {
		element.remove();
	}

	return new XMLSerializer().serializeToString(root);
}
