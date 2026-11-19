import { expect, test } from "bun:test";
import { reactToLesson, seat } from "../components/companion/reactions";
import { readMode, saveMode, preferenceKey } from "../components/companion/CompanionSetting";
import { faceRectangle } from "../components/companion/PixelScreen";
import metadata from "../../../docs/design/2026-11-19-review-chat-mockups/src/assets/bots.json";

test("each event replaces the last and duplicate deliveries do not advance the cheers", () => {
	let current = seat;
	for (const [i, sprite] of (
		["celebrating", "clapping", "thumbs-up", "nodding", "celebrating"] as const
	).entries()) {
		current = reactToLesson(current, "right", "grade" + i, "lively", false, false);
		expect(current.reaction?.sprite).toBe(sprite);
		expect(reactToLesson(current, "right", "grade" + i, "lively", false, false)).toBe(current);
	}
	const wrong = reactToLesson(current, "wrong", "wrong", "lively", false, true);
	expect(wrong.reaction).toMatchObject({ sprite: "head-shake", next: "hint", animate: false });
	expect(reactToLesson(wrong, "material", "new", "lively", false, false).reaction?.sprite).toBe("carrying");
});
test("typing, Calm and Off suppress reactions; Calm still reflects live work", () => {
	expect(reactToLesson(seat, "reply", "1", "lively", true, false).reaction).toBeNull();
	expect(reactToLesson(seat, "idle", "2", "calm", false, false).reaction).toBeNull();
	expect(reactToLesson(seat, "typing", "3", "calm", false, true).reaction).toMatchObject({
		sprite: "typing",
		animate: false,
	});
	expect(reactToLesson(seat, "thinking", "4", "off", false, false).reaction).toBeNull();
});
test("the setting round trips and falls back if storage is unavailable or corrupt", () => {
	const map = new Map<string, string>();
	const store = {
		getItem: (k: string) => map.get(k) ?? null,
		setItem: (k: string, v: string) => {
			map.set(k, v);
		},
	};
	for (const mode of ["off", "calm", "lively"] as const) {
		saveMode(mode, store);
		expect(readMode(store)).toBe(mode);
	}
	map.set(preferenceKey, "broken");
	expect(readMode(store)).toBe("lively");
	expect(
		readMode({
			getItem() {
				throw Error();
			},
		}),
	).toBe("lively");
});
test("all sixteen screen overlays track the authored frame including its 5px bleed", () => {
	for (const state of ["blank-sitting", "blank-idle"] as const)
		metadata.screens[state].forEach(([x, y, w, h], i) => {
			expect(faceRectangle(state, i, 128)).toEqual({
				left: (x - 5) / 2,
				top: (y - 5) / 2,
				width: (w + 10) / 2,
				height: (h + 10) / 2,
			});
		});
});
