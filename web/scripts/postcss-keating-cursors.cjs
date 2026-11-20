/**
 * Points every plain `cursor: <keyword>` at the matching Keating cursor, keeping the keyword as the fallback:
 *   cursor: pointer  ->  cursor: var(--kc-hand, pointer)
 * The variables exist only while Keating cursors are switched on (web/src/design-system/cursors), so with the
 * feature off, on touch screens, or before the script runs, every declaration means exactly what it did before.
 */
const NAMES = {
	default: "arrow",
	pointer: "hand",
	text: "text",
	grab: "grab",
	grabbing: "grabbing",
	"not-allowed": "no",
	crosshair: "cross",
	"col-resize": "col",
	"row-resize": "row",
	"ew-resize": "ew",
	"zoom-in": "zoom",
	help: "help",
	copy: "copy",
	wait: "wait",
	progress: "wait",
};
function rewrite(value) {
	const important = /\s*!important\s*$/i.test(value);
	const keyword = value.replace(/\s*!important\s*$/i, "").trim().toLowerCase();
	const name = Object.prototype.hasOwnProperty.call(NAMES, keyword) ? NAMES[keyword] : undefined;
	return name ? `var(--kc-${name}, ${keyword})${important ? " !important" : ""}` : undefined;
}
const plugin = () => ({
	postcssPlugin: "keating-cursors",
	Declaration: {
		cursor(decl) {
			const next = rewrite(decl.value);
			if (next) decl.value = next;
		},
	},
});
plugin.postcss = true;
plugin.rewrite = rewrite;
module.exports = plugin;
