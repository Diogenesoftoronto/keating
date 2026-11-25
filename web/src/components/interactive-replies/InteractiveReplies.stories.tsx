import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { INTERACTIVE_TITLES, type InteractiveKind, type JsonObject, type UiActionReceipt, type UiInteractiveNode } from "@keating/learner-contracts";
import { InteractiveReplyRenderer } from "./InteractiveReplyRenderer";
import type { SharedUiActionEvent } from "../../keating/openui/shared-renderer";
import { presets as stateMachine } from "./state-machine/component";
import { presets as construction } from "./construction/component";
import { presets as fractionLine } from "./fraction-line/component";
import { presets as equation } from "./equation/component";
import { presets as permutation } from "./permutation/component";
import { presets as linkedModel } from "./linked-model/component";
import { presets as sortBoard } from "./sort-board/component";
import { presets as dataExplorer } from "./data-explorer/component";
import { presets as planTimeline } from "./plan-timeline/component";
import { presets as evidenceBoard } from "./evidence-board/component";
import { presets as anatomy } from "./anatomy/component";
import { presets as pharmacology } from "./pharmacology/component";
import { presets as methods } from "./methods/component";
import { presets as physics } from "./physics/component";

const PRESETS: Record<InteractiveKind, Record<string, unknown>> = {
	"state-machine": stateMachine,
	construction,
	"fraction-line": fractionLine,
	equation,
	permutation,
	"linked-model": linkedModel,
	"sort-board": sortBoard,
	"data-explorer": dataExplorer,
	"plan-timeline": planTimeline,
	"evidence-board": evidenceBoard,
	anatomy,
	pharmacology,
	methods,
	physics,
};

/* Configs reach the renderer as JSON from the model, so every preset makes a JSON round trip. */
function nodeFor(kind: InteractiveKind, preset: string): UiInteractiveNode {
	const config = JSON.parse(JSON.stringify(PRESETS[kind][preset])) as JsonObject;
	return { type: "interactive", id: `${kind}-${preset}`, kind, title: `${INTERACTIVE_TITLES[kind]}: ${preset}`, config };
}

function Presets({ kind }: { kind: InteractiveKind }) {
	const [log, setLog] = useState<string[]>([]);
	const onAction = (event: SharedUiActionEvent) => { setLog((lines) => [...lines, event.humanFriendlyMessage]); return true; };
	return <div style={{ display: "grid", gap: "1.2rem", maxWidth: 760, padding: 16 }}>
		{Object.keys(PRESETS[kind]).map((preset) => <section key={preset} style={{ display: "grid", gap: ".4rem" }}>
			<small style={{ fontFamily: "var(--font-mono)", color: "var(--ink-soft)" }}>{preset}</small>
			<InteractiveReplyRenderer node={nodeFor(kind, preset)} onAction={onAction} />
		</section>)}
		{log.length ? <pre style={{ whiteSpace: "pre-wrap", fontSize: ".55rem" }}>{log.join("\n")}</pre> : null}
	</div>;
}

const meta = {
	title: "OpenUI/Interactive replies",
	component: Presets,
	parameters: { layout: "fullscreen" },
	args: { kind: "state-machine" },
	argTypes: { kind: { control: "select", options: Object.keys(PRESETS) } },
} satisfies Meta<typeof Presets>;
export default meta;
type Story = StoryObj<typeof meta>;

export const StateMachine: Story = { args: { kind: "state-machine" } };
export const Construction: Story = { args: { kind: "construction" } };
export const FractionLine: Story = { args: { kind: "fraction-line" } };
export const EquationWorkbench: Story = { args: { kind: "equation" } };
export const PermutationLab: Story = { args: { kind: "permutation" } };
export const LinkedModel: Story = { args: { kind: "linked-model" } };
export const SortBoard: Story = { args: { kind: "sort-board" } };
export const DataExplorer: Story = { args: { kind: "data-explorer" } };
export const PlanTimeline: Story = { args: { kind: "plan-timeline" } };
export const EvidenceBoard: Story = { args: { kind: "evidence-board" } };
export const Anatomy3D: Story = { args: { kind: "anatomy" } };
export const PharmLab: Story = { args: { kind: "pharmacology" } };
export const MethodsLab: Story = { args: { kind: "methods" } };
export const PhysicsLab: Story = { args: { kind: "physics" } };

const shareReceipt: UiActionReceipt = {
	state: "completed",
	updatedAt: "2026-11-24T12:00:00.000Z",
	action: {
		schemaVersion: 1, type: "share-interactive", documentId: "story", documentRevision: 1, nodeId: "sort-board-shared",
		kind: "sort-board", share: { learner: "I sorted them.", data: "All in place.", analysis: "Looks right." }, idempotencyKey: "story-share",
	},
} as unknown as UiActionReceipt;

/** A reply the learner already shared: the renderer shows the receipt line under the card. */
export const AlreadyShared: Story = {
	args: { kind: "sort-board" },
	render: () => {
		const first = Object.keys(PRESETS["sort-board"])[0]!;
		const node = { ...nodeFor("sort-board", first), id: "sort-board-shared" };
		return <div style={{ maxWidth: 760, padding: 16 }}><InteractiveReplyRenderer node={node} receipt={shareReceipt} onAction={() => true} /></div>;
	},
};

/** A config the component's own validator rejects renders the calm fallback line. */
export const InvalidConfig: Story = {
	args: { kind: "data-explorer" },
	render: () => <div style={{ maxWidth: 760, padding: 16 }}>
		<InteractiveReplyRenderer node={{ type: "interactive", id: "bad", kind: "data-explorer", title: "Broken", config: { title: "Broken", rows: [] } }} />
	</div>,
};
