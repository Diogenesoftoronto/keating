import { Loading } from "../../design-system/kit";
import { LessonFrame } from "../../components/lesson/LessonFrame";
import { useState } from "react";
import { KeatingGlyph } from "../../design-system/glyphs";
import { defineComponent, useStateField, useIsStreaming } from "@openuidev/react-lang";
import { z } from "zod";
import { css, cx } from "../../../styled-system/css";
import { MermaidRenderer } from "../../components/MermaidRenderer";
import { createCourse } from "../../courses/client";
import { courseFromStudyPlan } from "../../courses/from-study-plan";
import { LessonPlanJudgementReview } from "../../components/LessonPlanJudgementReview";

export interface StudyPlanItem {
	id: string;
	title: string;
	detail?: string;
	dependsOn?: string[];
	estimatedMinutes?: number;
	outcomes?: string[];
	children?: StudyPlanItem[];
}

export interface StudyPlanLink {
	planId: string;
	title: string;
	relation?: "prerequisite" | "follow-up" | "related";
	detail?: string;
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

const studyPlanLinkSchema: z.ZodType<StudyPlanLink> = z.object({
	planId: z.string().describe("Stable id of the StudyPlan this link should open"),
	title: z.string().describe("Learner-facing title of the linked plan"),
	relation: z.enum(["prerequisite", "follow-up", "related"]).default("related"),
	detail: z.string().optional().describe("Why this plan is relevant to the current plan"),
});

const studyPlanPropsSchema = z.object({
	id: z.string(),
	title: z.string(),
	items: z.array(planItemSchema).min(1).max(12).describe("Top-level coverage areas, each optionally containing nested subtopics"),
	lifecycle: z.enum(["ephemeral", "resumable", "workspace"]).default("workspace"),
	overview: z.string().optional().describe("Short statement of scope and intended outcome"),
	relatedPlans: z.array(studyPlanLinkSchema).max(8).optional().describe("Links to prerequisite, follow-up, or related StudyPlan ids"),
});

const courseErrorClass = css({
	display: "flex",
	alignItems: "center",
	justifyContent: "space-between",
	gap: "0.75rem",
	borderBottom: "1px solid color-mix(in srgb, var(--destructive) 35%, var(--border))",
	backgroundColor: "color-mix(in srgb, var(--destructive) 8%, transparent)",
	paddingInline: "1rem",
	paddingBlock: "0.625rem",
	fontSize: "0.75rem",
	lineHeight: 1.45,
	color: "var(--destructive)",
});
const planListClass = "lesson-outline";
const groupClass = "lesson-outline-group";
const groupButtonClass = "lesson-outline-toggle";
const chevronClass = css({ marginTop: "0.1875rem", flexShrink: 0 });
const itemCopyClass = css({ minWidth: 0, flex: 1 });
const itemTitleClass = "lesson-outline-title";
const itemDetailClass = css({
	display: "block",
	marginTop: "0.1875rem",
	maxWidth: "72ch",
	fontSize: "0.75rem",
	lineHeight: 1.45,
	color: "var(--muted-foreground)",
});
const metaClass = "lesson-outline-meta";
const childListClass = "lesson-outline-children";
const groupOutcomesClass = css({
	borderTop: "1px solid color-mix(in srgb, var(--border) 70%, transparent)",
	padding: "0.625rem 1rem 0.75rem 2.25rem",
});
const leafClass = "lesson-outline-leaf";
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
const relatedPlansClass = css({
	borderTop: "1px solid var(--border)",
	padding: "0.75rem 1rem 0.875rem",
});
const relatedPlansHeadingClass = css({
	display: "flex",
	alignItems: "center",
	gap: "0.5rem",
	fontSize: "0.75rem",
	fontWeight: 600,
});
const relatedPlansListClass = css({
	marginTop: "0.5rem",
	display: "grid",
	gap: "0.25rem",
});
const relatedPlanLinkClass = css({
	display: "flex",
	alignItems: "flex-start",
	gap: "0.625rem",
	borderRadius: "0.375rem",
	padding: "0.5rem",
	color: "inherit",
	textDecoration: "none",
	_hover: { backgroundColor: "var(--muted)" },
	_focusVisible: { outline: "2px solid var(--primary)", outlineOffset: "1px" },
});

export function studyPlanAnchorId(planId: string): string {
	const safeId = planId
		.trim()
		.replace(/[^a-zA-Z0-9_-]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return `study-plan-${safeId || "plan"}`;
}

function relationLabel(relation: StudyPlanLink["relation"]): string {
	switch (relation) {
		case "prerequisite":
			return "Prerequisite";
		case "follow-up":
			return "Continue with";
		default:
			return "Related";
	}
}

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
	const isExpanded = expansion.value[item.id] ?? depth < 2;

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
						<span className={metaClass}><KeatingGlyph name="clock" size={11} />{item.estimatedMinutes} min</span>
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
				<KeatingGlyph name={isExpanded ? "chev" : "chevr"}
					size={15}
					className={chevronClass}
				/>
				<span className={itemCopyClass}>
					<span className={itemTitleClass}>{item.title}</span>
					{item.detail ? <span className={itemDetailClass}>{item.detail}</span> : null}
				</span>
				<span className={metaClass}>
					{item.estimatedMinutes ? <><KeatingGlyph name="clock" size={11} />{item.estimatedMinutes} min · </> : null}
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
	const streaming = useIsStreaming();
	const progress = useStateField<Record<string, boolean>>(`${props.id}:progress`, {});
	const expansion = useStateField<Record<string, boolean>>(`${props.id}:expansion`, {});
	const leafItems = studyPlanLeafItems(props.items);
	const completed = leafItems.filter((item) => progress.value[item.id]).length;
	const dependencyGraph = studyPlanDependencyGraph(props.items);
	const [courseState, setCourseState] = useState<{ status: "idle" | "creating" | "error"; message?: string }>({ status: "idle" });

	const createPlanCourse = async () => {
		if (courseState.status === "creating") return;
		setCourseState({ status: "creating" });
		try {
			const snapshot = await createCourse(courseFromStudyPlan(props));
			window.location.assign(`/courses/${encodeURIComponent(snapshot.course.id)}`);
		} catch (cause) {
			setCourseState({
				status: "error",
				message: cause instanceof Error ? cause.message : "The course workspace could not be reached.",
			});
		}
	};

	return (
		<LessonFrame glyph="route" kind="Study plan" title={props.title} tools={`${completed} of ${leafItems.length}`} id={studyPlanAnchorId(props.id)} tabIndex={-1} footer={<button
						type="button"
						className="lesson-primary k-lift"
						disabled={courseState.status === "creating"}
						onClick={() => void createPlanCourse()}
					>
						{courseState.status !== "creating" && <KeatingGlyph name="book" size={13} />}
						{courseState.status === "creating" ? <Loading size="inline" label="Creating…" /> : courseState.status === "error" ? "Retry course" : "Create course"}
					</button>}>
			{props.overview && <p>{props.overview}</p>}
			<LessonPlanJudgementReview plan={props} disabled={streaming} />
			{courseState.status === "error" ? (
				<div className={courseErrorClass} role="alert">
					<span>Course not created. {courseState.message}</span>
					<span>Your plan is still here.</span>
				</div>
			) : null}
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
						<KeatingGlyph name="tree" size={14} />
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
			{props.relatedPlans?.length ? (
				<nav className={relatedPlansClass} aria-label={`Study plans linked to ${props.title}`}>
					<p className={relatedPlansHeadingClass}>
						<KeatingGlyph name="link" size={14} />
						Linked study plans
					</p>
					<ul className={relatedPlansListClass}>
						{props.relatedPlans.map((link) => (
							<li key={`${link.relation ?? "related"}:${link.planId}`}>
								<a
									href={`#${studyPlanAnchorId(link.planId)}`}
									className={relatedPlanLinkClass}
								>
									<span className={css({ minWidth: 0, flex: 1 })}>
										<span className={css({ display: "block", fontSize: "0.8125rem", fontWeight: 600 })}>
											{relationLabel(link.relation)}: {link.title}
										</span>
										{link.detail ? (
											<span className={itemDetailClass}>{link.detail}</span>
										) : null}
									</span>
									<KeatingGlyph name="chevr"
										size={15}
										className={css({ marginTop: "0.125rem", flexShrink: 0, color: "var(--muted-foreground)" })}
									/>
								</a>
							</li>
						))}
					</ul>
				</nav>
			) : null}
		</LessonFrame>
	);
}

export const StudyPlan = defineComponent({
	name: "StudyPlan",
	description: "A detailed, recursively nested lesson plan with learner-controlled progress, internal dependencies, and links to other study plans.",
	props: studyPlanPropsSchema,
	component: OpenUIStudyPlan,
});
