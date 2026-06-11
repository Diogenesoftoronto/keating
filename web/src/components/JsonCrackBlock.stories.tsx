import type { Meta, StoryObj } from "@storybook/react-vite";
import { JsonCrackBlock } from "./JsonCrackBlock";

const meta = {
	title: "Data/JsonCrackBlock",
	component: JsonCrackBlock,
	args: {
		value: {
			name: "keating-config",
			version: "1.3.0",
			features: ["plan", "map", "animate", "bench", "evolve"],
			settings: {
				darkMode: true,
				speechEnabled: false,
				model: "gemini-3-flash-preview",
			},
		},
		title: "config.json",
		defaultMode: "raw",
	},
} satisfies Meta<typeof JsonCrackBlock>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Raw: Story = {};

export const TreeView: Story = {
	args: { defaultMode: "graph" },
};

export const NestedObject: Story = {
	args: {
		value: {
			project: "keating",
			environments: [
				{ id: "dev", url: "http://localhost:3000", active: true },
				{ id: "staging", url: "https://staging.keating.dev", active: false },
				{ id: "prod", url: "https://keating.dev", active: false },
			],
			policy: {
				name: "keating-default",
				analogyDensity: 0.72,
				socraticRatio: 0.66,
				formalism: 0.64,
				retrievalPractice: 0.74,
				exerciseCount: 3,
				diagramBias: 0.7,
				reflectionBias: 0.68,
				interdisciplinaryBias: 0.62,
				challengeRate: 0.58,
			},
		},
		title: "project-manifest.json",
	},
};

export const InvalidJson: Story = {
	args: {
		value: '{"broken": true, missing_closing',
		title: "corrupted.json",
	},
};

export const LargePayload: Story = {
	args: {
		value: Array.from({ length: 50 }, (_, i) => ({
			id: `item-${i}`,
			value: Math.random() * 100,
			active: i % 3 === 0,
			metadata: { createdAt: new Date().toISOString(), index: i },
		})),
		title: "batch-data.json",
		maxHeight: "16rem",
	},
};

export const PlainString: Story = {
	args: {
		value: "Just a plain string value, not an object.",
		title: "string.txt",
	},
};
