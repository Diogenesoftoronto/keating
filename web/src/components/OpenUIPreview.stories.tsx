import type { Meta, StoryObj } from "@storybook/react-vite";
import { css } from "../../styled-system/css";
import { buildOpenUIPreview } from "../keating/openui/preview";
import { OpenUIPreview } from "./OpenUIPreview";

const frameClass = css({ width: "min(40rem, calc(100vw - 2rem))", padding: "1rem", borderRadius: "0.5rem", backgroundColor: "color-mix(in srgb, var(--muted) 42%, transparent)" });

const withArtifacts = [
	"Here is how resolution actually works — a resolver asks a chain of servers, and caches what it learns.",
	"",
	"```openui lifecycle=workspace id=dns",
	'root = LearningSurface([plan, map, check], "DNS", "How lookups resolve.", "workspace")',
	'plan = StudyPlan("resolution-plan", "Resolution plan", [{ id: "trace", title: "Trace a cold lookup", children: [{ id: "stub", title: "Label the stub resolver" }] }, { id: "ttl", title: "Reason about TTL" }], "workspace")',
	'map = ConceptMap("flowchart LR\\n Client --> Resolver", "workspace", "Resolution and reuse")',
	'check = Question([{ question: "Why can a repeated lookup be faster?", type: "text" }], "ephemeral", "DNS")',
	"```",
	"",
	"Tell me which step is least clear and we will start there.",
].join("\n");

const broken = [
	"Let me show you the plan.",
	"",
	"```openui id=broken",
	"root = Nope(",
	"```",
].join("\n");

function StoryFrame({ text }: { text: string }) {
	return <div className={frameClass}><OpenUIPreview blocks={buildOpenUIPreview(text, "storybook:preview")} /></div>;
}

const meta = {
	title: "Review/OpenUI preview",
	component: StoryFrame,
	parameters: { layout: "centered" },
} satisfies Meta<typeof StoryFrame>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * How a candidate response reads in the comparison dialog and the review
 * canvas. Prose stays in full because it is the thing being judged; every
 * interactive artifact collapses to an inert chip rather than mounting a live
 * document for a turn that may be discarded.
 */
export const WithArtifacts: Story = { args: { text: withArtifacts } };

/** A turn with no components renders as ordinary prose. */
export const ProseOnly: Story = {
	args: { text: "No components here — just an explanation the learner is being asked to judge against another one." },
};

/** An unparsable component becomes a chip, never a dump of its source. */
export const UnparsableComponent: Story = { args: { text: broken } };
