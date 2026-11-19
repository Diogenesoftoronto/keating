import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { StorageLike } from "../../keating/event-store";
import { getInitPromise, keatingStorage, sessions } from "../../hooks/keating-storage";
import { loadSessionMaterials, type SessionMaterial, type SessionMaterialsSource } from "../../keating/session-materials";
import { useSessionWorkspace, type SessionWorkspaceState } from "./useSessionWorkspace";

export type SessionMaterialsLoad =
	| { status: "loading" }
	| { status: "error"; message: string }
	| { status: "ready"; materials: SessionMaterial[]; currentPlanKey: string | null };

/** A material that appeared while the learner was in the session (never on load). */
export interface MaterialArrival {
	sessionId: string;
	key: string;
	/** Increments per arrival, so the same key arriving twice is still two events. */
	seq: number;
}

export interface SessionMaterialsState {
	sessionId: string;
	load: SessionMaterialsLoad;
	/** The plan side (proposals, history, saves, updates) the plan detail needs. */
	workspace: SessionWorkspaceState;
	arrival: MaterialArrival | null;
	reload: () => void;
}

type Readable = Pick<StorageLike, "getItem">;

function browserStorage(): Readable | null {
	try {
		return typeof localStorage === "undefined" ? null : localStorage;
	} catch {
		return null;
	}
}

/** The app's own stores; legacy records are read across sessions and filtered by the gatherer. */
export const defaultSessionMaterialsSource: SessionMaterialsSource & Parameters<typeof useSessionWorkspace>[1] = {
	getOpenUiPresentations: async (sessionId) => {
		await getInitPromise();
		return keatingStorage.getOpenUiPresentations(sessionId);
	},
	loadSession: async (id) => {
		await getInitPromise();
		const data = await sessions.loadSession(id);
		return data ? { messages: data.messages } : null;
	},
	getLegacyRecords: async () => {
		await getInitPromise();
		const [plans, maps, animations, decks, verifications] = await Promise.all([
			keatingStorage.getLessonPlans(),
			keatingStorage.getLessonMaps(),
			keatingStorage.getAnimations(),
			keatingStorage.getDecks(),
			keatingStorage.getVerifications(),
		]);
		return { plans, maps, animations, decks, verifications };
	},
	readLocal: async (store, key) => {
		const { localRead } = await import("../../submissions/local-store");
		return localRead(store, key);
	},
};

/**
 * Every material of one session, live. Reloads ride on the workspace hook
 * (presentation events, plan events, and its journal poll, which also watches
 * the journals of the listed non-plan materials) plus `keating:artifact-created`
 * for earlier stored records.
 */
export function useSessionMaterials(sessionId: string, source: SessionMaterialsSource & Parameters<typeof useSessionWorkspace>[1] = defaultSessionMaterialsSource, storage: Readable | null = browserStorage()): SessionMaterialsState {
	const [watch, setWatch] = useState<readonly string[]>([]);
	const workspace = useSessionWorkspace(sessionId, source, storage, watch);
	const [state, setState] = useState<{ sessionId: string; load: SessionMaterialsLoad }>({ sessionId, load: { status: "loading" } });
	const [arrival, setArrival] = useState<MaterialArrival | null>(null);
	const [legacyTick, setLegacyTick] = useState(0);
	const request = useRef(0);
	const known = useRef<{ sessionId: string; keys: Set<string> } | null>(null);
	const seq = useRef(0);

	useEffect(() => {
		if (typeof window === "undefined") return;
		const onCreated = () => setLegacyTick((tick) => tick + 1);
		window.addEventListener("keating:artifact-created", onCreated);
		return () => window.removeEventListener("keating:artifact-created", onCreated);
	}, []);

	const workspaceLoad = workspace.load;
	useEffect(() => {
		const id = ++request.current;
		if (!sessionId) {
			setState({ sessionId, load: { status: "ready", materials: [], currentPlanKey: null } });
			return;
		}
		if (workspaceLoad.status === "loading") return;
		if (workspaceLoad.status === "error") {
			setState({ sessionId, load: workspaceLoad });
			return;
		}
		void loadSessionMaterials(source, sessionId, storage, { workspace: workspaceLoad }).then((data) => {
			if (id !== request.current) return;
			const keys = data.materials.map((material) => material.key);
			if (known.current?.sessionId === sessionId) {
				const fresh = data.materials.filter((material) => !known.current!.keys.has(material.key));
				for (const key of keys) known.current.keys.add(key);
				const newest = fresh.sort((a, b) => b.presentedAt - a.presentedAt)[0];
				if (newest) setArrival({ sessionId, key: newest.key, seq: ++seq.current });
			} else {
				// First load of this session: what is already there is not new.
				known.current = { sessionId, keys: new Set(keys) };
			}
			const ids = [...new Set(data.materials.flatMap((material) => material.source === "openui" ? [material.documentId] : []))];
			setWatch((current) => current.length === ids.length && current.every((value, index) => value === ids[index]) ? current : ids);
			setState({ sessionId, load: { status: "ready", materials: data.materials, currentPlanKey: data.workspace.currentPlanKey } });
		}, (cause: unknown) => {
			if (id !== request.current) return;
			setState({ sessionId, load: { status: "error", message: cause instanceof Error && cause.message ? cause.message : "This browser's saved data could not be read." } });
		});
	}, [legacyTick, sessionId, source, storage, workspaceLoad]);

	useEffect(() => {
		setArrival(null);
	}, [sessionId]);

	const reload = useCallback(() => workspace.reload(), [workspace]);
	const load: SessionMaterialsLoad = state.sessionId === sessionId ? state.load : { status: "loading" };
	return useMemo(() => ({ sessionId, load, workspace, arrival: arrival?.sessionId === sessionId ? arrival : null, reload }), [arrival, load, reload, sessionId, workspace]);
}
