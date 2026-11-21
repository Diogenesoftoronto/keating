import {
	describeManipulativeState,
	initialManipulativeState,
	manipulativeStateFitsNode,
	validateManipulativeStateShape,
	type UiAction,
	type UiManipulativeNode,
	type UiManipulativeState,
} from "@keating/learner-contracts";
import type { StorageLike } from "../event-store";

const PREFIX = "keating:openui-manipulative:v1:";

export type ManipulativeShareIntent = { type: "share-manipulative"; nodeId: string; state: UiManipulativeState };

export function manipulativeStateKey(documentId: string, nodeId: string): string {
	return `${PREFIX}${encodeURIComponent(documentId)}:${encodeURIComponent(nodeId)}`;
}

/** A saved state only applies to the exact model it was made on. */
export function manipulativeSignature(node: UiManipulativeNode): string {
	return JSON.stringify(node.model);
}

/** Restore the learner's work, falling back to the authored start on any mismatch. */
export function loadManipulativeState(storage: Pick<StorageLike, "getItem"> | null, documentId: string | undefined, node: UiManipulativeNode): UiManipulativeState {
	const initial = initialManipulativeState(node.model);
	if (!storage || documentId === undefined || node.prompt === undefined) return initial;
	try {
		const raw = storage.getItem(manipulativeStateKey(documentId, node.id));
		if (!raw) return initial;
		const parsed = JSON.parse(raw) as { version?: unknown; signature?: unknown; state?: unknown };
		if (parsed.version !== 1 || parsed.signature !== manipulativeSignature(node)) return initial;
		if (!validateManipulativeStateShape(parsed.state) || !manipulativeStateFitsNode(node, parsed.state)) return initial;
		return parsed.state;
	} catch {
		return initial;
	}
}

export function saveManipulativeState(storage: Pick<StorageLike, "setItem"> | null, documentId: string, node: UiManipulativeNode, state: UiManipulativeState): boolean {
	if (!storage) return false;
	try {
		storage.setItem(manipulativeStateKey(documentId, node.id), JSON.stringify({ version: 1, signature: manipulativeSignature(node), state }));
		return true;
	} catch {
		return false;
	}
}

/** Order-insensitive for sets of cells; order matters only for counting, where it is the count itself. */
function canonical(state: UiManipulativeState): string {
	switch (state.kind) {
		case "ten-frame": return JSON.stringify({ ...state, cells: [...state.cells].sort((a, b) => a - b) });
		case "fraction-bars": return JSON.stringify({ ...state, shaded: state.shaded.map((bar) => [...bar].sort((a, b) => a - b)) });
		case "array": return JSON.stringify({ ...state, marked: [...state.marked].sort((a, b) => a - b) });
		default: return JSON.stringify(state);
	}
}

export function sameManipulativeState(left: UiManipulativeState | undefined, right: UiManipulativeState): boolean {
	return left !== undefined && left.kind === right.kind && canonical(left) === canonical(right);
}

export function manipulativeShareIntent(node: UiManipulativeNode, state: UiManipulativeState): ManipulativeShareIntent {
	return { type: "share-manipulative", nodeId: node.id, state };
}

export function manipulativeShareMessage(node: UiManipulativeNode, state: UiManipulativeState): string {
	return describeManipulativeState(node, state);
}

/** The last completed share for this node, as recorded on its receipt. */
export function sharedManipulativeState(action: UiAction | undefined, nodeId: string): UiManipulativeState | undefined {
	return action?.type === "share-manipulative" && action.nodeId === nodeId ? action.state : undefined;
}
