import { INTERACTIVE_PAGE_LIBRARIES } from "./libraries";
import { INTERACTIVE_PAGE_LIMITS } from "./protocol";
import { INTERACTIVE_PAGE_THEME_VARIABLES } from "./theme";

const libraryLines = Object.values(INTERACTIVE_PAGE_LIBRARIES).map((library) => `- \`${library.id}\` (${library.label} ${library.version}): ${library.usage}`);

/** Given to the tutor model wherever it may author an interactive page. */
export const INTERACTIVE_PAGE_AUTHORING_GUIDE = [
	"## Interactive pages",
	"You can write one self-contained HTML page (inline CSS and JS) that renders inline in the chat for the learner to manipulate. Use it when doing beats reading: a parameter to drag, a model to step through, a small exercise to check. Prefer a built-in component when one fits.",
	"",
	"### Sandbox",
	`- Max ${INTERACTIVE_PAGE_LIMITS.maxHtmlBytes / 1024} KB of HTML. Everything inline: no external scripts, styles, images, fonts or fetch. Network requests are blocked.`,
	"- No localStorage, cookies, alert/confirm/prompt, popups, downloads or form submission. Use `<button type=\"button\">` with click handlers, never `<form>` submit.",
	"- Do not navigate the page (`location`, meta refresh, `<base>`): the page is torn down if it navigates. Links open in a new tab only when the learner clicks them.",
	"- Images: inline SVG, <canvas>, or data: URLs.",
	"",
	"### Libraries (optional, request by id; nothing else loads)",
	...libraryLines,
	"",
	"### Theme",
	`- Colors and fonts come from CSS variables on :root that follow the learner's light/dark theme live: ${INTERACTIVE_PAGE_THEME_VARIABLES.join(", ")}. Never hard-code colors; for canvas, read them with getComputedStyle(document.documentElement).getPropertyValue("--primary") and redraw on the \`keating:context\` window event.`,
	"- The base sheet already sets background, text color, font, themed buttons/inputs/ranges and focus rings. `.keating-sr-only` hides text visually but keeps it for screen readers.",
	"",
	"### Layout",
	"- The frame is the chat column: about 360px on phones up to ~760px. Use fluid widths (%, flex, grid, max-width) and make 360px work with no horizontal scroll. Give canvases/SVG a width of 100% and a fixed pixel height (or viewBox).",
	"- Height follows your content automatically. Never use vh/vw units or height:100% on html/body.",
	"- Do not paint an outer page background, outer card, border or banner title: the chat already frames the page. Inner panels may use var(--card) with var(--radius) corners and 12-16px padding.",
	"",
	"### window.keating",
	"- `keating.ready()`: call once the page is interactive (it is also called automatically on load). A page that never loads is shown as crashed.",
	`- \`keating.getState()\` / \`keating.setState(json)\`: resumable page state (plain JSON, <= ${INTERACTIVE_PAGE_LIMITS.maxStateBytes / 1024} KB; larger throws RangeError). Restore from getState() at start-up; call setState after each meaningful learner change (it is debounced). \`keating.onStateSaved = (ok) => ...\` reports whether it was saved.`,
	`- \`keating.share({ summary, data?, score?: { earned, possible }, complete? })\`: hands the learner's result to you, the tutor. Only call it from the learner's own click (e.g. a "Check" or "Send to tutor" button); calls without a fresh learner gesture, or more than about one every few seconds, are refused. Resolves to { ok } or { ok: false, reason }. Show the learner what was sent. summary <= ${INTERACTIVE_PAGE_LIMITS.maxShareSummaryLength} chars, written in plain words (what they did and got); data <= ${INTERACTIVE_PAGE_LIMITS.maxShareDataBytes / 1024} KB JSON; 0 <= earned <= possible.`,
	"- `keating.openLink(url)`: opens an http(s) URL in a new tab, only from a learner click. Plain <a href> links are routed through it.",
	"- `keating.appearance` (\"light\"|\"dark\") and `keating.reducedMotion` (boolean) are current; the `keating:context` window event fires when either changes.",
	"",
	"### Accessibility (required)",
	"- Every control has a visible label (`<label for>`, or aria-label for icon buttons); show slider values as text next to the slider.",
	"- Everything works with the keyboard alone: native buttons/inputs, visible focus, a sensible tab order, no keyboard traps; do not capture Escape (it closes full screen).",
	"- Never convey meaning by color alone: add text, shape or pattern (\"Correct\" with a check mark, not only green).",
	"- Announce results in an `aria-live=\"polite\"` region. Give canvas/SVG a role=\"img\" and an aria-label describing what it shows, and keep the key numbers in text too.",
	"- Honour reduced motion: when `keating.reducedMotion` is true (also `html[data-reduced-motion=true]` and the prefers-reduced-motion media query), jump to end states instead of animating and never auto-play loops.",
	"- Supply a `description`: a plain-text alternative that conveys what the page teaches, shown if the page cannot run.",
].join("\n");
