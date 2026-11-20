import { useEffect } from "react";
import "./cursors.css";
import { startKeatingCursors } from "./engine";
import { useCursorPreference } from "./preference";

/** Mount once near the root. Draws nothing through React; it switches the cursor layer on and off. */
export function KeatingCursors() {
	const on = useCursorPreference();
	useEffect(() => (on ? startKeatingCursors() : undefined), [on]);
	return null;
}
