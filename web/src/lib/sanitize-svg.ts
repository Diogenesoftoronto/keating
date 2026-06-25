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

export function sanitizeSvg(svg: string): string {
	if (typeof DOMParser === "undefined" || typeof XMLSerializer === "undefined") {
		return "";
	}

	const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
	if (doc.querySelector("parsererror")) return "";
	const root = doc.documentElement;
	if (!root || root.tagName.toLowerCase() !== "svg") return "";

	const removals: Element[] = [];
	const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
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
