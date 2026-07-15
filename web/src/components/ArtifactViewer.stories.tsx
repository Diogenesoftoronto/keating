import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { css } from "../../styled-system/css";
import type { KeatingStorage } from "../keating/storage";
import { ArtifactViewer } from "./ArtifactViewer";

const createdAt = Date.now() - 12 * 60_000;

const widePlan = {
	id: "plan-wide",
	topic: "Graph traversal strategy matrix",
	createdAt,
	updatedAt: createdAt,
	metadata: { phaseCount: 5, domain: "code" },
	content: `# Graph traversal strategy matrix

Use this artifact to verify that a wide table remains horizontally scrollable on a narrow screen.

| Strategy | Frontier structure | Shortest unweighted path | Typical memory profile | Best fit | Main failure mode |
| --- | --- | --- | --- | --- | --- |
| Breadth-first search | FIFO queue | Yes | Entire active frontier | Shallow goals and unweighted paths | Wide graphs consume substantial memory |
| Depth-first search | LIFO stack | No | Current branch plus siblings | Deep search and backtracking | Can spend a long time on the wrong branch |
| Iterative deepening | Repeated depth-limited stack | Yes | Similar to depth-first search | Unknown goal depth with tight memory | Repeats work near the root |

## Retrieval check

Which strategy would you choose for a shallow goal in a very wide graph, and what resource tradeoff would you expect?`,
};

const mockStorage = {
	getLessonPlans: async () => [widePlan],
	getLessonMaps: async () => [{
		id: "map-one",
		topic: "Recursion call stack",
		createdAt: createdAt - 1_000,
		mmdContent: "graph TD\n  A[Call] --> B[Smaller call]\n  B --> C[Base case]",
	}],
	getAnimations: async () => [],
	getDecks: async () => [],
	getBenchmarks: async () => [{
		id: "benchmark-one",
		topic: "Graph traversal",
		createdAt: createdAt - 2_000,
		score: 78,
		report: "# Benchmark\n\nRetrieval is strong; transfer needs another example.",
	}],
	getEvolutions: async () => [],
	getVerifications: async () => [{
		id: "verification-one",
		topic: "Graph traversal sources",
		createdAt: createdAt - 3_000,
		checklist: "- [x] Definitions checked\n- [ ] Complexity examples checked",
		completed: false,
	}],
	getPromptEvolutions: async () => [],
	getImprovementAttempts: async () => [],
} as unknown as KeatingStorage;

const emptyStorage = {
	getLessonPlans: async () => [],
	getLessonMaps: async () => [],
	getAnimations: async () => [],
	getDecks: async () => [],
	getBenchmarks: async () => [],
	getEvolutions: async () => [],
	getVerifications: async () => [],
	getPromptEvolutions: async () => [],
	getImprovementAttempts: async () => [],
} as unknown as KeatingStorage;

const meta = {
	title: "Artifacts/ArtifactViewer",
	component: ArtifactViewer,
	parameters: { layout: "fullscreen" },
	decorators: [
		(Story) => (
			<div className={css({ minHeight: "100vh", minWidth: 0, backgroundColor: "var(--background)", padding: { base: "0.625rem", sm: "1.5rem" }, color: "var(--foreground)" })}>
				<Story />
			</div>
		),
	],
	args: {
		storage: mockStorage,
		onClose: fn(),
	},
} satisfies Meta<typeof ArtifactViewer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ArtifactList: Story = {};

export const Empty: Story = {
	args: { storage: emptyStorage },
};

export const WideTableOnMobile: Story = {
	args: { artifactId: "plan-wide" },
	parameters: { viewport: { defaultViewport: "mobile1" } },
	globals: { viewport: { value: "mobile1", isRotated: false } },
};
