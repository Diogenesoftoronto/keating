import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { css } from "../../styled-system/css";
import { ResponseComparisonPanel } from "./ResponseComparisonPanel";

const comparison = {
	sourceSessionId: "session-original",
	alternativeSessionId: "session-alternative",
	topic: "Recursion and base cases",
	originalResponse: "A recursive function needs a base case so the calls eventually stop.",
	alternativeResponse: `Picture opening nested boxes. Each box asks you to open a smaller one, but eventually you reach the innermost box and stop.

That innermost box is the **base case**. Code needs the same guarantee:

1. Each recursive call reduces the problem.
2. The base case returns without another recursive call.
3. The returned values rebuild the final result as the stack unwinds.`,
	originalMessageTimestamp: 1_000,
	alternativeMessageTimestamp: 2_000,
};

const meta = {
	title: "Chat/ResponseComparisonPanel",
	component: ResponseComparisonPanel,
	parameters: { layout: "fullscreen" },
	decorators: [
		(Story) => (
			<div className={css({ minHeight: "100vh", backgroundColor: "var(--background)", padding: { base: "0.5rem", sm: "1.5rem" }, color: "var(--foreground)" })}>
				<Story />
			</div>
		),
	],
	args: {
		comparison,
		onChoose: fn(async () => {}),
	},
} satisfies Meta<typeof ResponseComparisonPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Ready: Story = {};

export const LongTechnicalAlternative: Story = {
	args: {
		comparison: {
			...comparison,
			topic: "Breadth-first and depth-first search",
			alternativeResponse: `## Alternative explanation

Breadth-first search uses a queue and explores every node at the current depth before moving deeper. Depth-first search uses a stack, explicit or recursive, and follows one branch until it reaches a dead end.

| Property | Breadth-first | Depth-first | Iterative deepening |
| --- | --- | --- | --- |
| Frontier | Queue | Stack | Depth-limited stack |
| Shortest unweighted path | Yes | No | Yes |
| Typical memory | Wide frontier | Current branch | Current branch |
| Useful when | Goal is shallow | Solutions are deep | Depth is unknown |

The choice depends on the graph, the expected goal depth, and the memory budget.`,
		},
	},
};

export const Mobile: Story = {
	parameters: {
		viewport: { defaultViewport: "mobile1" },
	},
	globals: {
		viewport: { value: "mobile1", isRotated: false },
	},
};
