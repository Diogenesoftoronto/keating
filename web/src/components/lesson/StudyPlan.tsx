import type { UiStudyPlanItem, UiActionReceipt } from "@keating/learner-contracts";
import type { SharedUiActionEvent } from "../../keating/openui/shared-renderer";
import { LessonFrame } from "./LessonFrame";
import { MarkdownBlock } from "../MarkdownBlock";
import { LessonPlanJudgementReview } from "../LessonPlanJudgementReview";

export function Plan({ nodeId, title, overview, items, receipt, persistent, disabled, onAction }: { nodeId: string; title: string; overview?: string; receipt?: UiActionReceipt; persistent: boolean; items: UiStudyPlanItem[]; disabled: boolean; onAction?: (event: SharedUiActionEvent) => boolean }) {
	const leaves = (rows: UiStudyPlanItem[]): UiStudyPlanItem[] => rows.flatMap(row => row.children?.length ? leaves(row.children) : [row]);
	const steps = leaves(items);
	const next = steps.find(item => item.status !== "done");
	return <LessonFrame glyph="route" title={title} kind="Study plan" tools={`${steps.filter(item => item.status === "done").length} of ${steps.length}`} footer={<>
		<small>{persistent ? "Resumable plan" : "Kept in this session"}</small>
		{receipt ? <span role="status">Saved to Materials</span> : <button className="lesson-primary k-lift" disabled={disabled} onClick={() => onAction?.({intent:{type:"save-artifact",nodeId}, humanFriendlyMessage:`Saved ${title}`})}>Save to Materials</button>}
	</>}>{overview && <MarkdownBlock content={overview}/>}<PlanItems nodeId={nodeId} items={items} next={next?.id} disabled={disabled} onAction={onAction}/>
		<LessonPlanJudgementReview plan={{id:nodeId,title,overview,items}} disabled={disabled}/>
	</LessonFrame>;
}

function PlanItems({ nodeId, items, next, disabled, onAction }: { next?: string; nodeId: string; items: UiStudyPlanItem[]; disabled: boolean; onAction?: (event: SharedUiActionEvent) => boolean }) {
	return <ul className="lesson-plan">{items.map(item => <li key={item.id}>
		<div className="lesson-step"><label><input type="checkbox" checked={item.status === "done"} disabled={disabled} onChange={() => onAction?.({
			intent:{type:"complete-plan-item",nodeId,itemId:item.id,completed:item.status !== "done"},
			humanFriendlyMessage:`${item.status === "done" ? "Reopened" : "Completed"}: ${item.title}`
		})}/><span><strong>{item.title}</strong>{item.detail && <small>{item.detail}</small>}</span>
		{item.estimatedMinutes && <small>{item.estimatedMinutes} min</small>}</label>
		{!disabled && item.id === next && <a className="lesson-start" aria-label={`Start ${item.title}`} href={`/chat?ask=${encodeURIComponent("Help me start this study plan step: " + item.title)}`}>Start</a>}</div>
		{item.children && <PlanItems nodeId={nodeId} items={item.children} next={next} disabled={disabled} onAction={onAction}/>}
	</li>)}</ul>;
}

