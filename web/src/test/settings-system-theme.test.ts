import { test, expect } from "bun:test";
import { initThemeSync, saveThemePreference } from "../theme-sync";

test("System follows media changes and explicit Paper overrides the OS", () => {
	const globals = [
		"window",
		"document",
		"localStorage",
		"MutationObserver",
	] as const;
	const previous = globals.map((name) =>
		Object.getOwnPropertyDescriptor(globalThis, name),
	);
	const media = Object.assign(new EventTarget(), { matches: false });
	const classes = new Set<string>();
	const stored = new Map<string, string>();
	const replacements = [
		Object.assign(new EventTarget(), { matchMedia: () => media }),
		{
			documentElement: {
				dataset: {},
				classList: {
					contains: (name: string) => classes.has(name),
					toggle: (name: string, on: boolean) =>
						on ? classes.add(name) : classes.delete(name),
				},
			},
			getElementById: () => null,
		},
		{
			getItem: (name: string) => stored.get(name) ?? null,
			setItem: (name: string, value: string) => stored.set(name, value),
		},
		class {
			observe() {}
		},
	];
	try {
		globals.forEach((name, i) =>
			Object.defineProperty(globalThis, name, {
				value: replacements[i],
				configurable: true,
			}),
		);
		initThemeSync();
		expect(classes.has("light")).toBe(true);
		media.matches = true;
		media.dispatchEvent(new Event("change"));
		expect(classes.has("dark")).toBe(true);
		saveThemePreference("light");
		media.dispatchEvent(new Event("change"));
		expect(classes.has("dark")).toBe(false);
		saveThemePreference("system");
		expect(classes.has("dark")).toBe(true);
		media.matches = false;
		media.dispatchEvent(new Event("change"));
		expect(classes.has("light")).toBe(true);
	} finally {
		globals.forEach((name, i) => {
			const old = previous[i];
			if (old) Object.defineProperty(globalThis, name, old);
			else Reflect.deleteProperty(globalThis, name);
		});
	}
});
