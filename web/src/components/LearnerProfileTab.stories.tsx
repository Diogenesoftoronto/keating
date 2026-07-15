import type { Meta, StoryObj } from "@storybook/react-vite";
import { css } from "../../styled-system/css";
import {
	LearnerProfileTab,
	type LearnerProfileStore,
} from "./LearnerProfileTab";

function memoryProfileStore(initial = ""): LearnerProfileStore {
	let value = initial;
	const listeners = new Set<(context: string) => void>();
	const publish = () => listeners.forEach((listener) => listener(value));
	return {
		load: () => value,
		save: (context) => {
			value = context.trim();
			publish();
		},
		reset: () => {
			value = "";
			publish();
		},
		subscribe: (listener) => {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}

const emptyStore = memoryProfileStore();
const existingStore = memoryProfileStore(
	"I am a frontend engineer refreshing discrete mathematics. I learn best through diagrams, counterexamples, and short retrieval checks. Please avoid sports analogies and define unfamiliar notation before using it.",
);

const meta = {
	title: "Settings/LearnerProfileTab",
	component: LearnerProfileTab,
	parameters: { controls: { disable: true } },
	decorators: [
		(Story) => (
			<div className={css({ width: "100%", maxWidth: "48rem", backgroundColor: "var(--background)", padding: { base: "0.75rem", sm: "1.5rem" }, color: "var(--foreground)" })}>
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof LearnerProfileTab>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
	args: { store: emptyStore },
};

export const ExistingProfile: Story = {
	args: { store: existingStore },
};

export const Mobile: Story = {
	args: { store: memoryProfileStore("I am studying for a biology exam and prefer concrete visual examples before formal vocabulary.") },
	parameters: { viewport: { defaultViewport: "mobile1" } },
	globals: { viewport: { value: "mobile1", isRotated: false } },
};
