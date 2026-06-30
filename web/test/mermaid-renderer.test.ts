import { describe, expect, test } from "bun:test";
import { useMermaidBlocks } from "../src/components/MermaidRenderer";

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
