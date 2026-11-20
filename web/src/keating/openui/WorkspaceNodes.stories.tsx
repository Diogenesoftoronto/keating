import type { Meta, StoryObj } from "@storybook/react-vite";
import type { UiDocument, UiDocumentNode } from "@keating/learner-contracts";
import { css } from "../../../styled-system/css";
import { SharedUiDocumentRenderer } from "./shared-renderer";

const frameClass = css({ width: "min(48rem, calc(100vw - 2rem))", paddingBlock: "1rem" });

function documentOf(node: UiDocumentNode): UiDocument {
	return { schemaVersion: 1, id: `storybook-${node.id}`, revision: 0, lifecycle: "ready", retention: "workspace", supportedSurfaces: ["web", "desktop", "mobile", "terminal"], nodes: [node], createdAt: "2026-09-01T00:00:00.000Z", updatedAt: "2026-09-01T00:00:00.000Z" };
}

/** Workspace nodes a reply can carry: SharedNotes, the Diagram (concept map) frame and media. */
function WorkspaceNode({ node }: { node: UiDocumentNode }) {
	return <div className={frameClass}><SharedUiDocumentRenderer document={documentOf(node)} onAction={() => true} /></div>;
}

const meta = { title: "Learning/Workspace nodes", component: WorkspaceNode, parameters: { layout: "centered" } } satisfies Meta<typeof WorkspaceNode>;
export default meta;
type Story = StoryObj<typeof meta>;

export const SharedNotes: Story = {
	args: { node: { type: "notes", id: "bayes-notes", title: "What I understand about priors", value: "The prior is what I believed before the test.\nStill unclear: where a published base rate comes from.", placeholder: "Capture what you understand, what remains unclear, or what you want to test." } },
};
export const SharedNotesEmpty: Story = {
	args: { node: { type: "notes", id: "empty-notes", title: "Questions for next time", value: "", placeholder: "Capture what you understand, what remains unclear, or what you want to test." } },
};
export const Diagram: Story = {
	args: { node: { type: "concept-map", id: "update-map", title: "How a test result updates a belief", source: "graph LR\n  Prior[Prior belief] --> Update{Bayes' rule}\n  Evidence[Test result] --> Update\n  Update --> Posterior[Posterior belief]" } },
};
export const AudioUnavailable: Story = {
	args: { node: { type: "media", id: "clip", kind: "audio", resource: { id: "r1", title: "Pronunciation of 'posterior'", format: "markdown", uri: "https://audio.invalid/posterior.mp3" } } },
};
export const Video: Story = {
	args: { node: { type: "media", id: "lever-video", kind: "video", resource: { id: "r2", title: "A lever, pivot moving", format: "markdown", uri: "https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.webm" } } },
};
