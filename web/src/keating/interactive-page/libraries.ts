/**
 * The pinned library allowlist for interactive pages.
 *
 * A page gets no network by default. When the tutor asks for a library by id,
 * the builder adds that library's exact versioned jsDelivr URLs to the frame's
 * CSP and injects the tags itself (with Subresource Integrity where the file is
 * loaded by a tag). Nothing else on the CDN is reachable: CSP source paths
 * without a trailing slash match one file exactly; the only prefixes are the
 * KaTeX font folder and the three.js addons folder of the same pinned release.
 *
 * Residual channel, stated honestly: CSP path matching ignores the query
 * string, so a page that requested a library could append `?x=...` to an
 * allowed URL and put data in a request to cdn.jsdelivr.net. That leaks only
 * to the CDN's logs, not to an attacker-chosen host, and only for pages that
 * asked for a library.
 *
 * Hashes were computed from the published files (sha384, base64).
 */

const CDN = "https://cdn.jsdelivr.net/npm";

export interface InteractivePageLibrary {
	id: InteractiveLibraryId;
	label: string;
	version: string;
	/** Classic scripts injected with integrity; their global is listed in the guide. */
	scripts: { src: string; integrity: string }[];
	styles: { href: string; integrity: string }[];
	/** Extra CSP sources (exact files or folder prefixes ending in "/"). */
	scriptSources: string[];
	fontSources: string[];
	/** ES module import map entries. */
	imports: Record<string, string>;
	usage: string;
}

export type InteractiveLibraryId = "d3" | "katex" | "three";

export const INTERACTIVE_PAGE_LIBRARIES: Record<InteractiveLibraryId, InteractivePageLibrary> = {
	d3: {
		id: "d3",
		label: "D3",
		version: "7.9.0",
		scripts: [{ src: `${CDN}/d3@7.9.0/dist/d3.min.js`, integrity: "sha384-CjloA8y00+1SDAUkjs099PVfnY2KmDC2BZnws9kh8D/lX1s46w6EPhpXdqMfjK6i" }],
		styles: [],
		scriptSources: [],
		fontSources: [],
		imports: {},
		usage: "Global `d3` (v7) is defined before your scripts run.",
	},
	katex: {
		id: "katex",
		label: "KaTeX",
		version: "0.16.22",
		scripts: [{ src: `${CDN}/katex@0.16.22/dist/katex.min.js`, integrity: "sha384-cMkvdD8LoxVzGF/RPUKAcvmm49FQ0oxwDF3BGKtDXcEc+T1b2N+teh/OJfpU0jr6" }],
		styles: [{ href: `${CDN}/katex@0.16.22/dist/katex.min.css`, integrity: "sha384-5TcZemv2l/9On385z///+d7MSYlvIEw9FuZTIdZ14vJLqWphw7e7ZPuOiCHJcFCP" }],
		scriptSources: [],
		fontSources: [`${CDN}/katex@0.16.22/dist/fonts/`],
		imports: {},
		usage: "Global `katex`; call `katex.render(tex, element, { throwOnError: false })`.",
	},
	three: {
		id: "three",
		label: "three.js",
		version: "0.170.0",
		scripts: [],
		styles: [],
		// Module imports cannot carry integrity without import-map integrity support, so the
		// exact file and the release's own addons folder are allowed by CSP instead.
		scriptSources: [`${CDN}/three@0.170.0/build/three.module.min.js`, `${CDN}/three@0.170.0/examples/jsm/`],
		fontSources: [],
		imports: {
			three: `${CDN}/three@0.170.0/build/three.module.min.js`,
			"three/addons/": `${CDN}/three@0.170.0/examples/jsm/`,
		},
		usage: "Use `<script type=\"module\">import * as THREE from \"three\"; import { OrbitControls } from \"three/addons/controls/OrbitControls.js\";</script>`.",
	},
};

export function isInteractiveLibraryId(value: unknown): value is InteractiveLibraryId {
	return typeof value === "string" && Object.hasOwn(INTERACTIVE_PAGE_LIBRARIES, value);
}
