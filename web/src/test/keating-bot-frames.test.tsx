import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AppStatusScreen } from "../components/AppStatusScreen";
import { KeatingBot, keatingBotFramePosition, keatingBotSpriteVariant, KEATING_BOT_CHAT_STATES, KEATING_BOT_ACTIVITY_STATES } from "../components/KeatingBot";

describe("Keatingbot authored atlas frames", () => {
	test("each row-major pose selects one of the eight distinct cells", () => {
		const positions = Array.from({ length: 8 }, (_, frame) => keatingBotFramePosition(frame));
		expect(new Set(positions.map(({ x, y }) => `${x} ${y}`)).size).toBe(8);
		for (let frame = 0; frame < 8; frame++) {
			const position = positions[frame]!;
			expect(parseFloat(position.x) / 100 * 3).toBeCloseTo(frame % 4);
			expect(parseFloat(position.y) / 100).toBe(Math.floor(frame / 4));
		}
	});
	test("inspection clamps invalid inputs and addresses both rows", () => {
		expect(keatingBotFramePosition(-2)).toEqual({ x: "0%", y: "0%" });
		expect(keatingBotFramePosition(NaN)).toEqual({ x: "0%", y: "0%" });
		expect(keatingBotFramePosition(Infinity)).toEqual({ x: "0%", y: "0%" });
		expect(keatingBotFramePosition(99)).toEqual({ x: "100%", y: "100%" });
		expect(keatingBotFramePosition(4.9)).toEqual({ x: "0%", y: "100%" });
	});
	test("every state exposes the final frozen frame and keeps accessible naming", () => {
		for (const variant of ["head", "body"] as const) for (const state of [...KEATING_BOT_CHAT_STATES, ...KEATING_BOT_ACTIVITY_STATES]) {
			const html = renderToStaticMarkup(<KeatingBot variant={variant} state={state} frame={7} label="Keating is listening" />);
			expect(html).toContain('data-frozen="true"');
			expect(html).toContain('--keating-bot-frame-x:100%;--keating-bot-frame-y:100%');
			expect(html).toContain('role="img" aria-label="Keating is listening"');
		}
	});
	test("walking and flips keep the full pose visible at either placement", () => {
		for (const state of ["walking", "flipping", "lotus", "connecting", "understanding"] as const) {
			expect(keatingBotSpriteVariant("head", state)).toBe("body");
			expect(keatingBotSpriteVariant("body", state)).toBe("body");
		}
		for (const state of [...KEATING_BOT_CHAT_STATES, ...KEATING_BOT_ACTIVITY_STATES]) {
			if (state !== "walking" && state !== "flipping" && state !== "lotus" && state !== "connecting" && state !== "understanding") expect(keatingBotSpriteVariant("head", state)).toBe("head");
		}
	});
	test("route loading uses authored motion while error artwork stays distinct", () => {
		const loading = renderToStaticMarkup(<AppStatusScreen status="loading" />);
		expect(loading).toContain('data-state="loading"');
		expect(loading).toContain('role="status" aria-live="polite"');
		for (const status of ["404", "403", "500", "offline"] as const) {
			const html = renderToStaticMarkup(<AppStatusScreen status={status} />);
			expect(html).toContain(`/brand/bot-status-v1/${status === "offline" ? "loading" : status}.avif`);
			expect(html).not.toContain('class="keating-bot"');
		}
	});
	test("decorative usage hides the mascot and disabled animation remains explicit", () => {
		const html = renderToStaticMarkup(<KeatingBot label="" animated={false} />);
		expect(html).toContain('aria-hidden="true"');
		expect(html).not.toContain('role="img"');
		expect(html).toContain('data-animated="false"');
	});
});
