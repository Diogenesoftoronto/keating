import { useEffect, useMemo, useReducer } from "react";
import {
	artifactVersionKey,
	type PedagogyRubricKey,
	type ReviewRating,
	type ReviewVerdict,
	type TrajectoryAnnotation,
} from "../../keating/trajectory-review";
import { css, cx } from "../../../styled-system/css";
import { KeatingIcon } from "../KeatingIcon";
import { reviewIcon } from "./review-icons";
import { metaTextClass } from "./styles";
import { TrajectoryCanvas, type TrajectoryCanvasMode } from "./TrajectoryCanvas";
import type {
	ArtifactRenderer,
	NormalizedTrajectoryArtifact,
	TrajectorySessionMessage,
	TrajectorySessionSummary,
} from "./types";

export interface SharedTrajectoryReviewSummary {
	verdict?: ReviewVerdict;
	ratings?: Partial<Record<PedagogyRubricKey, ReviewRating>>;
	overallRating?: ReviewRating;
	summary?: string;
}

export interface SharedTrajectoryWorkspaceData {
	session: TrajectorySessionSummary;
	messages: TrajectorySessionMessage[];
	artifacts: NormalizedTrajectoryArtifact[];
	/** Draft annotations are ignored if supplied accidentally. */
	annotations: TrajectoryAnnotation[];
	review?: SharedTrajectoryReviewSummary;
}

export interface SharedTrajectoryWorkspaceProps {
	data: SharedTrajectoryWorkspaceData;
	renderArtifact?: ArtifactRenderer;
	className?: string;
}

export interface SharedTrajectoryNavigationState {
	sessionId: string;
	mode: TrajectoryCanvasMode;
	activeMessageId?: string;
	activeArtifactId?: string;
	activeAnnotationId?: string;
}

export type SharedTrajectoryNavigationAction =
	| {
			type: "reconcile";
			sessionId: string;
			messageIds: string[];
			artifactIds: string[];
			annotationIds: string[];
	  }
	| { type: "mode"; mode: TrajectoryCanvasMode }
	| { type: "message"; messageId: string }
	| { type: "artifact"; artifactId: string }
	| { type: "annotation"; annotationId: string; messageId?: string; artifactId?: string };

export function initialSharedTrajectoryNavigation(
	sessionId: string,
	messageIds: readonly string[],
	artifactIds: readonly string[],
): SharedTrajectoryNavigationState {
	return {
		sessionId,
		mode: messageIds.length > 0 ? "transcript" : "artifact",
		activeMessageId: messageIds[0],
		activeArtifactId: artifactIds[0],
	};
}

export function sharedTrajectoryNavigationReducer(
	state: SharedTrajectoryNavigationState,
	action: SharedTrajectoryNavigationAction,
): SharedTrajectoryNavigationState {
	if (action.type === "reconcile") {
		if (action.sessionId !== state.sessionId) {
			return initialSharedTrajectoryNavigation(action.sessionId, action.messageIds, action.artifactIds);
		}
		const activeMessageId = state.activeMessageId && action.messageIds.includes(state.activeMessageId)
			? state.activeMessageId
			: action.messageIds[0];
		const activeArtifactId = state.activeArtifactId && action.artifactIds.includes(state.activeArtifactId)
			? state.activeArtifactId
			: action.artifactIds[0];
		const mode = state.mode === "transcript" && !activeMessageId && activeArtifactId
			? "artifact"
			: state.mode === "artifact" && !activeArtifactId && activeMessageId
				? "transcript"
				: state.mode;
		return {
			...state,
			mode,
			activeMessageId,
			activeArtifactId,
			activeAnnotationId: state.activeAnnotationId && action.annotationIds.includes(state.activeAnnotationId)
				? state.activeAnnotationId
				: undefined,
		};
	}
	if (action.type === "mode") return { ...state, mode: action.mode };
	if (action.type === "message") {
		return { ...state, mode: "transcript", activeMessageId: action.messageId, activeAnnotationId: undefined };
	}
	if (action.type === "artifact") {
		return { ...state, mode: "artifact", activeArtifactId: action.artifactId, activeAnnotationId: undefined };
	}
	return {
		...state,
		mode: action.messageId ? "transcript" : action.artifactId ? "artifact" : state.mode,
		activeMessageId: action.messageId ?? state.activeMessageId,
		activeArtifactId: action.artifactId ?? state.activeArtifactId,
		activeAnnotationId: action.annotationId,
	};
}

function formattedDate(timestamp: number | undefined): string | null {
	if (!timestamp || !Number.isFinite(timestamp)) return null;
	return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(timestamp);
}

export function SharedTrajectoryWorkspace({ data, renderArtifact, className }: SharedTrajectoryWorkspaceProps) {
	const finalAnnotations = useMemo(
		() => data.annotations.filter((annotation) => annotation.status === "final"),
		[data.annotations],
	);
	const [navigation, dispatch] = useReducer(
		sharedTrajectoryNavigationReducer,
		undefined,
		() => initialSharedTrajectoryNavigation(data.session.id, data.messages.map((message) => message.id), data.artifacts.map((artifact) => artifact.id)),
	);
	const sessionDate = formattedDate(data.session.startedAt);

	useEffect(() => {
		dispatch({
			type: "reconcile",
			sessionId: data.session.id,
			messageIds: data.messages.map((message) => message.id),
			artifactIds: data.artifacts.map((artifact) => artifact.id),
			annotationIds: finalAnnotations.map((annotation) => annotation.id),
		});
	}, [data.artifacts, data.messages, data.session.id, finalAnnotations]);

	function selectAnnotation(annotation: TrajectoryAnnotation) {
		const target = annotation.target;
		if (target.kind === "message" || target.kind === "message-span") {
			dispatch({ type: "annotation", annotationId: annotation.id, messageId: target.messageId });
			return;
		}
		if (target.kind.startsWith("artifact") && "artifact" in target) {
			const key = artifactVersionKey(target.artifact);
			const artifactId = data.artifacts.find((artifact) => artifactVersionKey(artifact.reference) === key)?.id;
			dispatch({ type: "annotation", annotationId: annotation.id, artifactId });
			return;
		}
		dispatch({ type: "annotation", annotationId: annotation.id });
	}

	return (
		<main aria-label="Shared session" className={cx(css({ display: "flex", width: "100%", height: { base: "auto", md: "min(86dvh, 56rem)" }, minHeight: { base: "38rem", md: "40rem" }, flexDirection: "column", overflow: "hidden", border: "1px solid var(--border)", borderRadius: { base: 0, md: "0.5rem" }, background: "var(--paper, var(--background))", color: "var(--foreground)" }), className)}>
			<header className={css({ display: "flex", minHeight: "4rem", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "0.625rem", borderBottom: "1px solid var(--border)", padding: { base: "0.625rem 0.75rem", md: "0.625rem 1rem" } })}>
				<div className={css({ minWidth: 0 })}>
					<div className={css({ display: "flex", alignItems: "center", gap: "0.5rem" })}>
						<h1 className={css({ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontFamily: "serif", fontSize: { base: "1rem", md: "1.125rem" }, fontWeight: 700, color: "var(--foreground)" })}>{data.session.title}</h1>
						<span className={css({ display: "inline-flex", flex: "0 0 auto", alignItems: "center", gap: "0.25rem", borderRadius: "9999px", background: "var(--muted)", padding: "0.15rem 0.4rem", fontSize: "0.5625rem", fontWeight: 750, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--muted-foreground)" })}><KeatingIcon icon={reviewIcon.inspect} size={10} /> Read only</span>
					</div>
					<div className={cx(metaTextClass, css({ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.35rem", marginTop: "0.125rem" }))}>
						<span>Shared session</span>
						{data.session.subtitle ? <><span aria-hidden="true">·</span><span>{data.session.subtitle}</span></> : null}
						{sessionDate ? <><span aria-hidden="true">·</span><span>{sessionDate}</span></> : null}
					</div>
				</div>
				<div className={css({ display: "flex", alignItems: "center", gap: "0.75rem", fontSize: "0.6875rem", color: "var(--muted-foreground)" })}>
					<span className={css({ display: "inline-flex", alignItems: "center", gap: "0.25rem" })}><KeatingIcon icon={reviewIcon.message} size={12} /> {data.messages.length} turns</span>
					<span className={css({ display: "inline-flex", alignItems: "center", gap: "0.25rem" })}><KeatingIcon icon={reviewIcon.page} size={12} /> {data.artifacts.length} artifacts</span>
				</div>
			</header>

			<section aria-label="Shared session content" className={css({ display: "flex", minWidth: 0, minHeight: { base: "32rem", md: 0 }, flex: 1, flexDirection: "column" })}>
					<TrajectoryCanvas
						messages={data.messages}
						artifacts={data.artifacts}
						annotations={finalAnnotations}
						activeMessageId={navigation.activeMessageId}
						activeArtifactId={navigation.activeArtifactId}
						activeAnnotationId={navigation.activeAnnotationId}
						mode={navigation.mode}
						readOnly
						transcript="continuous"
						onModeChange={(mode) => dispatch({ type: "mode", mode })}
						onSelectMessage={(messageId) => dispatch({ type: "message", messageId })}
						onSelectArtifact={(artifactId) => dispatch({ type: "artifact", artifactId })}
						onSelectAnnotation={(annotationId) => {
							const annotation = finalAnnotations.find((entry) => entry.id === annotationId);
							if (annotation) selectAnnotation(annotation);
						}}
						renderArtifact={renderArtifact}
						className={css({ minHeight: 0, flex: 1 })}
					/>
			</section>
		</main>
	);
}
