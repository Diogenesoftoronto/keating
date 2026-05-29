import type { SessionMetadata } from "../types/session";

export interface SessionTreeNode {
	session: SessionMetadata;
	children: SessionTreeNode[];
	depth: number;
}

function getSubtreeLastModified(node: SessionTreeNode): string {
	let max = node.session.lastModified;
	for (const child of node.children) {
		const childMax = getSubtreeLastModified(child);
		if (childMax > max) max = childMax;
	}
	return max;
}

function sortByCreatedAt(nodes: SessionTreeNode[]) {
	nodes.sort((left, right) => {
		const cmp = right.session.createdAt.localeCompare(left.session.createdAt);
		return cmp !== 0 ? cmp : right.session.id.localeCompare(left.session.id);
	});
	for (const node of nodes) sortByCreatedAt(node.children);
}

export function buildSessionTree(sessions: SessionMetadata[]): SessionTreeNode[] {
	const nodes = new Map<string, SessionTreeNode>();
	for (const session of sessions) {
		nodes.set(session.id, { session, children: [], depth: 0 });
	}

	const roots: SessionTreeNode[] = [];
	for (const node of nodes.values()) {
		const parentId = node.session.parentSessionId;
		const parent = parentId ? nodes.get(parentId) : undefined;
		if (parent && parent.session.id !== node.session.id) {
			node.depth = parent.depth + 1;
			parent.children.push(node);
		} else {
			roots.push(node);
		}
	}

	const assignDepth = (node: SessionTreeNode, depth: number) => {
		node.depth = depth;
		for (const child of node.children) assignDepth(child, depth + 1);
	};
	for (const root of roots) assignDepth(root, 0);

	// Roots order by the most recent activity anywhere in the subtree so that
	// clicking any member (parent or fork) moves the whole nest to the recent
	// position. Children stay in stable creation order and never jitter.
	roots.sort((left, right) => {
		const leftMax = getSubtreeLastModified(left);
		const rightMax = getSubtreeLastModified(right);
		return rightMax.localeCompare(leftMax);
	});
	for (const root of roots) sortByCreatedAt(root.children);

	return roots;
}

export function flattenSessionTree(
	nodes: SessionTreeNode[],
	collapsedSet?: ReadonlySet<string>,
): SessionTreeNode[] {
	const flattened: SessionTreeNode[] = [];
	const visit = (node: SessionTreeNode) => {
		flattened.push(node);
		if (collapsedSet?.has(node.session.id)) return;
		for (const child of node.children) visit(child);
	};
	for (const node of nodes) visit(node);
	return flattened;
}
