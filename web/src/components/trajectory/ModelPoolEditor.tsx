import { Select } from "../Select";
import { Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import type { ReviewGenerationTask, ReviewModelPool, StoredModelReference } from "../../keating/trajectory-review";
import { modelFromStoredReference, storedModelReference } from "../../keating/trajectory-review";
import { css, cx } from "../../../styled-system/css";
import { modelCapabilityBadges } from "../../keating/model-capabilities";
import { ModelSelectorDialog } from "../ModelSelector";
import { REVIEW_TASK_OPTIONS } from "./pool-compatibility";
import { compactButtonClass, iconButtonClass, inputClass, metaTextClass, sectionHeadingClass } from "./styles";

export interface ModelPoolEditorProps {
	pools: ReviewModelPool[];
	availableModels: StoredModelReference[];
	activePoolId?: string;
	onSelectPool: (poolId: string) => void;
	onChange: (pool: ReviewModelPool) => void;
	onAddModel: (poolId: string, model: StoredModelReference) => void;
	onRemoveModel: (poolId: string, model: StoredModelReference) => void;
	onCreatePool: () => void;
	onDeletePool: (poolId: string) => void;
}

/** Matches `modelKey` in lib/model-catalog so the dialog can hide what a pool holds. */
function catalogKey(model: StoredModelReference): string {
	return `${model.provider}::${model.api}::${model.id}`;
}

export function ModelPoolEditor({ pools, availableModels, activePoolId, onSelectPool, onChange, onAddModel, onRemoveModel, onCreatePool, onDeletePool }: ModelPoolEditorProps) {
	const [picking, setPicking] = useState(false);
	const pool = pools.find((candidate) => candidate.id === activePoolId) ?? pools[0];
	/** The dialog shows the whole catalog, minus what this pool already holds. */
	const pooledKeys = useMemo(() => (pool ? pool.models.map(catalogKey) : []), [pool]);
	const catalogKeys = useMemo(() => new Set(availableModels.map(catalogKey)), [availableModels]);

	function updateModel(index: number, patch: Partial<StoredModelReference>) {
		if (!pool) return;
		onChange({ ...pool, models: pool.models.map((model, modelIndex) => modelIndex === index ? { ...model, ...patch } : model) });
	}

	function toggleTask(task: ReviewGenerationTask) {
		if (!pool) return;
		const tasks = pool.tasks.includes(task) ? pool.tasks.filter((item) => item !== task) : [...pool.tasks, task];
		onChange({ ...pool, tasks });
	}


	return (
		<div className={css({ display: "flex", flexDirection: "column", gap: "0.875rem" })}>
			<div className={css({ display: "flex", alignItems: "flex-end", gap: "0.5rem" })}>
				<label className={css({ minWidth: 0, flex: 1, fontSize: "0.6875rem", fontWeight: 650, color: "var(--foreground)" })}>
					Pool
					<Select aria-label="Model pool" value={pool?.id ?? ""} className={cx(inputClass, css({ marginTop: "0.25rem" }))} disabled={pools.length === 0} onValueChange={(value) => onSelectPool(value)}>
						{pools.length === 0 ? <option value="">No model pools</option> : null}
						{pools.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
					</Select>
				</label>
				<button type="button" className={compactButtonClass} onClick={onCreatePool}><Plus size={12} aria-hidden="true" /> New</button>
			</div>

			{pool ? (
				<>
					<div className={css({ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "end", gap: "0.5rem" })}>
						<label className={css({ fontSize: "0.6875rem", fontWeight: 650, color: "var(--foreground)" })}>
							Pool name
							<input value={pool.name} className={cx(inputClass, css({ marginTop: "0.25rem" }))} onChange={(event) => onChange({ ...pool, name: event.currentTarget.value })} />
						</label>
						<button type="button" className={iconButtonClass} aria-label={`Delete ${pool.name}`} onClick={() => onDeletePool(pool.id)}><Trash2 size={14} aria-hidden="true" /></button>
					</div>

					<div className={css({ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "0.5rem" })}>
						<label className={css({ fontSize: "0.625rem", fontWeight: 650, color: "var(--muted-foreground)" })}>
							Candidates
							<input type="number" min={1} max={8} step={1} value={pool.candidateCount} className={cx(inputClass, css({ marginTop: "0.25rem", paddingInline: "0.375rem" }))} onChange={(event) => onChange({ ...pool, candidateCount: Number(event.currentTarget.value) })} />
						</label>
						<label className={css({ fontSize: "0.625rem", fontWeight: 650, color: "var(--muted-foreground)" })}>
							Temperature
							<input type="number" min={0} max={2} step={0.1} value={pool.temperature} className={cx(inputClass, css({ marginTop: "0.25rem", paddingInline: "0.375rem" }))} onChange={(event) => onChange({ ...pool, temperature: Number(event.currentTarget.value) })} />
						</label>
						<label className={css({ fontSize: "0.625rem", fontWeight: 650, color: "var(--muted-foreground)" })}>
							Max tokens
							<input type="number" min={64} max={65536} step={64} value={pool.maxTokens} className={cx(inputClass, css({ marginTop: "0.25rem", paddingInline: "0.375rem" }))} onChange={(event) => onChange({ ...pool, maxTokens: Number(event.currentTarget.value) })} />
						</label>
					</div>

					<fieldset className={css({ borderTop: "1px solid var(--border)", paddingTop: "0.75rem" })}>
						<legend className={sectionHeadingClass}>Generation tasks</legend>
						<div className={css({ display: "flex", flexWrap: "wrap", gap: "0.25rem", paddingTop: "0.5rem" })}>
							{REVIEW_TASK_OPTIONS.map((task) => (
								<label key={task.value} className={css({ cursor: "pointer", borderRadius: "9999px", border: "1px solid", borderColor: pool.tasks.includes(task.value) ? "var(--ink)" : "var(--border)", background: pool.tasks.includes(task.value) ? "var(--ink)" : "var(--background)", padding: "0.25rem 0.5rem", fontSize: "0.625rem", fontWeight: 650, color: pool.tasks.includes(task.value) ? "var(--paper)" : "var(--foreground)", _focusWithin: { outline: "3px solid var(--accent)", outlineOffset: "1px" } })}>
									<input type="checkbox" checked={pool.tasks.includes(task.value)} className={css({ position: "absolute", opacity: 0, pointerEvents: "none" })} onChange={() => toggleTask(task.value)} />
									{task.label}
								</label>
							))}
						</div>
					</fieldset>

					<section className={css({ borderTop: "1px solid var(--border)", paddingTop: "0.75rem" })} aria-labelledby="trajectory-pool-models-heading">
						<div className={css({ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "0.5rem" })}>
							<div id="trajectory-pool-models-heading" className={sectionHeadingClass}>Models</div>
							<div className={metaTextClass}>{pool.models.length} configured</div>
						</div>
						<div className={css({ display: "flex", flexDirection: "column", gap: "0.625rem", paddingTop: "0.5rem" })}>
							{pool.models.map((model, index) => {
								const badges = modelCapabilityBadges(modelFromStoredReference(model));
								const stale = !catalogKeys.has(catalogKey(model));
								return (
								<div key={`${model.provider}:${model.id}:${index}`} className={css({ borderBottom: "1px solid var(--border)", paddingBottom: "0.625rem" })}>
									<div className={css({ display: "flex", alignItems: "flex-start", gap: "0.5rem" })}>
										<div className={css({ minWidth: 0, flex: 1 })}>
											<div className={css({ fontSize: "0.8125rem", fontWeight: 700, lineHeight: 1.25, overflowWrap: "anywhere" })}>{model.name}</div>
											<div className={css({ marginTop: "0.125rem", fontSize: "0.6875rem", color: "var(--muted-foreground)", overflowWrap: "anywhere" })}>
												Provider: {model.provider}{model.name === model.id ? "" : ` · ${model.id}`}
											</div>
										</div>
										<button type="button" className={cx(iconButtonClass, css({ width: "2rem", height: "2rem", flexShrink: 0 }))} aria-label={`Remove ${model.name}`} onClick={() => onRemoveModel(pool.id, model)}><Trash2 size={13} aria-hidden="true" /></button>
									</div>
									{badges.length > 0 || stale ? (
										<div className={css({ display: "flex", flexWrap: "wrap", gap: "0.25rem", marginTop: "0.375rem" })}>
											{stale ? (
												<span className={css({ borderRadius: "9999px", background: "color-mix(in srgb, var(--destructive) 15%, transparent)", padding: "0.125rem 0.5rem", fontSize: "0.625rem", fontWeight: 600, color: "var(--destructive)" })}>Not in catalog</span>
											) : null}
											{badges.map((badge) => (
												<span key={badge} className={css({ borderRadius: "9999px", background: "var(--muted)", padding: "0.125rem 0.5rem", fontSize: "0.625rem", fontWeight: 600, color: "var(--muted-foreground)" })}>{badge}</span>
											))}
										</div>
									) : null}
									<label className={css({ display: "block", marginTop: "0.375rem", fontSize: "0.625rem", color: "var(--muted-foreground)" })}>Pool display name<input value={model.name} className={cx(inputClass, css({ marginTop: "0.2rem", minHeight: "2rem", paddingInline: "0.375rem" }))} onChange={(event) => updateModel(index, { name: event.currentTarget.value })} /></label>
									<div className={cx(metaTextClass, css({ marginTop: "0.375rem" }))}>{model.contextWindow.toLocaleString()} context · {model.maxTokens.toLocaleString()} max output</div>
								</div>
								);
							})}
							{pool.models.length === 0 ? <div className={css({ paddingBlock: "0.75rem", textAlign: "center", fontSize: "0.75rem", color: "var(--muted-foreground)" })}>Add at least one named model before generating candidates.</div> : null}
							<div className={css({ borderTop: "1px solid var(--border)", paddingTop: "0.625rem" })}>
								<button type="button" className={cx(compactButtonClass, css({ width: "100%", justifyContent: "center" }))} onClick={() => setPicking(true)}>
									<Plus size={12} aria-hidden="true" /> Add model
								</button>
							</div>
							<div className={metaTextClass}>Picks come from the same catalog as chat, so hidden providers and custom models agree across both.</div>
						</div>
					</section>
				</>
			) : (
				<div className={css({ display: "grid", minHeight: "10rem", placeItems: "center", padding: "1rem", textAlign: "center", fontSize: "0.75rem", color: "var(--muted-foreground)" })}>Create a pool to group the models used for parallel review candidates.</div>
			)}

			{/* The same picker chat uses, so a pool sees one catalog with one set of
			    provider and capability filters. Adding a browser model here only
			    records it; the download happens when the pool actually runs. */}
			<ModelSelectorDialog
				open={picking && Boolean(pool)}
				currentModel={null}
				title="Add a model to this pool"
				description={pool ? `Candidates for “${pool.name}” are generated once per model in the pool.` : ""}
				actionLabel="Add to pool"
				excludeKeys={pooledKeys}
				preloadBrowserModel={false}
				onClose={() => setPicking(false)}
				onSelect={(model) => {
					if (pool) onAddModel(pool.id, storedModelReference(model));
					setPicking(false);
				}}
			/>
		</div>
	);
}
