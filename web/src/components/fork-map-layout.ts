import type { SessionMetadata } from "../types/session";
import type { SessionTreeNode } from "./session-tree";

export interface ForkMapRow {
	session: SessionMetadata;
	depth: number;
	/** For each ancestor connector column, whether its vertical rail continues. */
	ancestorHasNext: boolean[];
	isLast: boolean;
}

/**
 * Flatten a fork subtree into rows annotated with the connector-rail state needed
 * to draw a classic branch map (├─ / └─ elbows plus continuing ancestor rails).
 */
export function flattenWithGuides(root: SessionTreeNode): ForkMapRow[] {
	const rows: ForkMapRow[] = [];
	const walk = (node: SessionTreeNode, depth: number, ancestorHasNext: boolean[], isLast: boolean) => {
		rows.push({ session: node.session, depth, ancestorHasNext, isLast });
		node.children.forEach((child, index) => {
			const childIsLast = index === node.children.length - 1;
			// Only nodes at depth >= 1 own an elbow column that becomes an ancestor
			// rail for their descendants.
			const nextAncestors = depth >= 1 ? [...ancestorHasNext, !isLast] : ancestorHasNext;
			walk(child, depth + 1, nextAncestors, childIsLast);
		});
	};
	walk(root, 0, [], true);
	return rows;
}

export function countDescendants(node: SessionTreeNode): number {
	let total = 0;
	for (const child of node.children) total += 1 + countDescendants(child);
	return total;
}
