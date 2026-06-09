import type { Meta, StoryObj } from "@storybook/react-vite";
import { fn } from "storybook/test";
import { SessionCard } from "./SessionCard";
import type { SessionMetadata } from "../types/session";

const baseSession: SessionMetadata = {
	id: "s1",
	title: "Photosynthesis basics",
	createdAt: new Date().toISOString(),
	lastModified: new Date().toISOString(),
	messageCount: 12,
	thinkingLevel: "off" as SessionMetadata["thinkingLevel"],
	preview:
		"You can prepare a variety of explanations that build from light reaction to the Calvin cycle, focusing on energy transfer and where each step happens inside the chloroplast.",
	usage: {
		input: 0,
		output: 0,
		cacheRead: 0,
		cacheWrite: 0,
		totalTokens: 0,
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	},
};

const meta = {
	title: "Sessions/SessionCard",
	component: SessionCard,
	args: {
		session: baseSession,
		onLoad: fn(),
		onFork: fn(),
		onRename: fn(),
		onDelete: fn(),
	},
	decorators: [
		(Story) => (
			<div style={{ width: 200 }}>
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof SessionCard>;

export default meta;

type Story = StoryObj<typeof meta>;

export const CategoryTile: Story = {};

export const ComputerScience: Story = {
	args: { session: { ...baseSession, title: "Recursion in JavaScript", id: "s2" } },
};

export const ForkChild: Story = {
	args: { session: { ...baseSession, title: "Light reactions deep dive", id: "s3", parentSessionId: "s1" } },
};

export const WithMapHero: Story = {
	args: {
		hero: {
			type: "map",
			topic: "Cells",
			svg: '<svg viewBox="0 0 120 80" xmlns="http://www.w3.org/2000/svg"><rect width="120" height="80" fill="#10b98122"/><circle cx="40" cy="40" r="14" fill="none" stroke="#10b981"/><circle cx="84" cy="40" r="14" fill="none" stroke="#10b981"/><line x1="54" y1="40" x2="70" y2="40" stroke="#10b981"/></svg>',
		},
	},
};

export const Active: Story = {
	args: { active: true, childCount: 3 },
};
