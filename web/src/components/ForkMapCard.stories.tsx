import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { ForkMapCard } from "./ForkMapCard";
import type { SessionTreeNode } from "./session-tree";
import type { SessionMetadata } from "../types/session";

let clock = Date.now();
function node(id: string, title: string, children: SessionTreeNode[] = []): SessionTreeNode {
	clock -= 3_600_000;
	const session = {
		id,
		title,
		createdAt: new Date(clock).toISOString(),
		lastModified: new Date(clock).toISOString(),
		messageCount: 6,
		thinkingLevel: "off",
		preview: "",
		usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
	} as unknown as SessionMetadata;
	return { session, children, depth: 0 };
}

const root = node("s0", "Photosynthesis basics", [
	node("s1", "Light reactions deep dive", [node("s2", "Electron transport chain")]),
	node("s3", "Calvin cycle questions"),
]);

const meta = {
	title: "Sessions/ForkMapCard",
	component: ForkMapCard,
	args: {
		root,
		activeSessionId: "s2",
		onLoad: fn(),
		onFork: fn(),
		onRename: fn(),
		onDelete: fn(),
	},
	decorators: [
		(Story) => (
			<div style={{ width: 360 }}>
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof ForkMapCard>;

export default meta;

type Story = StoryObj<typeof meta>;

export const BranchMap: Story = {};

export const SingleFork: Story = {
	args: { root: node("r", "Intro to vectors", [node("r1", "Dot product follow-up")]), activeSessionId: "r1" },
};
