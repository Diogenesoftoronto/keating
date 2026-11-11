/**
 * One answer to "should this move?". True when the learner asked for less
 * motion, either in the operating system or with Keating's own "Reduce motion"
 * setting (which sets `data-reduce-motion` on <html>). CSS honours both in
 * learner-accessibility.css; scripted motion must ask here.
 */
export function motionReduced(doc: Document | undefined = typeof document === "undefined" ? undefined : document): boolean {
	if (!doc) return false;
	try {
		if (doc.documentElement.dataset.reduceMotion === "true") return true;
		return doc.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
	} catch {
		return false;
	}
}

/** Scroll behaviour for scripted scrolling: smooth only when motion is welcome. */
export function scrollBehavior(doc?: Document): ScrollBehavior {
	return motionReduced(doc) ? "auto" : "smooth";
}

/**
 * Makes everything outside `element` inert while it is presented as a modal,
 * without moving it in the DOM (an iframe reloads if it is re-parented).
 * Returns the function that undoes it.
 */
export function isolateForModal(element: HTMLElement): () => void {
	const changed: HTMLElement[] = [];
	let node: HTMLElement | null = element;
	while (node && node !== node.ownerDocument.body) {
		const parent: HTMLElement | null = node.parentElement;
		if (!parent) break;
		for (const sibling of Array.from(parent.children)) {
			if (sibling === node || !(sibling instanceof HTMLElement) || sibling.inert) continue;
			sibling.inert = true;
			changed.push(sibling);
		}
		node = parent;
	}
	return () => { for (const sibling of changed) sibling.inert = false; };
}
