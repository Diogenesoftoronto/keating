import { KeatingBot } from "../components/KeatingBot";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { usePostHog } from "@posthog/react";
import { ArrowLeft, Download, Upload, ChevronRight } from "lucide-react";
import { getModel, getSupportedThinkingLevels, type ModelThinkingLevel, type Api, type Model } from "@earendil-works/pi-ai/compat";
import { getInitPromise } from "../hooks/keating-storage";
import { buildWebFineTuneExportFromSources, loadWebExportSources, type WebFineTuneExportResult, type WebExportSource, type WebFineTuneFormat } from "../keating/export";
import { importFineTuneFiles, type WebFineTuneImportResult } from "../keating/import";
import { buildWebTrainingArchive } from "../keating/training-archive";
import type { CanonicalTrainingRecord } from "../keating/training-schema";
import { downloadFile, downloadTextFile } from "../lib/browser-download";
import { ModelSelectorDialog } from "../components/ModelSelector";
import { Nav } from "../components/Nav";
import { useSeo } from "../hooks/useSeo";
import { createResumableExportJudge, type JudgeProgress, type JudgeCheckpoint, type JudgeScorerConfig } from "../keating/export-judge";
import { loadTrainingExportJob, saveTrainingExportJob, trainingScoreCache, type TrainingExportJob } from "../keating/training-export-jobs";
import type { JudgeScore } from "../keating/reward";
import { TrainingDatasetShare } from "../components/training/TrainingDatasetShare";
import { TrainingDatasetSummary } from "../components/training/TrainingDatasetSummary";
import "./training-data.css";
import "../components/keating-interaction-motion.css";
const formatNumber = (value: number) => new Intl.NumberFormat().format(value);
function TrainingWorkspace() {
	const posthog = usePostHog();
	const [settingsTab, setSettingsTab] = useState("data");
	const [progress, setProgress] = useState<JudgeProgress | null>(null);
	const [restored, setRestored] = useState(false);
	const [loadingJob, setLoadingJob] = useState(true);
	const jobRef = useRef<TrainingExportJob | null>(null);
	const abortRef = useRef<AbortController | null>(null);
	const [scorerSettings, setScorerSettings] = useState({ maxTokens: 4096, temperature: 0, timeoutMs: 60000, retries: 1 });
	const [fallbackEnabled, setFallbackEnabled] = useState(false);
	const [fallbackConfig, setFallbackConfig] = useState<JudgeScorerConfig>(() => ({ model: getModel("google", "gemini-2.5-flash") as Model<Api>, thinkingLevel: "minimal", maxTokens: 4096, temperature: 0, timeoutMs: 60000, retries: 1 }));
	const [fallbackPickerOpen, setFallbackPickerOpen] = useState(false);

	const [bundle, setBundle] = useState<WebFineTuneExportResult | null>(null);
	const [maxAssistantChars, setMaxAssistantChars] = useState(0);
	const [maxRecords, setMaxRecords] = useState(0);
	const [validationPercent, setValidationPercent] = useState(10);
	const [deduplicate, setDeduplicate] = useState(true);
	const [keepAllResponses, setKeepAllResponses] = useState(false);
	const [judgeThinkingLevel, setJudgeThinkingLevel] = useState<ModelThinkingLevel>("minimal");
	const [scoreAll, setScoreAll] = useState(false);
	const [maxJudgeExamples, setMaxJudgeExamples] = useState(50);
	const [format, setFormat] = useState<WebFineTuneFormat>("both");
	const [source, setSource] = useState<WebExportSource>("all");
	const [redact, setRedact] = useState(true);
	const [minAssistantChars, setMinAssistantChars] = useState(200);
	const [judgeScoring, setJudgeScoring] = useState(false);
	const [judgeModel, setJudgeModel] = useState<Model<Api>>(() => getModel("google", "gemini-3-flash-preview") as Model<Api>);
	const [judgePickerOpen, setJudgePickerOpen] = useState(false);
	const [exportWarnings, setExportWarnings] = useState<string[]>([]);
	const [exporting, setExporting] = useState(false);
	const [result, setResult] = useState<{ examples: number; records: number; skipped: number; redactions: number; scored?: number; unscored?: number } | null>(null);
	const [importResult, setImportResult] = useState<WebFineTuneImportResult | null>(null);
	const [error, setError] = useState("");

	useEffect(() => {
		let alive = true;
		void loadTrainingExportJob().then(job => {
			if (!alive || !job) return;
			jobRef.current = job; setBundle(job.bundle); setRestored(true);
			const o = job.options;
			setSource(o.source); setFormat(o.format); setRedact(o.redact); setMinAssistantChars(o.minAssistantChars);
			setMaxAssistantChars(o.maxAssistantChars ?? 0); setMaxRecords(o.maxRecords ?? 0); setValidationPercent(o.validationPercent ?? 10);
			setDeduplicate(o.deduplicate ?? false); setKeepAllResponses(o.keepAllResponses ?? false);
			setJudgeScoring(job.scoring); setJudgeModel(job.primary.model); setJudgeThinkingLevel(job.primary.thinkingLevel);
			setScorerSettings(job.primary); setFallbackEnabled(Boolean(job.fallback)); if (job.fallback) setFallbackConfig(job.fallback);
			setScoreAll(job.maxExamples === null); setMaxJudgeExamples(job.maxExamples ?? 50);
		}).catch(() => { if (alive) setError("Could not open local checkpoints. Check browser storage before starting a scoring run."); })
		.finally(() => { if (alive) setLoadingJob(false); });
		return () => { alive = false; abortRef.current?.abort(); };
	}, []);

	const handleExport = async (refreshSources = false) => {
		if (exporting || loadingJob) return;
		setExporting(true); setError(""); setExportWarnings([]); setProgress(null); setRestored(false);
		const controller = new AbortController(); abortRef.current = controller;
		let partialQueue = Promise.resolve();
		try {
			await getInitPromise();
			const sources = !refreshSources && jobRef.current ? jobRef.current.sources : await loadWebExportSources();
			const options = { source, format, redact, minAssistantChars, maxAssistantChars: maxAssistantChars || undefined, maxRecords: maxRecords || undefined, validationPercent, deduplicate, keepAllResponses };
			const primary = { ...scorerSettings, model: judgeModel, thinkingLevel: judgeThinkingLevel };
			const base = await buildWebFineTuneExportFromSources(sources, options);
			const job: TrainingExportJob = { version: 1, sources, options, primary, fallback: fallbackEnabled ? fallbackConfig : undefined, maxExamples: scoreAll ? null : maxJudgeExamples, scoring: judgeScoring, bundle: base, updatedAt: Date.now() };
			setBundle(base); jobRef.current = job;
			await saveTrainingExportJob(job);
			const provenance = new Map<string, JudgeCheckpoint>();
			const enrich = (next: WebFineTuneExportResult) => {
				const manifest = JSON.parse(next.manifestJson);
				manifest.scoringCheckpoints = [...provenance].map(([key, value]) => ({ key, ...value }));
				manifest.scorerSettings = { primary: { ...scorerSettings, provider: judgeModel.provider, model: judgeModel.id, thinkingLevel: judgeThinkingLevel }, fallback: fallbackEnabled ? { ...fallbackConfig, model: { provider: fallbackConfig.model.provider, id: fallbackConfig.model.id } } : null };
				return { ...next, manifestJson: JSON.stringify(manifest, null, 2) };
			};
			const scoringOptions = { ...options, judgeModel: { provider: judgeModel.provider, id: judgeModel.id }, judgeThinkingLevel };
			let latestPartial: Array<JudgeScore | null> | null = null;
			let lastPartialAt = 0;
			const persist = async (next: WebFineTuneExportResult) => { job.bundle = next; job.updatedAt = Date.now(); setBundle(next); await saveTrainingExportJob(job); };
			const queuePartial = (scores: Array<JudgeScore | null>) => {
				latestPartial = [...scores];
				if (Date.now() - lastPartialAt < 1000) return;
				lastPartialAt = Date.now();
				const copy = latestPartial;
				partialQueue = partialQueue.then(async () => persist(enrich(await buildWebFineTuneExportFromSources(sources, { ...scoringOptions, judge: async () => copy }))));
				void partialQueue.catch(() => controller.abort());
			};
			const judge = judgeScoring ? createResumableExportJudge({
				primary, fallback: fallbackEnabled ? fallbackConfig : undefined,
				maxExamples: scoreAll ? Number.POSITIVE_INFINITY : maxJudgeExamples,
				cache: trainingScoreCache, signal: controller.signal, onProgress: setProgress,
				onCheckpoint: (key, checkpoint) => provenance.set(key, checkpoint), onPartial: queuePartial,
			}) : undefined;
			const prepared = judge ? enrich(await buildWebFineTuneExportFromSources(sources, { ...scoringOptions, judge })) : base;
			await partialQueue;
			await persist(prepared);
			setExportWarnings(JSON.parse(prepared.manifestJson).warnings ?? []);
			posthog?.capture("training_data_exported", { success: true, outcome: "prepared", record_count: prepared.recordCount, judge_scoring: judgeScoring });
		} catch (err) {
			await partialQueue.catch(() => undefined);
			setError(`Preparation stopped. Saved scores can be reused on retry. ${err instanceof Error ? err.message : String(err)}`);
		} finally { setExporting(false); abortRef.current = null; }
	};

	const handleImport = async (fileList: FileList | null) => {
		const files = Array.from(fileList ?? []);
		if (!files.length) return;
		setExporting(true);
		setError("");
		setImportResult(null);
		try {
			await getInitPromise();
			const imported = await importFineTuneFiles(await Promise.all(files.map(async (file) => ({
				name: file.name,
				text: await file.text(),
			}))));
			if (imported.examplesImported === 0) {
				setError("No importable fine-tune examples were found. Choose ChatML or Alpaca JSONL files.");
			}
			if (imported.examplesImported > 0) jobRef.current = null;
			setBundle(null);
			posthog?.capture("training_data_imported", {
				success: imported.examplesImported > 0,
				file_count: files.length,
				example_count: imported.examplesImported,
				session_count: imported.sessionsImported,
				skipped_count: imported.skipped,
			});
			setImportResult(imported);
		} catch (err) {
			posthog?.capture("training_data_imported", {
				success: false,
				file_count: files.length,
				failure_type: err instanceof Error ? err.name : "unknown",
			});
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setExporting(false);
		}
	};



	const records = useMemo(() => bundle?.canonicalJsonl?.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line) as CanonicalTrainingRecord) ?? [], [bundle?.canonicalJsonl]);
	const packaging = useMemo(() => { try { return { archive: bundle ? buildWebTrainingArchive(bundle) : null, error: "" }; } catch { return { archive: null, error: "ZIP packaging failed. Your dataset and scores are safe; download JSONL below or retry packaging." }; } }, [bundle]);
	const archive = packaging.archive;
	const datasetSessions = useMemo(() => {
		const groups = new Map<string, { id: string; title: string; count: number }>();
		for (const record of records) { const id = record.source.sessionId; if (!id) continue; const group = groups.get(id) ?? { id, title: record.source.sessionTitle ?? "Untitled session", count: 0 }; group.count++; groups.set(id, group); }
		return [...groups.values()].sort((a, b) => b.count - a.count);
	}, [records]);
	const sourceCounts = useMemo(() => records.reduce<Record<string, number>>((counts, record) => { counts[record.source.type] = (counts[record.source.type] ?? 0) + 1; return counts; }, {}), [records]);
	const manifest = bundle ? JSON.parse(bundle.manifestJson) : null;
	const preparationComplete = Boolean(bundle && !exporting && !loadingJob && !error && !packaging.error && !progress?.paused && (!progress || (progress.completed === progress.total && progress.failed === 0)));
	const [celebrating, setCelebrating] = useState(false);
	useEffect(() => {
		setCelebrating(preparationComplete);
		if (!preparationComplete) return;
		const timer = window.setTimeout(() => setCelebrating(false), 2400);
		return () => window.clearTimeout(timer);
	}, [preparationComplete]);
	return <div className="training-workspace">
		<div className="training-run-status" aria-live="polite"><KeatingBot state={exporting || loadingJob ? "thinking" : preparationComplete ? "success" : "idle"} size={40} animated={exporting || loadingJob || celebrating} label="" />{loadingJob ? "Loading saved preparation…" : restored ? "Restored your saved dataset. Resume reuses completed scores." : "Dataset and scores are checkpointed in this browser."}{progress && <span>{progress.completed}/{progress.total} checked · {progress.scored} scored · {progress.cached} reused · {progress.fallbackScored} fallback · {progress.failed} failed{progress.paused ? " · Paused" : ""}</span>}{exporting && <button type="button" className="training-secondary" onClick={() => abortRef.current?.abort()}>Pause scoring</button>}</div>
		<div className="training-columns">
		<form className="training-config" onSubmit={(event) => { event.preventDefault(); void handleExport(); }}>
		<div className="training-tabs" role="tablist" aria-label="Dataset settings">{["data", "scorers", "readme", "import"].map(tab => <button type="button" role="tab" aria-selected={settingsTab === tab} key={tab} onClick={() => setSettingsTab(tab)}>{tab === "data" ? "Data" : tab === "scorers" ? "Scorers" : tab === "readme" ? "README" : "Import"}</button>)}</div>
		<fieldset hidden={settingsTab !== "data"} disabled={exporting || loadingJob}>
		<legend>Choose your data</legend>
		<p>Build from sessions, teaching artifacts, or sandbox work saved in this browser.</p>
		<div className="training-fields">
		<label>Source<select value={source} onChange={e => setSource(e.target.value as WebExportSource)}><option value="all">All sources</option><option value="sessions">Conversations</option><option value="artifacts">Teaching artifacts</option><option value="sandbox">Sandbox work</option></select></label>
		<label>Training format<select value={format} onChange={e => setFormat(e.target.value as WebFineTuneFormat)}><option value="both">ChatML + Alpaca</option><option value="chatml">ChatML · conversations</option><option value="alpaca">Alpaca · instruction pairs</option></select></label>
		</div>
		</fieldset>
		<fieldset hidden={settingsTab !== "data"} disabled={exporting || loadingJob}>
		<legend>Shape the dataset</legend>
		<div className="training-presets" role="group" aria-label="Retention preset"><button type="button" aria-pressed={!keepAllResponses} onClick={() => { setKeepAllResponses(false); setMinAssistantChars(200); setDeduplicate(true); }}>Filter for training</button><button type="button" aria-pressed={keepAllResponses} onClick={() => { setKeepAllResponses(true); setSource("all"); setMinAssistantChars(1); setMaxAssistantChars(0); setMaxRecords(0); setDeduplicate(false); }}>Keep everything</button></div>
		{keepAllResponses && <p>Retain short, duplicate, low-scoring, and error responses. Include a source snapshot with original message types and metadata. Secret redaction remains your choice below.</p>}
		<p>Lengths are in characters. Records outside the range are excluded, not truncated.</p>
		<div className="training-fields">
		<label>Minimum response<input disabled={keepAllResponses} type="number" min="1" max={maxAssistantChars || undefined} required value={minAssistantChars} onChange={e => setMinAssistantChars(Math.max(1, Number(e.target.value)))} /></label>
		<label>Maximum response<input disabled={keepAllResponses} type="number" min="0" value={maxAssistantChars} onChange={e => setMaxAssistantChars(Math.max(0, Number(e.target.value)))} /><small>0 means no maximum</small></label>
		<label>Record limit<input disabled={keepAllResponses} type="number" min="0" value={maxRecords} onChange={e => setMaxRecords(Math.max(0, Number(e.target.value)))} /><small>0 includes all matching records; limits follow source order</small></label>
		<label>Validation share (%)<input type="number" min="0" max="50" value={validationPercent} onChange={e => setValidationPercent(Math.min(50, Math.max(0, Number(e.target.value))))} /><small>Labels canonical records by source group. Actual share varies.</small></label>
		</div>
		<label className="training-check"><input disabled={keepAllResponses} type="checkbox" checked={deduplicate} onChange={e => setDeduplicate(e.target.checked)} /><span>Remove duplicate examples<small>Keep one copy of repeated training content.</small></span></label>
		<label className="training-check"><input type="checkbox" checked={redact} onChange={e => setRedact(e.target.checked)} /><span>Redact detected secrets<small>Remove recognized credentials and email addresses. Inspect source data in Review before sharing.</small></span></label>
		</fieldset>
		<fieldset hidden={settingsTab !== "scorers"} disabled={exporting || loadingJob}>
		<legend>Optional scoring</legend>
		<label className="training-check"><input type="checkbox" checked={judgeScoring} onChange={e => setJudgeScoring(e.target.checked)} /><span>Add model judge scores<small>Sends eligible responses to your selected provider and uses API credits.</small></span></label>
		{judgeScoring && <div className="training-judge">
		<button type="button" className="training-secondary" onClick={() => setJudgePickerOpen(true)}>{judgeModel.name} · {judgeModel.provider}<ChevronRight size={16}/></button>
		<label>Thinking level<select value={judgeThinkingLevel} onChange={e => setJudgeThinkingLevel(e.target.value as ModelThinkingLevel)}>{getSupportedThinkingLevels(judgeModel).map(level => <option key={level} value={level}>{level === "off" ? "Off" : level.charAt(0).toUpperCase() + level.slice(1)}</option>)}</select><small>Available levels depend on the model. More thinking can take longer and cost more.</small></label>
		<label>Scoring scope<select value={scoreAll ? "all" : "limited"} onChange={e => setScoreAll(e.target.value === "all")}><option value="limited">Limit the number of responses</option><option value="all">Score all eligible responses</option></select></label>
		{!scoreAll && <label>Maximum responses to score<input type="number" min="1" value={maxJudgeExamples} onChange={e => setMaxJudgeExamples(Math.max(1, Number(e.target.value)))} /></label>}
		{scoreAll && <p>Every eligible conversation response in this dataset will be sent for scoring. There is no request cap; time and provider charges scale with the dataset.</p>}
		<ScorerSettings value={scorerSettings} onChange={patch => setScorerSettings(previous => ({ ...previous, ...patch }))}/>
		<label className="training-check"><input type="checkbox" checked={fallbackEnabled} onChange={e => setFallbackEnabled(e.target.checked)}/><span>Use a fallback scorer<small>Try this scorer after primary retries fail.</small></span></label>
		{fallbackEnabled && <section className="training-fallback"><h3>Fallback scorer</h3><button type="button" className="training-secondary" onClick={() => setFallbackPickerOpen(true)}>{fallbackConfig.model.name} · {fallbackConfig.model.provider}<ChevronRight size={16}/></button><label>Thinking level<select value={fallbackConfig.thinkingLevel} onChange={e => setFallbackConfig(previous => ({ ...previous, thinkingLevel: e.target.value as ModelThinkingLevel }))}>{getSupportedThinkingLevels(fallbackConfig.model).map(level => <option key={level}>{level}</option>)}</select></label><ScorerSettings value={fallbackConfig} onChange={patch => setFallbackConfig(previous => ({ ...previous, ...patch }))}/><p>Missing responses may be sent to {fallbackConfig.model.provider}. Completed primary or fallback scores are reused on resume.</p></section>}
		<p>Scores estimate teaching behavior. They do not establish learning gains.</p>
		</div>}
		</fieldset>
				<section className="training-import" hidden={settingsTab !== "import"}><div><h2>Bring existing data in</h2><p>Import ChatML or Alpaca JSONL as local sessions, then prepare them with the same controls.</p><p aria-live="polite">{importResult && `${importResult.examplesImported} examples imported into ${importResult.sessionsImported} sessions · ${importResult.skipped} skipped`}</p></div><label className="training-secondary"><Upload size={16}/>Choose JSONL files<input className="training-file-input" type="file" accept=".jsonl,application/jsonl,application/x-ndjson" multiple disabled={exporting} onChange={e => { void handleImport(e.target.files); e.target.value = ""; }}/></label></section>
		<div hidden={settingsTab !== "readme"}>		{bundle && <TrainingDatasetSummary bundle={bundle} model={judgeModel} thinkingLevel={judgeThinkingLevel} disabled={exporting} onChange={readmeSummary => {
			setBundle(previous => previous ? { ...previous, readmeSummary } : previous);
			if (jobRef.current) { jobRef.current.bundle = { ...jobRef.current.bundle, readmeSummary }; void saveTrainingExportJob(jobRef.current).catch(() => setError("The summary is in this session, but could not be checkpointed.")); }
		}}/>}{!bundle && <p className="training-note">Prepare a dataset to add an optional summary to its README.</p>}</div>
		<div className="training-prepare-actions">
		<button className="training-primary" disabled={exporting || loadingJob} type="submit">{exporting ? "Preparing dataset…" : judgeScoring ? "Score / resume missing" : "Prepare dataset"}<ChevronRight size={16}/></button>
		<button type="button" className="training-secondary" disabled={exporting || loadingJob} onClick={() => void handleExport(true)}>Refresh source data</button>
		</div>
		<p className="training-note">{judgeScoring ? scoreAll ? `All eligible responses will be scored using ${judgeModel.provider}.` : `Up to ${maxJudgeExamples} responses will be scored using ${judgeModel.provider}.` : "Preparation runs locally. No model calls while scoring is off."}</p>

		</form>
		<section className="training-review" aria-label="Dataset overview" aria-busy={exporting}>
		<header><h2>Dataset overview</h2><p>{bundle ? `Prepared snapshot · ${manifest.source} · ${manifest.redactionEnabled ? "redaction on" : "unredacted"}. Controls apply on the next preparation.` : "Prepare, score, and export the complete dataset."}</p></header>
		{!bundle && <div className="training-empty"><KeatingBot variant="body" state={exporting || loadingJob ? "thinking" : "idle"} size={136} label="" /><h3>{exporting ? "Preparing your records" : "Your dataset starts here"}</h3><p>{exporting ? "Filtering data and assembling training files. Scoring can take longer." : "Choose your sources and filters, then prepare a dataset to see dataset composition, quality counts, and included files."}</p></div>}
		{bundle && <>
		<dl className="training-counts"><div><dt>Records</dt><dd>{formatNumber(bundle.recordCount)}</dd></div><div><dt>SFT examples</dt><dd>{formatNumber(bundle.exampleCount)}</dd></div><div><dt>Validation</dt><dd>{manifest.counts.validationRecords}</dd></div></dl>
		<div className="training-quality"><h3>Quality breakdown</h3><p>{Object.entries(manifest.quality).map(([key, value]) => `${value} ${key}`).join(" · ")}</p><p>{bundle.skippedCount} skipped · {bundle.redactionCount} redactions · {manifest.counts.duplicatesRemoved} duplicates removed</p></div>
		<div className="training-composition"><h3>Dataset composition</h3><dl>{Object.entries(sourceCounts).map(([source, count]) => <div key={source}><dt>{source === "session" ? "Conversation responses" : source === "artifact" ? "Teaching artifacts" : "Sandbox records"}</dt><dd>{formatNumber(count)}</dd></div>)}</dl></div>
		<details className="training-session-list"><summary>Source sessions · {datasetSessions.length}</summary><p>Open Review for detailed annotations, summaries, and response-level work.</p>{datasetSessions.length ? <ul>{datasetSessions.map(session => <li key={session.id}><span>{session.title}<small>{session.count} records</small></span><Link to="/review/sessions/$sessionId" params={{ sessionId: session.id }} target="_blank" rel="noopener noreferrer">Open in Review ↗</Link></li>)}</ul> : <p>No source sessions in this dataset.</p>}</details>
		<details className="training-files"><summary>Included files & quality notes</summary><ul>{(archive?.files ?? []).map(file => <li key={file.path}><strong>{file.path}</strong> — {file.purpose}</li>)}</ul><p>Canonical records preserve provenance, quality flags, and train/validation labels. Compatibility files combine both partitions: split from canonical records before training and evaluation. Review unscored data before use.</p></details>
		<div className="training-downloads"><button className="training-primary" onClick={() => { try { const ready = archive ?? buildWebTrainingArchive(bundle); downloadFile(ready.filename, ready.bytes, "application/zip"); } catch { setError("ZIP download failed. Use the JSONL download or try again; no rescoring is required."); } }}><Download size={16}/>Download current ZIP</button><button className="training-secondary" onClick={() => downloadTextFile("keating.training.jsonl", bundle.canonicalJsonl ?? "", "application/x-ndjson")}>Records JSONL</button>{bundle.sourceDataJson && <button className="training-secondary" onClick={() => downloadTextFile("source-snapshot.json", bundle.sourceDataJson!, "application/json")}>Source snapshot</button>}</div>{packaging.error && <p role="alert">{packaging.error}</p>}{!exporting && <TrainingDatasetShare key={manifest.generatedAt} archive={archive} recordCount={bundle.recordCount} redacted={manifest.redactionEnabled}/> }
		</>}
		<div aria-live="polite">{result && !bundle && <p>{result.records} records · {result.skipped} skipped</p>}{exportWarnings.map(warning => <p className="training-warning" key={warning}>{warning}</p>)}{error && <p role="alert" className="training-warning">{error}</p>}</div>
		</section>
		</div>

		<ModelSelectorDialog open={fallbackPickerOpen} currentModel={fallbackConfig.model} onClose={() => setFallbackPickerOpen(false)} onSelect={model => { const levels = getSupportedThinkingLevels(model); setFallbackConfig(previous => ({ ...previous, model, thinkingLevel: levels.includes(previous.thinkingLevel) ? previous.thinkingLevel : levels[0] ?? "off" })); setFallbackPickerOpen(false); }} title="Fallback scorer" description="Used only when primary scoring fails. Responses may be sent to this provider." actionLabel="Use as fallback" preloadBrowserModel={false}/>
		<ModelSelectorDialog open={judgePickerOpen} currentModel={judgeModel} onClose={() => setJudgePickerOpen(false)} onSelect={model => { setJudgeModel(model); const levels = getSupportedThinkingLevels(model); if (!levels.includes(judgeThinkingLevel)) setJudgeThinkingLevel(levels.includes("minimal") ? "minimal" : levels[0] ?? "off"); setJudgePickerOpen(false); }} title="Select judge model" description="Choose the provider that scores exported responses. Provider usage may incur charges." actionLabel="Use as judge" preloadBrowserModel={false}/>
	</div>;
}
function ScorerSettings({ value, onChange }: { value: { maxTokens: number; temperature: number; timeoutMs: number; retries: number }; onChange: (patch: Partial<JudgeScorerConfig>) => void }) {
	return <details className="training-scorer-details"><summary>Request settings</summary><div className="training-fields"><label>Output token budget<input type="number" min="128" max="65536" value={value.maxTokens} onChange={e => onChange({ maxTokens: Math.min(65536, Math.max(128, Number(e.target.value))) })}/></label><label>Temperature<input type="number" min="0" max="2" step="0.1" value={value.temperature} onChange={e => onChange({ temperature: Math.min(2, Math.max(0, Number(e.target.value))) })}/></label><label>Timeout (seconds)<input type="number" min="5" max="600" value={value.timeoutMs / 1000} onChange={e => onChange({ timeoutMs: Math.min(600, Math.max(5, Number(e.target.value))) * 1000 })}/></label><label>Retries per response<input type="number" min="0" max="3" value={value.retries} onChange={e => onChange({ retries: Math.min(3, Math.max(0, Number(e.target.value))) })}/></label></div><p>Retries may incur additional usage. Changing model, thinking, temperature, or token budget starts a new score cache; changing retry limits, timeouts, or fallback keeps successful scores.</p></details>;
}
function BookPreview() { return <Download size={28} aria-hidden="true"/>; }
export function TrainingData() {
	useSeo({ title: "Training data — Keating", description: "Prepare, inspect, import, and export training datasets from your Keating work.", canonical: "https://keating.help/training-data" });
	return <div className="retro-layout retro-page training-page"><Nav/><main><Link className="training-back" to="/usage"><ArrowLeft size={14}/>Usage</Link><header className="training-heading"><h1>Training data</h1><p>Turn your teaching work into a dataset you can inspect and use.</p></header><TrainingWorkspace/></main></div>;
}
