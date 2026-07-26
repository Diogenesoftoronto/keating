import { ChevronRight, Clock3, Network, Route } from "lucide-react";
import { defineComponent, useStateField } from "@openuidev/react-lang";
import { z } from "zod";
import { css, cx } from "../../../styled-system/css";
import { MermaidRenderer } from "../../components/MermaidRenderer";

export interface StudyPlanItem {
	id: string;
	title: string;
	detail?: string;
	dependsOn?: string[];
	estimatedMinutes?: number;
	outcomes?: string[];
	children?: StudyPlanItem[];
}

const planItemSchema: z.ZodType<StudyPlanItem> = z.lazy(() =>
	z.object({
		id: z.string().describe("Stable unique id used by progress and dependency links"),
		title: z.string().describe("Concise coverage-area or lesson-step title"),
		detail: z.string().optional().describe("What to learn, practice, or produce in this step"),
		dependsOn: z.array(z.string()).max(12).optional().describe("Ids that should be completed before this item"),
		estimatedMinutes: z.number().int().positive().max(600).optional(),
		outcomes: z.array(z.string()).max(8).optional().describe("Concrete outcomes that demonstrate completion"),
		children: z.array(planItemSchema).min(1).max(20).optional().describe("Nested subtopics or activities"),
	}),
);

const studyPlanPropsSchema = z.object({
	id: z.string(),
	title: z.string(),
	items: z.array(planItemSchema).min(1).max(12).describe("Top-level coverage areas, each optionally containing nested subtopics"),
	lifecycle: z.enum(["ephemeral", "resumable", "workspace"]).default("workspace"),
	overview: z.string().optional().describe("Short statement of scope and intended outcome"),
});

const planClass = css({
	minWidth: 0,
});
const planHeaderClass = css({
	display: "flex",
	alignItems: "flex-start",
	justifyContent: "space-between",
	gap: "1rem",
	borderBottom: "1px solid var(--border)",
	padding: "0.875rem 1rem",
});
const planTitleClass = css({ fontSize: "0.9375rem", fontWeight: 650 });
const overviewClass = css({
	marginTop: "0.25rem",
	maxWidth: "70ch",
	fontSize: "0.75rem",
	lineHeight: 1.5,
	color: "var(--muted-foreground)",
});
const progressClass = css({
	flexShrink: 0,
	borderRadius: "999px",
	backgroundColor: "var(--muted)",
	paddingInline: "0.5rem",
	paddingBlock: "0.1875rem",
	fontSize: "0.6875rem",
	fontVariantNumeric: "tabular-nums",
	color: "var(--muted-foreground)",
});
const planListClass = css({ display: "grid", gap: "0.25rem", padding: "0.75rem" });
const groupClass = css({
	overflow: "hidden",
	borderRadius: "0.625rem",
	backgroundColor: "color-mix(in srgb, var(--muted) 36%, transparent)",
});
const groupButtonClass = css({
	display: "flex",
	width: "100%",
	alignItems: "flex-start",
	gap: "0.625rem",
	padding: "0.75rem",
	textAlign: "left",
	_hover: { backgroundColor: "color-mix(in srgb, var(--muted) 70%, transparent)" },
	_focusVisible: { outline: "2px solid var(--primary)", outlineOffset: "-2px" },
});
const chevronClass = css({ marginTop: "0.1875rem", flexShrink: 0 });
const itemCopyClass = css({ minWidth: 0, flex: 1 });
const itemTitleClass = css({ display: "block", fontSize: "0.8125rem", fontWeight: 600, lineHeight: 1.4 });
const itemDetailClass = css({
	display: "block",
	marginTop: "0.1875rem",
	maxWidth: "72ch",
	fontSize: "0.75rem",
	lineHeight: 1.45,
	color: "var(--muted-foreground)",
});
const metaClass = css({
	display: "inline-flex",
	flexShrink: 0,
	alignItems: "center",
	gap: "0.25rem",
	fontSize: "0.6875rem",
	color: "var(--muted-foreground)",
});
const childListClass = css({
	display: "grid",
	gap: "0.25rem",
	borderTop: "1px solid color-mix(in srgb, var(--border) 70%, transparent)",
	padding: "0.5rem",
	paddingLeft: "1rem",
});
const groupOutcomesClass = css({
	borderTop: "1px solid color-mix(in srgb, var(--border) 70%, transparent)",
	padding: "0.625rem 1rem 0.75rem 2.25rem",
});
const leafClass = css({
	display: "flex",
	cursor: "pointer",
	alignItems: "flex-start",
	gap: "0.625rem",
	borderRadius: "0.5rem",
	padding: "0.625rem",
	_hover: { backgroundColor: "var(--muted)" },
	_focusWithin: { outline: "2px solid var(--primary)", outlineOffset: "1px" },
});
const outcomeListClass = css({
	marginTop: "0.5rem",
	display: "grid",
	gap: "0.25rem",
	paddingLeft: "1.125rem",
	listStyleType: "disc",
	fontSize: "0.75rem",
	lineHeight: 1.45,
	color: "var(--muted-foreground)",
});
const dependencySectionClass = css({
	borderTop: "1px solid var(--border)",
	"&[open] summary": { borderBottom: "1px solid var(--border)" },
});
const dependencySummaryClass = css({
	display: "flex",
	cursor: "pointer",
	listStyle: "none",
	alignItems: "center",
	gap: "0.5rem",
	padding: "0.75rem 1rem",
	fontSize: "0.75rem",
	fontWeight: 600,
	_hover: { backgroundColor: "var(--muted)" },
	_focusVisible: { outline: "2px solid var(--primary)", outlineOffset: "-2px" },
	"&::-webkit-details-marker": { display: "none" },
});
const dependencyBodyClass = css({ padding: "0.75rem" });

export function flattenStudyPlanItems(items: readonly StudyPlanItem[]): StudyPlanItem[] {
	return items.flatMap((item) => [item, ...flattenStudyPlanItems(item.children ?? [])]);
}

export function studyPlanLeafItems(items: readonly StudyPlanItem[]): StudyPlanItem[] {
	return items.flatMap((item) => item.children?.length ? studyPlanLeafItems(item.children) : [item]);
}

function safeMermaidLabel(value: string): string {
	return value.replace(/["<>{}\[\]\n\r]/g, " ").replace(/\s+/g, " ").trim().slice(0, 96);
}

export function studyPlanDependencyGraph(
	items: readonly StudyPlanItem[],
): { code: string; edgeCount: number } | null {
	const flattened = flattenStudyPlanItems(items);
	const byId = new Map(flattened.map((item) => [item.id, item]));
	const nodeName = new Map(flattened.map((item, index) => [item.id, `step${index + 1}`]));
	const edges: Array<{ source: string; target: string }> = [];

	for (const item of flattened) {
		for (const dependencyId of item.dependsOn ?? []) {
			if (dependencyId !== item.id && byId.has(dependencyId)) {
				edges.push({ source: dependencyId, target: item.id });
			}
		}
	}
	if (edges.length === 0) return null;

	const visibleIds = new Set(edges.flatMap((edge) => [edge.source, edge.target]));
	const lines = ["flowchart LR"];
	for (const item of flattened) {
		if (!visibleIds.has(item.id)) continue;
		lines.push(`    ${nodeName.get(item.id)}["${safeMermaidLabel(item.title)}"]`);
	}
	for (const edge of edges) {
		lines.push(`    ${nodeName.get(edge.source)} --> ${nodeName.get(edge.target)}`);
	}
	return { code: lines.join("\n"), edgeCount: edges.length };
}

interface PlanBranchProps {
	item: StudyPlanItem;
	depth: number;
	planId: string;
	progress: { value: Record<string, boolean>; setValue: (value: Record<string, boolean>) => void };
	expansion: { value: Record<string, boolean>; setValue: (value: Record<string, boolean>) => void };
}

function PlanBranch({ item, depth, planId, progress, expansion }: PlanBranchProps) {
	const children = item.children ?? [];
	const leafItems = studyPlanLeafItems([item]);
	const completedLeaves = leafItems.filter((leaf) => progress.value[leaf.id]).length;
	const isExpanded = expansion.value[item.id] ?? depth === 0;

	if (children.length === 0) {
		const checked = Boolean(progress.value[item.id]);
		return (
			<li>
				<label className={leafClass}>
					<input
						type="checkbox"
						checked={checked}
						onChange={(event) => progress.setValue({ ...progress.value, [item.id]: event.currentTarget.checked })}
						className={css({ marginTop: "0.1875rem", accentColor: "var(--primary)" })}
					/>
					<span className={itemCopyClass}>
						<span className={cx(itemTitleClass, checked && css({ textDecoration: "line-through", color: "var(--muted-foreground)" }))}>
							{item.title}
						</span>
						{item.detail ? <span className={itemDetailClass}>{item.detail}</span> : null}
						{item.outcomes?.length ? (
							<ul className={outcomeListClass}>
								{item.outcomes.map((outcome) => <li key={outcome}>{outcome}</li>)}
							</ul>
						) : null}
					</span>
					{item.estimatedMinutes ? (
						<span className={metaClass}><Clock3 aria-hidden="true" size={11} />{item.estimatedMinutes} min</span>
					) : null}
				</label>
			</li>
		);
	}

	const regionId = `${planId}-${item.id}`.replace(/[^a-zA-Z0-9_-]/g, "-");
	return (
		<li className={groupClass}>
			<button
				type="button"
				className={groupButtonClass}
				aria-expanded={isExpanded}
				aria-controls={regionId}
				onClick={() => expansion.setValue({ ...expansion.value, [item.id]: !isExpanded })}
			>
				<ChevronRight
					aria-hidden="true"
					size={15}
					className={chevronClass}
					style={{ transform: isExpanded ? "rotate(90deg)" : undefined }}
				/>
				<span className={itemCopyClass}>
					<span className={itemTitleClass}>{item.title}</span>
					{item.detail ? <span className={itemDetailClass}>{item.detail}</span> : null}
				</span>
				<span className={metaClass}>
					{item.estimatedMinutes ? <><Clock3 aria-hidden="true" size={11} />{item.estimatedMinutes} min · </> : null}
					{completedLeaves}/{leafItems.length}
				</span>
			</button>
			{isExpanded && item.outcomes?.length ? (
				<div className={groupOutcomesClass}>
					<ul className={outcomeListClass}>
						{item.outcomes.map((outcome) => <li key={outcome}>{outcome}</li>)}
					</ul>
				</div>
			) : null}
			{isExpanded ? (
				<ol id={regionId} className={childListClass}>
					{children.map((child) => (
						<PlanBranch
							key={child.id}
							item={child}
							depth={depth + 1}
							planId={planId}
							progress={progress}
							expansion={expansion}
						/>
					))}
				</ol>
			) : null}
		</li>
	);
}

function OpenUIStudyPlan({ props }: { props: z.infer<typeof studyPlanPropsSchema> }) {
	const progress = useStateField<Record<string, boolean>>(`${props.id}:progress`, {});
	const expansion = useStateField<Record<string, boolean>>(`${props.id}:expansion`, {});
	const leafItems = studyPlanLeafItems(props.items);
	const completed = leafItems.filter((item) => progress.value[item.id]).length;
	const dependencyGraph = studyPlanDependencyGraph(props.items);

	return (
		<section className={planClass}>
			<header className={planHeaderClass}>
				<div className={css({ minWidth: 0 })}>
					<div className={css({ display: "flex", alignItems: "center", gap: "0.5rem" })}>
						<Route aria-hidden="true" size={16} className={css({ flexShrink: 0, color: "var(--primary)" })} />
						<h3 className={planTitleClass}>{props.title}</h3>
					</div>
					{props.overview ? <p className={overviewClass}>{props.overview}</p> : null}
				</div>
				<span className={progressClass}>{completed}/{leafItems.length} steps</span>
			</header>
			<ol className={planListClass}>
				{props.items.map((item) => (
					<PlanBranch
						key={item.id}
						item={item}
						depth={0}
						planId={props.id}
						progress={progress}
						expansion={expansion}
					/>
				))}
			</ol>
			{dependencyGraph ? (
				<details className={dependencySectionClass}>
					<summary className={dependencySummaryClass}>
						<Network aria-hidden="true" size={14} />
						<span>Dependency graph</span>
						<span className={css({ marginLeft: "auto", fontWeight: 400, color: "var(--muted-foreground)" })}>
							{dependencyGraph.edgeCount} link{dependencyGraph.edgeCount === 1 ? "" : "s"}
						</span>
					</summary>
					<div className={dependencyBodyClass}>
						<MermaidRenderer content={dependencyGraph.code} />
					</div>
				</details>
			) : null}
		</section>
	);
}

export const StudyPlan = defineComponent({
	name: "StudyPlan",
	description: "A detailed, nestable lesson plan with coverage areas, learner-controlled progress, and explicit dependency links.",
	props: studyPlanPropsSchema,
	component: OpenUIStudyPlan,
});
