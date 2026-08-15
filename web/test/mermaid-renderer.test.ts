import { describe, expect, test } from "bun:test";
import {
	currentMermaidTheme,
	mermaidRenderCacheKey,
	mermaidSourceError,
	useMermaidBlocks,
} from "../src/components/MermaidRenderer";

describe("mermaid markdown extraction", () => {
	test("extracts parameterized and uppercase mermaid fences", () => {
		const blocks = useMermaidBlocks([
			"Before",
			"```Mermaid title=\"Example\"",
			"graph TD;",
			"  A[One] --> B[Two]",
			"```",
			"Between",
			"```mermaid",
			"sequenceDiagram",
			"  Alice->>Bob: Hi",
			"```",
			"After",
		].join("\n"));

		expect(blocks).toEqual([
			{ id: "mermaid-0", code: "graph TD;\n  A[One] --> B[Two]\n" },
			{ id: "mermaid-1", code: "sequenceDiagram\n  Alice->>Bob: Hi\n" },
		]);
	});
});

describe("Mermaid renderer policy and cache identity", () => {
	test("shows a clear fallback error for unsupported grammars", () => {
		expect(mermaidSourceError("sankey-beta\nA,B,1")).toBe("This Mermaid grammar is not supported by Keating.");
		expect(mermaidSourceError("flowchart LR\n  A --> B")).toBeNull();
	});

	test("keys the cache by the full source and the selected theme", () => {
		const sharedPrefix = `flowchart LR\n${"A --> B\n".repeat(40)}`;
		const first = `${sharedPrefix}  B --> C`;
		const second = `${sharedPrefix}  B --> D`;
		expect(first.slice(0, 200)).toBe(second.slice(0, 200));
		expect(mermaidRenderCacheKey(first, "default")).not.toBe(mermaidRenderCacheKey(second, "default"));
		expect(mermaidRenderCacheKey(first, "default")).not.toBe(mermaidRenderCacheKey(first, "dark"));
	});

	test("uses the root dark class as a rerenderable Mermaid theme input", () => {
		const root = { classList: { contains: (name: string) => name === "dark" } } as unknown as HTMLElement;
		expect(currentMermaidTheme(root)).toBe("dark");
		const lightRoot = { classList: { contains: () => false } } as unknown as HTMLElement;
		expect(currentMermaidTheme(lightRoot)).toBe("default");
	});
});
