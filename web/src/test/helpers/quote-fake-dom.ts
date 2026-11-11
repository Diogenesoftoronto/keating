/**
 * The repo has no DOM implementation in tests, so this is the smallest DOM
 * the passage-quote DOM code needs: elements with attributes, text nodes,
 * `closest` for simple attribute/tag selectors, a text TreeWalker, ranges and
 * a selection. Enough to drive `quote-dom.ts` with real code paths.
 */

const ELEMENT = 1;
const TEXT = 3;

type Child = FakeElement | FakeText;

function camel(name: string) {
	return name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

function matchesSimple(element: FakeElement, selector: string): boolean {
	const tag = selector.match(/^[a-z][a-z0-9]*/i)?.[0];
	if (tag && element.tagName !== tag.toLowerCase()) return false;
	for (const [, name, value] of selector.matchAll(/\[([a-z-]+)(?:=['"]?([^'"\]]*)['"]?)?\]/gi)) {
		if (!element.attributes.has(name!)) return false;
		if (value !== undefined && element.attributes.get(name!) !== value) return false;
	}
	return Boolean(tag) || selector.startsWith("[");
}

export class FakeText {
	nodeType = TEXT;
	parentElement: FakeElement | null = null;
	constructor(public data: string, public ownerDocument: FakeDocument) {}
	get parentNode() { return this.parentElement; }
	get textContent() { return this.data; }
}

export class FakeElement {
	nodeType = ELEMENT;
	parentElement: FakeElement | null = null;
	children: Child[] = [];
	attributes = new Map<string, string>();
	scrolled = 0;
	constructor(public tagName: string, public ownerDocument: FakeDocument) {}
	get parentNode() { return this.parentElement; }
	get isConnected(): boolean {
		let node: FakeElement | null = this;
		while (node.parentElement) node = node.parentElement;
		return node === this.ownerDocument.documentElement;
	}
	get dataset(): Record<string, string> {
		const out: Record<string, string> = {};
		for (const [name, value] of this.attributes) if (name.startsWith("data-")) out[camel(name.slice(5))] = value;
		return out;
	}
	get textContent(): string {
		return this.children.map((child) => child.textContent).join("");
	}
	set textContent(value: string) {
		this.children = [];
		this.append(value);
	}
	setAttribute(name: string, value: string) { this.attributes.set(name, value); }
	removeAttribute(name: string) { this.attributes.delete(name); }
	getAttribute(name: string) { return this.attributes.get(name) ?? null; }
	append(...nodes: (Child | string)[]) {
		for (const item of nodes) {
			const child = typeof item === "string" ? new FakeText(item, this.ownerDocument) : item;
			child.parentElement = this;
			this.children.push(child);
		}
		return this;
	}
	appendChild(child: Child) { this.append(child); return child; }
	matches(selector: string) { return selector.split(",").some((part) => matchesSimple(this, part.trim())); }
	closest(selector: string): FakeElement | null {
		for (let node: FakeElement | null = this; node; node = node.parentElement) if (node.matches(selector)) return node;
		return null;
	}
	contains(other: Child | null): boolean {
		for (let node: Child | FakeElement | null = other; node; node = node.parentElement) if (node === this) return true;
		return false;
	}
	descendants(): Child[] {
		return this.children.flatMap((child) => (child instanceof FakeElement ? [child, ...child.descendants()] : [child]));
	}
	querySelectorAll(selector: string): FakeElement[] {
		return this.descendants().filter((node): node is FakeElement => node instanceof FakeElement && node.matches(selector));
	}
	querySelector(selector: string) { return this.querySelectorAll(selector)[0] ?? null; }
	scrollIntoView() { this.scrolled++; }
	getClientRects() { return []; }
}

/** Document order index, for range comparisons. */
function order(doc: FakeDocument, node: Child): number {
	return [doc.documentElement, ...doc.documentElement.descendants()].indexOf(node as FakeElement);
}

export class FakeRange {
	startContainer!: Child;
	startOffset = 0;
	endContainer!: Child;
	endOffset = 0;
	constructor(private doc: FakeDocument) {}
	setStart(node: Child, offset: number) { this.startContainer = node; this.startOffset = offset; }
	setEnd(node: Child, offset: number) { this.endContainer = node; this.endOffset = offset; }
	get commonAncestorContainer(): FakeElement {
		let node = this.startContainer.parentElement!;
		while (!node.contains(this.endContainer)) node = node.parentElement!;
		return node;
	}
	comparePoint(node: Child, offset: number): number {
		const at = order(this.doc, node);
		const start = order(this.doc, this.startContainer);
		const end = order(this.doc, this.endContainer);
		if (at < start || (at === start && offset < this.startOffset)) return -1;
		if (at > end || (at === end && offset > this.endOffset)) return 1;
		return 0;
	}
	toString() { return ""; }
	getBoundingClientRect() { return { top: 100, bottom: 120, left: 40, right: 200, width: 160, height: 20 }; }
	getClientRects() { return [this.getBoundingClientRect()]; }
}

export class FakeSelection {
	range: FakeRange | null = null;
	get rangeCount() { return this.range ? 1 : 0; }
	get isCollapsed() { return !this.range || (this.range.startContainer === this.range.endContainer && this.range.startOffset === this.range.endOffset); }
	getRangeAt() { return this.range!; }
	removeAllRanges() { this.range = null; }
}

export class FakeDocument {
	documentElement: FakeElement;
	head: FakeElement;
	body: FakeElement;
	activeElement: unknown = null;
	defaultView = { matchMedia: () => ({ matches: true }) };
	constructor() {
		this.documentElement = new FakeElement("html", this);
		this.head = new FakeElement("head", this);
		this.body = new FakeElement("body", this);
		this.documentElement.append(this.head, this.body);
	}
	createElement(tag: string) { return new FakeElement(tag, this); }
	createRange() { return new FakeRange(this); }
	createTreeWalker(root: FakeElement, _what: number, filter: { acceptNode: (node: FakeText) => number }) {
		const nodes = root.descendants().filter((node): node is FakeText => node instanceof FakeText && filter.acceptNode(node) === 1);
		let index = -1;
		return { nextNode: () => nodes[++index] ?? null };
	}
	querySelectorAll(selector: string) { return this.documentElement.querySelectorAll(selector); }
	querySelector(selector: string) { return this.documentElement.querySelector(selector); }
	addEventListener() {}
	removeEventListener() {}
}

/** `el("div", { "data-x": "1" }, "text", el(...))` */
export function el(doc: FakeDocument, tag: string, attrs: Record<string, string> = {}, ...children: (FakeElement | string)[]): FakeElement {
	const element = doc.createElement(tag);
	for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, value);
	element.append(...children);
	return element;
}

/** Installs the fake as `document`/`window` globals; returns a restore function. */
export function installFakeDom(): { doc: FakeDocument; selection: FakeSelection; events: CustomEvent[]; restore: () => void } {
	// Other test files may leave these as read-only own properties; define rather
	// than assign so this helper works whatever order the files run in.
	const keys = ["document", "window", "Node", "NodeFilter", "sessionStorage"] as const;
	const saved = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
	const set = (key: (typeof keys)[number], value: unknown) =>
		Object.defineProperty(globalThis, key, { configurable: true, writable: true, enumerable: true, value });
	const doc = new FakeDocument();
	const selection = new FakeSelection();
	const events: CustomEvent[] = [];
	const target = new EventTarget();
	const store = new Map<string, string>();
	set("document", doc);
	set("Node", { ELEMENT_NODE: ELEMENT, TEXT_NODE: TEXT });
	set("NodeFilter", { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2, FILTER_SKIP: 3 });
	set("sessionStorage", {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => void store.set(key, value),
		removeItem: (key: string) => void store.delete(key),
	});
	set("window", {
		getSelection: () => selection,
		innerWidth: 360,
		innerHeight: 640,
		addEventListener: target.addEventListener.bind(target),
		removeEventListener: target.removeEventListener.bind(target),
		dispatchEvent: (event: Event) => {
			if (event instanceof CustomEvent) events.push(event);
			return target.dispatchEvent(event);
		},
	});
	return {
		doc,
		selection,
		events,
		restore: () => {
			for (const [key, descriptor] of saved) {
				if (descriptor) Object.defineProperty(globalThis, key, descriptor);
				else Reflect.deleteProperty(globalThis, key);
			}
		},
	};
}

/** Selects from `start` in one text node to `end` in another (or the same). */
export function select(selection: FakeSelection, doc: FakeDocument, from: [FakeText, number], to: [FakeText, number]) {
	const range = doc.createRange();
	range.setStart(from[0], from[1]);
	range.setEnd(to[0], to[1]);
	selection.range = range;
}

export function textNode(element: FakeElement, index = 0): FakeText {
	const texts = element.descendants().filter((node): node is FakeText => node instanceof FakeText);
	return texts[index]!;
}
