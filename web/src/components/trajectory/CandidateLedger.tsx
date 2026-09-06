import { Select } from "../Select";
import { useEffect, useMemo, useRef, useState } from "react";
import {
	estimatePoolCostUsd,
	type ReviewGenerationCandidate,
	type ReviewGenerationTask,
	type ReviewModelPool,
	type StoredModelReference,
} from "../../keating/trajectory-review";
import { css, cx } from "../../../styled-system/css";
import { KeatingIcon } from "../KeatingIcon";
import { buildOpenUIPreview } from "../../keating/openui/preview";
import { OpenUIPreview } from "../OpenUIPreview";
import { reviewIcon } from "./review-icons";
import {
	compatibleReviewModelPools,
	resolveCompatiblePoolId,
	reviewPoolGenerationAvailability,
	reviewTaskLabel,
} from "./pool-compatibility";
import { compactButtonClass, inputClass, metaTextClass, primaryButtonClass } from "./styles";

export interface CandidateLedgerProps {
	candidates: ReviewGenerationCandidate[];
	modelPools: ReviewModelPool[];
	availableModels: StoredModelReference[];
	activeTargetKey: string;
	activeTask: ReviewGenerationTask | null;
	generationUnavailableReason?: string;
	promptCharacters: number;
	activeCandidateId?: string;
	activeModelPoolId?: string;
	selectedCandidateId?: string;
	isGenerating?: boolean;
	onSelectCandidate: (candidateId: string) => void;
	onSelectModelPool: (poolId: string) => void;
	onGenerate: (poolId: string, targetKey: string) => void;
	onChoose: (candidateId: string) => void;
	onInsert: (candidateId: string) => void;
	onRegenerate: (candidateId: string) => void;
}

function stateLabel(state: ReviewGenerationCandidate["state"]): string {
	return state.charAt(0).toUpperCase() + state.slice(1);
}

function usageLabel(candidate: ReviewGenerationCandidate): string | null {
	const parts: string[] = [];
	if (candidate.usage?.totalTokens != null) parts.push(`${candidate.usage.totalTokens.toLocaleString()} tokens`);
	if (candidate.generation) {
		if (candidate.generation.cost.known && candidate.generation.cost.usd != null) {
			parts.push(`$${candidate.generation.cost.usd.toFixed(candidate.generation.cost.usd < 0.01 ? 4 : 2)}`);
		} else if (!candidate.generation.cost.known) {
			parts.push("cost unknown");
		}
	} else if (candidate.usage?.costUsd != null) {
		parts.push(`$${candidate.usage.costUsd.toFixed(candidate.usage.costUsd < 0.01 ? 4 : 2)}`);
	}
	const latencyMs = candidate.generation?.latencyMs ?? candidate.usage?.latencyMs;
	if (latencyMs != null) parts.push(`${(latencyMs / 1_000).toFixed(1)}s`);
	return parts.join(" · ") || null;
}

function unavailableModelLabel(models: readonly StoredModelReference[]): string {
	const visible = models.slice(0, 2).map((model) => `${model.provider}/${model.id}`);
	const remainder = models.length - visible.length;
	return `${visible.join(", ")}${remainder > 0 ? `, plus ${remainder} more` : ""}`;
}

export function CandidateLedger({
	candidates,
	modelPools,
	availableModels,
	activeTargetKey,
	activeTask,
	generationUnavailableReason,
	promptCharacters,
	activeCandidateId,
	activeModelPoolId,
	selectedCandidateId,
	isGenerating,
	onSelectCandidate,
	onSelectModelPool,
	onGenerate,
	onChoose,
	onInsert,
	onRegenerate,
}: CandidateLedgerProps) {
	const [contentView, setContentView] = useState<"rendered" | "raw">("rendered");
	const [copyStatus, setCopyStatus] = useState<{ candidateId: string; state: "copied" | "failed" } | null>(null);
	const copyResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const relevant = useMemo(
		() => candidates.filter((candidate) => candidate.targetKey === activeTargetKey).sort((left, right) => right.updatedAt - left.updatedAt),
		[candidates, activeTargetKey],
	);
	const compatiblePools = useMemo(
		() => activeTask ? compatibleReviewModelPools(modelPools, activeTask) : [],
		[modelPools, activeTask],
	);
	const active = relevant.find((candidate) => candidate.id === activeCandidateId) ?? relevant[0];
	const poolId = activeTask ? resolveCompatiblePoolId(modelPools, activeTask, activeModelPoolId) ?? "" : "";
	const selectedPool = compatiblePools.find((pool) => pool.id === poolId);
	const selectedAvailability = activeTask && selectedPool
		? reviewPoolGenerationAvailability(selectedPool, activeTask, availableModels)
		: undefined;
	const pricingKnown = Boolean(selectedPool?.models.length && selectedPool.models.every((model) =>
		model.provider === "browser"
		|| model.api === "browser"
		|| Object.values(model.cost).some((rate) => rate > 0),
	));
	const estimatedCost = selectedPool ? estimatePoolCostUsd(selectedPool, promptCharacters) : 0;
	const canGenerate = Boolean(selectedAvailability?.ready && activeTargetKey && !isGenerating);
	const regenerationPool = active ? compatiblePools.find((pool) => pool.id === active.poolId) : undefined;
	const regenerationAvailability = activeTask && regenerationPool
		? reviewPoolGenerationAvailability(regenerationPool, activeTask, availableModels)
		: undefined;
	const canRegenerate = Boolean(active && active.state !== "running" && regenerationAvailability?.ready);

	useEffect(() => {
		if (poolId && poolId !== activeModelPoolId) onSelectModelPool(poolId);
	}, [activeModelPoolId, activeTargetKey, activeTask, onSelectModelPool, poolId]);

	useEffect(() => {
		setContentView("rendered");
		setCopyStatus(null);
	}, [active?.id]);

	useEffect(() => () => {
		if (copyResetTimer.current) clearTimeout(copyResetTimer.current);
	}, []);

	function generate() {
		if (!canGenerate || !selectedPool) return;
		onGenerate(selectedPool.id, activeTargetKey);
	}

	function regenerate() {
		if (!canRegenerate || !active) return;
		onRegenerate(active.id);
	}

	async function copyResponse() {
		if (!active?.content?.trim()) return;
		if (copyResetTimer.current) clearTimeout(copyResetTimer.current);
		try {
			if (!navigator.clipboard) throw new Error("Clipboard access is unavailable");
			await navigator.clipboard.writeText(active.content);
			setCopyStatus({ candidateId: active.id, state: "copied" });
		} catch {
			setCopyStatus({ candidateId: active.id, state: "failed" });
		}
		copyResetTimer.current = setTimeout(() => setCopyStatus(null), 1_800);
	}

	return (
		<div className={css({ display: "flex", minHeight: 0, flexDirection: "column", gap: "0.75rem" })}>
			<div className={css({ display: "flex", flexWrap: "wrap", alignItems: "baseline", justifyContent: "space-between", gap: "0.5rem" })}>
				<div>
					<h2 className={css({ fontSize: "1rem", fontWeight: 750, color: "var(--foreground)" })}>Model results</h2>
					<p className={cx(metaTextClass, css({ marginTop: "0.2rem" }))}>Compare parallel teaching moves against the active transcript turn or artifact.</p>
				</div>
				<div className={metaTextClass}>{relevant.length} result{relevant.length === 1 ? "" : "s"} for this target</div>
			</div>
			<div className={css({ display: "flex", alignItems: "flex-end", gap: "0.5rem" })}>
				<label className={css({ minWidth: 0, flex: 1, fontSize: "0.6875rem", fontWeight: 650, color: "var(--foreground)" })}>
					{activeTask ? `Model pool for ${reviewTaskLabel(activeTask).toLowerCase()}` : "Model pool"}
					<Select aria-label="Candidate model pool" value={poolId} className={cx(inputClass, css({ marginTop: "0.25rem" }))} disabled={compatiblePools.length === 0} onValueChange={(value) => onSelectModelPool(value)}>
						{compatiblePools.length === 0 ? <option value="">No compatible pools</option> : null}
						{compatiblePools.map((pool) => {
							const availability = activeTask ? reviewPoolGenerationAvailability(pool, activeTask, availableModels) : undefined;
							const suffix = !availability?.hasModels
								? " · no models"
								: availability.unavailableModels.length > 0
									? ` · ${availability.unavailableModels.length} unavailable`
									: "";
							return <option key={pool.id} value={pool.id}>{pool.name}{suffix}</option>;
						})}
					</Select>
				</label>
				<button type="button" className={primaryButtonClass} disabled={!canGenerate} onClick={generate}>
					<KeatingIcon icon={isGenerating ? reviewIcon.retry : reviewIcon.pass} size={13} active={isGenerating} className={isGenerating ? css({ animation: "spin 1s linear infinite", _motionReduce: { animation: "none" } }) : undefined} />
					{isGenerating ? "Generating" : "Generate"}
				</button>
			</div>
			<div className={metaTextClass}>
				{!activeTask
					? generationUnavailableReason ?? "Select a tutor response or text-backed artifact to generate candidates."
					: compatiblePools.length === 0
					? `No model pool supports ${reviewTaskLabel(activeTask).toLowerCase()}. Add this task in the model-pool editor.`
					: !selectedAvailability?.hasModels
						? "This compatible pool has no models. Add a model before generating."
						: selectedAvailability.unavailableModels.length > 0
							? `Unavailable in the current model catalog: ${unavailableModelLabel(selectedAvailability.unavailableModels)}. Update this pool before generating.`
						: selectedPool && pricingKnown
					? `Estimated $${estimatedCost.toFixed(estimatedCost < 0.01 ? 4 : 2)} for ${selectedPool.candidateCount} candidate${selectedPool.candidateCount === 1 ? "" : "s"} · stored provider model rates`
					: "Pricing unknown · every stored model rate in this pool is zero"
				}
			</div>
			<p className={css({ borderTop: "1px solid var(--border)", paddingTop: "0.625rem", fontSize: "0.6875rem", lineHeight: 1.45, color: "var(--muted-foreground)" })}>
				Review records stay local. If this pool uses a remote model, generating sends that provider redacted session context and the selected feedback.
			</p>

			<div className={css({ minHeight: 0, borderTop: "1px solid var(--border)", paddingTop: "0.75rem" })}>
				{relevant.length > 0 ? (
					<div className={css({ display: "grid", minHeight: 0, gap: "1rem", md: { gridTemplateColumns: "13rem minmax(0, 1fr)" } })}>
						<div role="radiogroup" aria-label="Generated candidates" className={css({ display: "flex", gap: "0.375rem", overflowX: "auto", paddingBottom: "0.375rem", md: { flexDirection: "column", overflowX: "visible", paddingRight: "1rem", paddingBottom: 0, borderRight: "1px solid var(--border)" } })}>
							{relevant.map((candidate, index) => {
								const chosen = selectedCandidateId === candidate.id || candidate.preferred;
								const selected = active?.id === candidate.id;
								return (
									<button
										key={candidate.id}
										type="button"
										role="radio"
										aria-checked={selected}
										className={css({ display: "inline-flex", minWidth: "8rem", alignItems: "center", gap: "0.5rem", borderRadius: "0.375rem", border: "1px solid", borderColor: selected ? "var(--ink)" : "transparent", background: selected ? "var(--muted)" : "transparent", padding: "0.5rem", textAlign: "left", _hover: { borderColor: "var(--border)", background: "var(--muted)" }, _focusVisible: { outline: "3px solid var(--accent)", outlineOffset: "1px" }, md: { width: "100%" } })}
										onClick={() => onSelectCandidate(candidate.id)}
									>
										<span className={css({ display: "inline-flex", width: "1.25rem", height: "1.25rem", flex: "0 0 auto", alignItems: "center", justifyContent: "center", borderRadius: "9999px", background: chosen ? "var(--accent-green)" : "var(--muted)", fontSize: "0.625rem", fontWeight: 700, color: chosen ? "var(--ink)" : "var(--muted-foreground)" })}>
											{chosen ? <KeatingIcon icon={reviewIcon.accept} size={11} active /> : index + 1}
										</span>
										<span className={css({ minWidth: 0 })}>
											<span className={css({ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.6875rem", fontWeight: 650, color: "var(--foreground)" })}>{candidate.model.name}</span>
											<span className={css({ display: "block", fontSize: "0.625rem", color: candidate.state === "failed" ? "var(--destructive)" : "var(--muted-foreground)" })}>{stateLabel(candidate.state)}</span>
										</span>
									</button>
								);
							})}
						</div>

						{active ? (
							<article className={css({ minWidth: 0 })}>
								<header className={css({ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: "0.625rem", borderBottom: "1px solid var(--border)", paddingBottom: "0.75rem" })}>
									<div className={css({ minWidth: 0 })}>
										<div className={css({ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.875rem", fontWeight: 750, color: "var(--foreground)" })}>{active.model.provider} / {active.model.name}</div>
										<div className={metaTextClass}>{usageLabel(active) ?? stateLabel(active.state)}</div>
									</div>
									<div className={css({ display: "flex", alignItems: "center", gap: "0.375rem" })}>
										<div role="group" aria-label="Candidate view" className={css({ display: "inline-flex", border: "1px solid var(--border)", borderRadius: "0.375rem", padding: "0.125rem" })}>
											{(["rendered", "raw"] as const).map((view) => <button key={view} type="button" aria-pressed={contentView === view} className={css({ borderRadius: "0.25rem", background: contentView === view ? "var(--ink)" : "transparent", padding: "0.25rem 0.45rem", fontSize: "0.625rem", fontWeight: 700, textTransform: "capitalize", color: contentView === view ? "var(--paper, var(--background))" : "var(--muted-foreground)", _focusVisible: { outline: "3px solid var(--accent)", outlineOffset: "1px" } })} onClick={() => setContentView(view)}>{view}</button>)}
										</div>
										<button
											type="button"
											className={compactButtonClass}
											disabled={!active.content?.trim()}
											onClick={() => void copyResponse()}
										>
											<KeatingIcon icon={copyStatus?.candidateId === active.id && copyStatus.state === "copied" ? reviewIcon.accept : copyStatus?.candidateId === active.id && copyStatus.state === "failed" ? reviewIcon.problem : reviewIcon.copy} size={12} active={copyStatus?.candidateId === active.id} />
											<span aria-live="polite">{copyStatus?.candidateId === active.id ? copyStatus.state === "copied" ? "Copied" : "Copy failed" : "Copy response"}</span>
										</button>
										<button type="button" className={compactButtonClass} disabled={!canRegenerate} title={canRegenerate ? undefined : regenerationAvailability?.unavailableModels.length ? `Unavailable model: ${unavailableModelLabel(regenerationAvailability.unavailableModels)}` : "The original pool no longer supports this target or has no models."} onClick={regenerate}>
											<KeatingIcon icon={reviewIcon.retry} size={12} /> Regenerate
										</button>
									</div>
								</header>
								{regenerationAvailability?.unavailableModels.length ? <div className={cx(metaTextClass, css({ marginTop: "0.375rem" }))}>Cannot regenerate. Unavailable in the current model catalog: {unavailableModelLabel(regenerationAvailability.unavailableModels)}.</div> : null}
								{active.error ? <div role="alert" className={css({ marginTop: "0.75rem", border: "1px solid color-mix(in srgb, var(--destructive) 45%, var(--border))", borderRadius: "0.375rem", background: "color-mix(in srgb, var(--destructive) 8%, transparent)", padding: "0.625rem", fontSize: "0.75rem", color: "var(--destructive)" })}>{active.error}</div> : null}
								{active.content ? (
									<div className={css({ marginTop: "1rem", maxWidth: "72ch", overflowWrap: "anywhere", fontSize: "0.875rem", lineHeight: 1.65, color: "var(--foreground)" })}>
										{contentView === "rendered" ? <OpenUIPreview blocks={buildOpenUIPreview(active.content, { sessionId: "candidate", messageId: active.id })} /> : <pre className={css({ overflow: "auto", whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontFamily: "var(--font-mono, ui-monospace, monospace)", fontSize: "0.8125rem", lineHeight: 1.6 })}>{active.content}</pre>}
									</div>
								) : active.state === "running" || active.state === "queued" ? <div className={cx(metaTextClass, css({ marginTop: "0.75rem" }))}>Waiting for model output...</div> : null}
								<div className={css({ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: "0.375rem", borderTop: "1px solid var(--border)", marginTop: "0.75rem", paddingTop: "0.625rem" })}>
									<button type="button" className={compactButtonClass} disabled={active.state !== "completed" || !active.content?.trim()} onClick={() => onChoose(active.id)}>
										<KeatingIcon icon={reviewIcon.accept} size={12} /> Choose
									</button>
									<button type="button" className={primaryButtonClass} disabled={active.state !== "completed" || !active.content?.trim()} onClick={() => onInsert(active.id)}>
										<KeatingIcon icon={reviewIcon.add} size={12} /> Insert
									</button>
								</div>
							</article>
						) : null}
					</div>
				) : (
					<div className={css({ display: "grid", minHeight: "10rem", placeItems: "center", padding: "1rem", textAlign: "center", fontSize: "0.75rem", color: "var(--muted-foreground)" })}>
						Generate parallel teaching moves for the active turn or artifact.
					</div>
				)}
			</div>
		</div>
	);
}
