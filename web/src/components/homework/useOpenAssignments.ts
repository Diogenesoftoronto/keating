import { useEffect, useState } from "react";
import { OPENUI_PRESENTATIONS_CHANGED_EVENT } from "../../keating/storage";
import { loadOpenAssignments, type LoadedAssignments } from "../../keating/homework/load-assignments";

export interface OpenAssignmentsState {
	data: LoadedAssignments | null;
	loading: boolean;
	error: string;
}

/** Live homework list; refreshes when tasks are presented, on focus, and each minute. */
export function useOpenAssignments(sessionId?: string): OpenAssignmentsState {
	const [state, setState] = useState<OpenAssignmentsState>({ data: null, loading: true, error: "" });
	useEffect(() => {
		let active = true;
		let generation = 0;
		const refresh = () => {
			const started = ++generation;
			void loadOpenAssignments(sessionId ? { sessionId } : {}).then((data) => {
				if (active && started === generation) setState({ data, loading: false, error: "" });
			}).catch(() => {
				if (active && started === generation) setState((current) => ({ ...current, loading: false, error: "Assignments could not be loaded. They are still in their sessions." }));
			});
		};
		refresh();
		const events = [OPENUI_PRESENTATIONS_CHANGED_EVENT, "focus", "storage"];
		events.forEach((event) => window.addEventListener(event, refresh));
		const timer = window.setInterval(refresh, 60_000);
		return () => {
			active = false;
			window.clearInterval(timer);
			events.forEach((event) => window.removeEventListener(event, refresh));
		};
	}, [sessionId]);
	return state;
}
