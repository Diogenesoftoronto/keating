import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { css } from "../../styled-system/css";
import { MultiSelectDropdown } from "./MultiSelectDropdown";

const meta = {
	title: "Models/MultiSelectDropdown",
	parameters: { layout: "centered" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function FilterPair() {
	const [providers, setProviders] = useState<string[]>(["openai", "google"]);
	const [capabilities, setCapabilities] = useState<string[]>(["vision", "long-context"]);
	return (
		<div className={css({ display: "grid", width: "min(32rem, calc(100vw - 2rem))", gridTemplateColumns: { base: "1fr", sm: "1fr 1fr" }, gap: "0.5rem", paddingBottom: "18rem" })}>
			<MultiSelectDropdown
				label="Filter by provider"
				allLabel="All providers"
				options={[
					{ value: "openai", label: "openai" },
					{ value: "google", label: "google" },
					{ value: "anthropic", label: "anthropic" },
				]}
				selected={providers}
				onChange={setProviders}
			/>
			<MultiSelectDropdown
				label="Filter by capability"
				allLabel="All capabilities"
				options={[
					{ value: "thinking", label: "Thinking" },
					{ value: "vision", label: "Vision" },
					{ value: "long-context", label: "Long context" },
				]}
				selected={capabilities}
				onChange={setCapabilities}
			/>
		</div>
	);
}

export const ProviderAndCapabilityFilters: Story = {
	render: () => <FilterPair />,
};

export const MobileFilters: Story = {
	render: () => <FilterPair />,
	parameters: { layout: "fullscreen", viewport: { defaultViewport: "mobile1" } },
	globals: { viewport: { value: "mobile1", isRotated: false } },
};
