import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { css } from "../../../styled-system/css";
import { LessonImage } from "../../components/lesson/LessonProse";
import { ConceptMap, Explanation, LearningImage } from "./library";

/** The prose and figure blocks of the OpenUI library, rendered through the library's own component functions. */
const replyClass = css({ width: "min(42rem, calc(100vw - 2rem))", paddingBlock: "1rem", fontFamily: "var(--font-ui)" });
const noop = () => null;

function Reply({ children }: { children: ReactNode }) {
	return <div className={replyClass}>
		<p>Here is the idea before you try the check.</p>
		{children}
		<p>When you are ready, tell me which part of the path you would test first.</p>
	</div>;
}

const ExplanationBlock = Explanation.component;
const ConceptMapBlock = ConceptMap.component;
const LearningImageBlock = LearningImage.component;

const markdown = "A resolver keeps the answer it got from the authoritative server for as long as the record's **TTL** allows. A second lookup inside that window never leaves the resolver, which is why it is faster.\n\n- The stub asks the recursive resolver.\n- The resolver answers from cache, or walks root, TLD and authority.\n\nThe cost is staleness: a record that changed at the source keeps its old answer until the TTL runs out.";

const conceptSource = "flowchart LR\n  Client -->|asks| Resolver\n  Resolver --> Cache\n  Cache -->|miss| Authority\n  Authority -->|answer + TTL| Cache\n  Cache -->|hit before TTL| Client";

const figureSvg = `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 300"><rect width="640" height="300" fill="#f4efe4"/><g font-family="sans-serif" font-size="18" fill="#1d1b17"><rect x="40" y="120" width="120" height="60" fill="none" stroke="#1d1b17" stroke-width="2"/><text x="70" y="156">Client</text><rect x="260" y="120" width="120" height="60" fill="none" stroke="#1d1b17" stroke-width="2"/><text x="275" y="156">Resolver</text><rect x="480" y="120" width="120" height="60" fill="none" stroke="#1d1b17" stroke-width="2"/><text x="490" y="156">Authority</text><path d="M160 150H260M380 150H480" stroke="#2f7d4f" stroke-width="3"/></g></svg>`)}`;

const meta = {
	title: "Learning/OpenUI prose and figures",
	parameters: { layout: "centered" },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const ExplanationTitled: Story = {
	render: () => <Reply><ExplanationBlock props={{ title: "Why a warm lookup is faster", markdown }} renderNode={noop} /></Reply>,
};

export const ExplanationUntitled: Story = {
	render: () => <Reply><ExplanationBlock props={{ markdown }} renderNode={noop} /></Reply>,
};

export const ConceptMapInReply: Story = {
	render: () => <Reply><ConceptMapBlock props={{ title: "Resolution and reuse", code: conceptSource, lifecycle: "workspace" }} renderNode={noop} /></Reply>,
};

export const LearningImageLoaded: Story = {
	render: () => <Reply><LearningImageBlock props={{ src: figureSvg, alt: "Client, resolver and authority boxes joined left to right", title: "The lookup path", caption: "Only a cache miss reaches the authority.", lifecycle: "workspace" }} renderNode={noop} /></Reply>,
};

export const LearningImageFailed: Story = {
	render: () => <Reply><LearningImageBlock props={{ src: "/missing/learning-image.png", alt: "Client, resolver and authority boxes joined left to right", title: "The lookup path", caption: "Only a cache miss reaches the authority.", lifecycle: "workspace" }} renderNode={noop} /></Reply>,
};

/** The image's load events never fire in a static shot, so the loading state is pinned. */
export const LearningImageLoading: Story = {
	render: () => <Reply><LessonImage status="loading" src={figureSvg} alt="Client, resolver and authority boxes joined left to right" title="The lookup path" caption="Only a cache miss reaches the authority." /></Reply>,
};
