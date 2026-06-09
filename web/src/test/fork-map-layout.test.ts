import { describe, expect, it } from "bun:test";
import { countDescendants, flattenWithGuides } from "../components/fork-map-layout";
import type { SessionTreeNode } from "../components/session-tree";
import type { SessionMetadata } from "../types/session";

function node(id: string, children: SessionTreeNode[] = []): SessionTreeNode {
	return {
		session: { id, title: id } as unknown as SessionMetadata,
		children,
		depth: 0,
	};
}

// root
// ├─ a
// │  └─ a1
// └─ b
const tree = node("root", [node("a", [node("a1")]), node("b")]);

describe("flattenWithGuides", () => {
	const rows = flattenWithGuides(tree);

	it("emits one row per node in pre-order", () => {
		expect(rows.map((r) => r.session.id)).toEqual(["root", "a", "a1", "b"]);
	});

	it("annotates depth", () => {
		expect(rows.map((r) => r.depth)).toEqual([0, 1, 2, 1]);
	});

	it("marks last siblings", () => {
		const byId = Object.fromEntries(rows.map((r) => [r.session.id, r]));
		expect(byId.root.isLast).toBe(true);
		expect(byId.a.isLast).toBe(false); // sibling b follows
		expect(byId.b.isLast).toBe(true);
		expect(byId.a1.isLast).toBe(true);
	});

	it("continues the ancestor rail while a parent still has siblings below", () => {
		const a1 = rows.find((r) => r.session.id === "a1")!;
		// a still has sibling b below, so a1's column-0 rail keeps going.
		expect(a1.ancestorHasNext).toEqual([true]);
	});

	it("gives top-level nodes no ancestor columns", () => {
		expect(rows.find((r) => r.session.id === "a")!.ancestorHasNext).toEqual([]);
		expect(rows.find((r) => r.session.id === "b")!.ancestorHasNext).toEqual([]);
	});
});

describe("countDescendants", () => {
	it("counts every node beneath the root", () => {
		expect(countDescendants(tree)).toBe(3);
	});

	it("returns zero for a leaf", () => {
		expect(countDescendants(node("leaf"))).toBe(0);
	});
});
