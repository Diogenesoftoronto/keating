import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { INITIAL_INTERACTIVE_PAGE_STATE, InteractivePage, InteractivePageFallback, interactivePageReducer } from "../components/interactive/InteractivePage";
import { INTERACTIVE_PAGE_LIMITS } from "../keating/interactive-page/protocol";
import { createInteractivePageStateStore } from "../keating/interactive-page/state-store";

const description = "Steps gradient descent on a parabola; the learning rate sets the step size.";
const store = createInteractivePageStateStore(null);
const render = (html: string) => renderToStaticMarkup(<InteractivePage pageId="p1" title="Descent" html={html} description={description} stateStore={store} />);

describe("InteractivePage fallbacks", () => {
	test("loading shows a status with the description and a Reload control", () => {
		const markup = render("<p>hi</p>");
		expect(markup).toContain("role=\"status\"");
		expect(markup).toContain("Loading interactive page");
		expect(markup).toContain(description);
		expect(markup).toContain(">Reload</button>");
	});

	test("oversize pages render the description, not a frame", () => {
		const markup = render(`<p>${"x".repeat(INTERACTIVE_PAGE_LIMITS.maxHtmlBytes)}</p>`);
		expect(markup).toContain("too large to show");
		expect(markup).toContain(description);
		expect(markup).not.toContain("<iframe");
	});

	test("invalid and forbidden pages render readable fallbacks", () => {
		expect(render("  ")).toContain("could not be shown");
		const blocked = render("<meta http-equiv=refresh content=0;url=https://x.test>");
		expect(blocked).toContain("tried to leave its frame");
		expect(blocked).toContain(description);
	});

	test("blocked and crashed fallbacks include the description and Reload", () => {
		for (const status of ["blocked", "crashed"] as const) {
			const markup = renderToStaticMarkup(<InteractivePageFallback status={status} title="Descent" description={description} message="boom" onReload={() => {}} />);
			expect(markup).toContain("role=\"alert\"");
			expect(markup).toContain(description);
			expect(markup).toContain(">Reload</button>");
		}
	});

	test("the section is labelled and the description is available to assistive tech", () => {
		const markup = render("<p>hi</p>");
		expect(markup).toMatch(/<section aria-labelledby="[^"]+-title"/);
		expect(markup).toMatch(/<span id="[^"]+-description"[^>]*>Steps gradient descent/);
	});
});

describe("runtime state machine", () => {
	test("reload resets a crashed or blocked page to loading with a new generation", () => {
		const crashed = interactivePageReducer(INITIAL_INTERACTIVE_PAGE_STATE, { type: "timeout" });
		expect(crashed.status).toBe("crashed");
		const reloaded = interactivePageReducer(crashed, { type: "reload" });
		expect(reloaded).toEqual({ generation: 1, status: "loading" });
		const blocked = interactivePageReducer(interactivePageReducer(reloaded, { type: "ready" }), { type: "navigated" });
		expect(blocked.status).toBe("blocked");
		expect(interactivePageReducer(blocked, { type: "ready" }).status).toBe("blocked");
		expect(interactivePageReducer(blocked, { type: "reload" })).toEqual({ generation: 2, status: "loading" });
	});

	test("errors before ready crash the page; errors after ready do not", () => {
		expect(interactivePageReducer(INITIAL_INTERACTIVE_PAGE_STATE, { type: "error", message: "x is not defined" })).toMatchObject({ status: "crashed", message: "x is not defined" });
		const ready = interactivePageReducer(INITIAL_INTERACTIVE_PAGE_STATE, { type: "ready" });
		expect(interactivePageReducer(ready, { type: "error", message: "late" }).status).toBe("ready");
		expect(interactivePageReducer(ready, { type: "timeout" }).status).toBe("ready");
	});
});
