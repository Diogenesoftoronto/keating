/**
 * Settings keeps its place in browser history so Back and Forward walk the
 * sections the learner visited, a reload reopens the same section, and Back
 * from the first section closes Settings at the page it was opened from.
 *
 * Each Settings entry carries `?settings=<destination>` in the URL and a
 * `keatingSettings` record in history.state. `depth` counts the entries
 * Settings pushed since it opened: 0 is an entry Settings did not push (a
 * deep link or reload), so closing there rewrites the URL instead of going
 * back. The phone outline is its own step, written as `?settings=all`.
 */

export const SETTINGS_PARAM = "settings";
/** URL value for the phone outline (the list of every section). */
export const SETTINGS_OUTLINE = "all";

export interface SettingsEntry {
	/** Destination as accepted by resolveDestination (section id, alias or group). */
	raw: string;
	/** The phone outline is showing. */
	list: boolean;
	depth: number;
}

type HistoryLike = Pick<History, "state" | "pushState" | "replaceState">;
type LocationLike = Pick<Location, "pathname" | "search" | "hash">;

function record(value: unknown): Record<string, unknown> {
	return value && typeof value === "object"
		? (value as Record<string, unknown>)
		: {};
}

/** The Settings entry stored in a history state, if it is one. */
export function entryFromState(state: unknown): SettingsEntry | null {
	const entry = record(record(state).keatingSettings);
	if (typeof entry.raw !== "string") return null;
	return {
		raw: entry.raw,
		list: entry.list === true,
		depth:
			typeof entry.depth === "number" && Number.isInteger(entry.depth) && entry.depth >= 0
				? entry.depth
				: 0,
	};
}

/** The `?settings=` value in a location, or null. */
export function settingsParam(location: LocationLike): string | null {
	return new URLSearchParams(location.search).get(SETTINGS_PARAM)?.trim() || null;
}

/** The Settings entry the current location describes: state first, then the URL. */
export function currentEntry(
	location: LocationLike,
	state: unknown,
): SettingsEntry | null {
	const param = settingsParam(location);
	if (!param) return null;
	const stored = entryFromState(state);
	if (stored) return stored;
	return param === SETTINGS_OUTLINE
		? { raw: "interface", list: true, depth: 0 }
		: { raw: param, list: false, depth: 0 };
}

export function hrefFor(location: LocationLike, entry: Pick<SettingsEntry, "raw" | "list"> | null): string {
	const params = new URLSearchParams(location.search);
	if (entry) params.set(SETTINGS_PARAM, entry.list ? SETTINGS_OUTLINE : entry.raw);
	else params.delete(SETTINGS_PARAM);
	const query = params.toString();
	return `${location.pathname}${query ? `?${query}` : ""}${location.hash}`;
}

function nextKey() {
	return Math.random().toString(36).slice(2, 10);
}

/**
 * State for a new entry. The router keeps an index and key in history.state
 * to tell Back from Forward; carrying them forward keeps its bookkeeping right.
 */
function stateFor(previous: unknown, entry: SettingsEntry, push: boolean) {
	const base = { ...record(previous) };
	if (push) {
		const index = base.__TSR_index;
		if (typeof index === "number") base.__TSR_index = index + 1;
		if ("key" in base || "__TSR_key" in base) {
			const key = nextKey();
			base.key = key;
			base.__TSR_key = key;
		}
	}
	return { ...base, keatingSettings: { raw: entry.raw, list: entry.list, depth: entry.depth } };
}

export function pushEntry(history: HistoryLike, location: LocationLike, entry: SettingsEntry) {
	history.pushState(stateFor(history.state, entry, true), "", hrefFor(location, entry));
}

export function replaceEntry(history: HistoryLike, location: LocationLike, entry: SettingsEntry) {
	history.replaceState(stateFor(history.state, entry, false), "", hrefFor(location, entry));
}

/** Rewrite the current entry so it no longer describes Settings. */
export function clearEntry(history: HistoryLike, location: LocationLike) {
	const state = { ...record(history.state) };
	delete state.keatingSettings;
	history.replaceState(state, "", hrefFor(location, null));
}

let leaving = false;
/** True while Settings is unwinding its own entries; a reopen on that popstate would be wrong. */
export function settingsLeaving() {
	return leaving;
}

/**
 * Close Settings in history: go back over the entries it pushed so Back after
 * closing does not reopen it, and leave the page's own URL without `?settings=`.
 * Forward can still return to the last section.
 */
export function leaveSettings(
	history: Pick<History, "state" | "pushState" | "replaceState" | "go">,
	location: LocationLike,
	depth: number,
	target: Pick<Window, "addEventListener" | "removeEventListener" | "location"> = window,
) {
	if (depth <= 0) {
		clearEntry(history, location);
		return;
	}
	leaving = true;
	const done = () => {
		target.removeEventListener("popstate", done);
		leaving = false;
		// The entry Settings opened on was itself a deep link: drop the parameter.
		if (currentEntry(target.location, history.state)) clearEntry(history, target.location);
	};
	target.addEventListener("popstate", done);
	history.go(-depth);
}
