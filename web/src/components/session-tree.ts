import type { SessionMetadata } from "../types/session";

export interface SessionTreeNode {
	session: SessionMetadata;
	children: SessionTreeNode[];
	depth: number;
}

function sortNodes(nodes: SessionTreeNode[]) {
	nodes.sort((left, right) =>
		right.session.lastModified.localeCompare(left.session.lastModified),
	);
	for (const node of nodes) sortNodes(node.children);
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
	sortNodes(roots);
	return roots;
}

export function flattenSessionTree(nodes: SessionTreeNode[]): SessionTreeNode[] {
	const flattened: SessionTreeNode[] = [];
	const visit = (node: SessionTreeNode) => {
		flattened.push(node);
		for (const child of node.children) visit(child);
	};
	for (const node of nodes) visit(node);
	return flattened;
}
