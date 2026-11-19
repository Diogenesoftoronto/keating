import { KeatingBot } from "../components/KeatingBot";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { usePostHog } from "@posthog/react";
import { AppBar, Button, Chip, DefinitionList, EmptyState, Loading, Segmented, Sheet } from "../design-system/kit";
import { KeatingGlyph } from "../design-system/glyphs";
import { animate } from "motion";
import { DURATION, EASE, useMotionAllowed } from "../design-system/motion";
import { ExportSheet } from "../components/export/ExportSheet";
import { Progress } from "../design-system/charts";
import { DatasetFigures } from "../components/training/DatasetFigures";

import { getModel, getSupportedThinkingLevels, type ModelThinkingLevel, type Api, type Model } from "@earendil-works/pi-ai/compat";
import { getInitPromise } from "../hooks/keating-storage";
import { buildWebFineTuneExportFromSources, loadWebExportSources, type WebFineTuneExportResult, type WebExportSource, type WebFineTuneFormat } from "../keating/export";
import { importFineTuneFiles, type WebFineTuneImportResult } from "../keating/import";
import { buildWebTrainingArchive } from "../keating/training-archive";
import type { CanonicalTrainingRecord } from "../keating/training-schema";
import { downloadFile, downloadTextFile } from "../lib/browser-download";
import { ModelSelectorDialog } from "../components/ModelSelector";
import { useSeo } from "../hooks/useSeo";
import { createRuntimeExportJudge, type JudgeProgress, type JudgeCheckpoint, type JudgeScorerConfig } from "../keating/export-judge";
import { createWebJudgementRuntime } from "../keating/judgement/runtime";
import { loadJudgementModelSettings, subscribeJudgementModelSettings } from "../keating/judgement-model";
import { loadTrainingExportJob, saveTrainingExportJob, trainingScoreCache, type TrainingExportJob } from "../keating/training-export-jobs";
import type { JudgeScore } from "../keating/reward";
import { TrainingDatasetShare } from "../components/training/TrainingDatasetShare";
import { TrainingDatasetSummary } from "../components/training/TrainingDatasetSummary";
import "./training-data.css";
import "../components/keating-interaction-motion.css";

function TrainingWorkspace() {
	const posthog = usePostHog();
	const [step, setStep] = useState("shape");
	const panelRef = useRef<HTMLFormElement>(null);
	const allowed = useMotionAllowed();
	useEffect(() => {
		if (!allowed || !panelRef.current) return;
		const animation = animate(panelRef.current, { opacity: [0.65, 1] }, { duration: DURATION.quick, ease: EASE });
		return () => { animation.cancel(); };
	}, [step, allowed]);
	const [importOpen, setImportOpen] = useState(false);
	const [shareOpen, setShareOpen] = useState(false);
	const shareRef = useRef<HTMLDivElement>(null);
	const [progress, setProgress] = useState<JudgeProgress | null>(null);
	const [restored, setRestored] = useState(false);
	const [loadingJob, setLoadingJob] = useState(true);
	const jobRef = useRef<TrainingExportJob | null>(null);
	const abortRef = useRef<AbortController | null>(null);
	const [scorerSettings, setScorerSettings] = useState({ maxTokens: 4096, temperature: 0, timeoutMs: 60000, retries: 1 });
	const [judgementSettings, setJudgementSettings] = useState(loadJudgementModelSettings);
	useEffect(() => subscribeJudgementModelSettings(setJudgementSettings), []);

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
			setJudgeScoring(job.scoring);
			setScorerSettings(previous => ({ ...previous, timeoutMs: job.primary.timeoutMs, retries: job.primary.retries }));
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
			// Snapshot the independent judgement choice for this run, never the README/tutor model.
			const runtime = createWebJudgementRuntime();
			const selected = runtime.policy.tiers[0]?.key;
			const primary: JudgeScorerConfig = { ...scorerSettings, thinkingLevel: "off", model: {
				...judgeModel, id: selected?.model ?? "off", name: "Judgement runtime", provider: selected?.backend ?? "local",
			} };
			const base = await buildWebFineTuneExportFromSources(sources, options);
			const job: TrainingExportJob = { version: 1, sources, options, primary, maxExamples: scoreAll ? null : maxJudgeExamples, scoring: judgeScoring, bundle: base, updatedAt: Date.now() };
			setBundle(base); jobRef.current = job;
			await saveTrainingExportJob(job);
			const provenance = new Map<string, JudgeCheckpoint>();
			const enrich = (next: WebFineTuneExportResult) => {
				const manifest = JSON.parse(next.manifestJson);
				manifest.scoringCheckpoints = [...provenance].map(([key, value]) => ({ key, ...value }));
				manifest.scorerSettings = { judgement: runtime.settings, tiers: runtime.policy.tiers.map(tier => tier.key),
					timeoutMs: scorerSettings.timeoutMs, retries: scorerSettings.retries, uncalibratedMinimumConfidence: 0.5,
					notice: "Uncalibrated scores are exploratory teaching estimates, not measured learning gains. Checkpoints record the concrete model and calibration identity that answered." };
				return { ...next, manifestJson: JSON.stringify(manifest, null, 2) };
			};
			const scoringOptions = options;
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
			const judge = judgeScoring ? createRuntimeExportJudge({
				runtime, timeoutMs: scorerSettings.timeoutMs, retries: scorerSettings.retries,
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
	const steps = [
		{ id: "source", name: "Choose your data", detail: ({ all: "All sources", sessions: "Conversations", artifacts: "Teaching artifacts", sandbox: "Sandbox work" })[source] + " · " + ({ both: "ChatML + Alpaca", chatml: "ChatML", alpaca: "Alpaca" })[format] },
		{ id: "shape", name: "Shape the dataset", detail: keepAllResponses ? "Keep everything" : "Filter for training" },
		{ id: "score", name: "Score it", detail: judgeScoring ? (scoreAll ? "All eligible responses" : `Up to ${maxJudgeExamples} responses`) : "Optional · off" },
		{ id: "download", name: "Download or share", detail: "ZIP, JSONL" },
	];
	const [downloadBundle, setDownloadBundle] = useState<WebFineTuneExportResult | null>(null);
	const [downloadError, setDownloadError] = useState("");
	const [downloadedSnapshot, setDownloadedSnapshot] = useState<string | null>(null);
	const completedSteps = [
		step !== "source" || Boolean(bundle),
		Boolean(bundle),
		preparationComplete,
		Boolean(bundle && downloadedSnapshot === manifest.generatedAt),
	];
	const completedCount = completedSteps.filter(Boolean).length;
	return <main className="training-workspace">
		<AppBar back={{ label: "Activity", to: "/usage" }} title={<h1>Training data</h1>} subtitle="Turn your teaching work into a dataset you can inspect and use.">
			{loadingJob ? <Loading size="inline" label="Loading saved preparation…"/> : <span className="training-checkpoint" role="status" data-glyph-host><KeatingGlyph name="save" size={14}/> {restored ? "Restored your saved dataset. Resume reuses completed scores." : "Dataset and scores are checkpointed in this browser."}</span>}
			<Button variant="ghost" onClick={() => setImportOpen(true)}>Bring existing data in</Button>
		</AppBar>
		{(progress || exporting) && <div className="training-run-status" role="status">
			<KeatingBot state={exporting ? "thinking" : preparationComplete ? "success" : "idle"} animated={exporting || celebrating} size={40} label=""/>
			{progress && <span>{progress.completed}/{progress.total} checked · {progress.scored} scored · {progress.cached} reused · {progress.fallbackScored} fallback · {progress.failed} failed{progress.paused ? " · Paused" : ""}</span>}
			{exporting && <Button onClick={() => abortRef.current?.abort()}>Pause scoring</Button>}
		</div>}
		<div className="training-columns">
		<nav className="training-steps k-halftone" aria-label="Dataset steps">
			{steps.map(({ id, name, detail }, i) => <button type="button" key={id} aria-current={step === id ? "step" : undefined} aria-controls="training-step" onClick={() => setStep(id)}>
				<b aria-hidden="true">{completedSteps[i] ? <KeatingGlyph name="check" size={14}/> : i + 1}</b>{completedSteps[i] && <span className="training-sr">done </span>}<span><strong>{name}</strong><small>{detail}</small></span>
			</button>)}
			<div className="training-step-progress"><Progress done={completedCount} total={steps.length} label="Dataset steps completed"/></div>
			<p className="training-note">{judgeScoring ? `${scoreAll ? "All eligible responses" : `Up to ${maxJudgeExamples} responses`} use your judgement settings. Unknown scores remain empty.` : "Preparation runs locally. No model calls while scoring is off."}</p>
		</nav>
		<form ref={panelRef} id="training-step" className="training-config" onSubmit={event => { event.preventDefault(); void handleExport(); }}
			onInvalid={event => {
				const input = event.target as HTMLInputElement;
				if (input.closest("fieldset[hidden]")) { setStep("shape"); requestAnimationFrame(() => input.focus()); }
			}}>
		<fieldset hidden={step !== "source"} disabled={exporting || loadingJob}>
		<legend>Choose your data</legend>
		<p>Build from sessions, teaching artifacts, or sandbox work saved in this browser.</p>
		<div className="training-fields">
		<label>Source<select value={source} onChange={e => setSource(e.target.value as WebExportSource)}><option value="all">All sources</option><option value="sessions">Conversations</option><option value="artifacts">Teaching artifacts</option><option value="sandbox">Sandbox work</option></select></label>
		<label>Training format<select value={format} onChange={e => setFormat(e.target.value as WebFineTuneFormat)}><option value="both">ChatML + Alpaca</option><option value="chatml">ChatML · conversations</option><option value="alpaca">Alpaca · instruction pairs</option></select></label>
		</div>
		</fieldset>
		<fieldset hidden={step !== "shape"} disabled={exporting || loadingJob}>
		<legend>Shape the dataset</legend>
		<Segmented wide label="Retention preset" value={keepAllResponses ? "all" : "filtered"}
			options={[{ value: "filtered", label: "Filter for training" }, { value: "all", label: "Keep everything" }]}
			onChange={value => {
				const keepAll = value === "all";
				setKeepAllResponses(keepAll);
				setMinAssistantChars(keepAll ? 1 : 200);
				setDeduplicate(!keepAll);
				if (keepAll) { setSource("all"); setMaxAssistantChars(0); setMaxRecords(0); }
			}}/>
		{keepAllResponses && <p>Retain short, duplicate, low-scoring, and error responses. Include a source snapshot with original message types and metadata. Secret redaction remains your choice below.</p>}
		<p>Lengths are in characters. Records outside the range are excluded, not truncated.</p>
		<div className="training-fields">
		<label>Minimum response<input disabled={keepAllResponses} type="number" min="1" max={maxAssistantChars || undefined} required value={minAssistantChars} onChange={e => setMinAssistantChars(Math.max(1, Number(e.target.value)))} /></label>
		<label>Maximum response<input disabled={keepAllResponses} type="number" min="0" value={maxAssistantChars} onChange={e => setMaxAssistantChars(Math.max(0, Number(e.target.value)))} /><small>0 means no maximum</small></label>
		<label>Record limit<input disabled={keepAllResponses} type="number" min="0" value={maxRecords} onChange={e => setMaxRecords(Math.max(0, Number(e.target.value)))} /><small>0 includes all matching records; limits follow source order</small></label>
		<label>Validation share (%)<input type="number" min="0" max="50" value={validationPercent} onChange={e => setValidationPercent(Math.min(50, Math.max(0, Number(e.target.value))))} /><small>Labels canonical records by source group. Actual share varies.</small></label>
		</div>
		<div className="training-toggles">
			<div><Chip as="button" selected={deduplicate} disabled={keepAllResponses} aria-describedby="td-dedup" onClick={() => setDeduplicate(!deduplicate)}>{deduplicate && <KeatingGlyph name="check" size={14}/>}Remove duplicate examples</Chip>
			<small id="td-dedup">Keep one copy of repeated training content.</small></div>
			<div><Chip as="button" selected={redact} aria-describedby="td-redact" onClick={() => setRedact(!redact)}>{redact && <KeatingGlyph name="check" size={14}/>}Redact detected secrets</Chip>
			<small id="td-redact">Remove recognized credentials and email addresses. Inspect source data in Review before sharing.</small></div>
		</div>
		</fieldset>
		<fieldset hidden={step !== "score"} disabled={exporting || loadingJob}>
		<legend>Score it</legend>
		<label className="training-check"><input type="checkbox" checked={judgeScoring} onChange={e => setJudgeScoring(e.target.checked)} /><span>Add teaching estimates<small>Uses your independent judgement setting. Hosted scoring uses account credits when enabled.</small></span></label>
		{judgeScoring && <div className="training-judge">
		<p>Judgement: <strong>{judgementSettings.backend === "off" ? "Off — responses remain unscored" : judgementSettings.backend === "hosted" ? "Local first, then Not Organic" : "On this device"}</strong>{judgementSettings.backend !== "off" && <> · {judgementSettings.localModelId}</>}.</p>
		<a className="training-secondary" href="/chat?settings=judgement" target="_blank" rel="noopener noreferrer">Judgement settings (new tab)<KeatingGlyph name="ext"/></a>
		<label>Scoring scope<select value={scoreAll ? "all" : "limited"} onChange={e => setScoreAll(e.target.value === "all")}><option value="limited">Limit the number of responses</option><option value="all">Score all eligible responses</option></select></label>
		{!scoreAll && <label>Maximum responses to score<input type="number" min="1" value={maxJudgeExamples} onChange={e => setMaxJudgeExamples(Math.max(1, Number(e.target.value)))} /></label>}
		{scoreAll && <p>Every eligible conversation response will be checked. Time and any hosted charges scale with the dataset.</p>}
		<ScorerSettings value={scorerSettings} onChange={patch => setScorerSettings(previous => ({ ...previous, ...patch }))}/>
		<p>Uncalibrated scores are estimates of teaching behavior. They do not establish learning gains. Unavailable models and uncertain answers leave responses unscored.</p>
		</div>}
		</fieldset>
		<div hidden={step !== "download"}><h2>Download or share</h2>
			{bundle?.sourceDataJson && <Button onClick={() => downloadTextFile("source-snapshot.json", bundle.sourceDataJson!, "application/json")}>Source snapshot</Button>}
			{bundle && !exporting && <div ref={shareRef} tabIndex={-1}>
				<TrainingDatasetShare key={manifest.generatedAt} archive={archive} recordCount={bundle.recordCount}
					redacted={manifest.redactionEnabled} expanded={shareOpen} onExpandedChange={setShareOpen}/>
			</div>}
			<button type="button" className="training-secondary" disabled={exporting} onClick={() => setJudgePickerOpen(true)}>README model: {judgeModel.name}<KeatingGlyph name="chevr"/></button>		{bundle && <TrainingDatasetSummary bundle={bundle} model={judgeModel} thinkingLevel={judgeThinkingLevel} disabled={exporting} onChange={readmeSummary => {
			setBundle(previous => previous ? { ...previous, readmeSummary } : previous);
			if (jobRef.current) { jobRef.current.bundle = { ...jobRef.current.bundle, readmeSummary }; void saveTrainingExportJob(jobRef.current).catch(() => setError("The summary is in this session, but could not be checkpointed.")); }
		}}/>}{!bundle && <p className="training-note">Prepare a dataset to add an optional summary to its README.</p>}</div>
		{(step === "shape" || step === "score") && <div className="training-prepare-actions">
			<Button variant="ghost" onClick={() => setStep(step === "shape" ? "source" : "shape")}>Back</Button>
			<Button variant="ghost" disabled={exporting || loadingJob} onClick={() => void handleExport(true)}>Refresh source data</Button>
			<Button variant="primary" busy={exporting} disabled={exporting || loadingJob} type="submit">{exporting ? "Preparing dataset…" : judgeScoring ? "Score / resume missing" : "Prepare dataset"}</Button>
		</div>}
		</form>
		<section className="training-review" aria-label="Dataset overview" aria-busy={exporting}>
			<header className="k-halftone"><h2>Dataset overview</h2>{bundle && <span>Prepared snapshot · {manifest.source} · {manifest.redactionEnabled ? "redaction on" : "unredacted"}</span>}</header>
			<p>{bundle ? "Controls apply on the next preparation." : "Prepare, score, and export the complete dataset."}</p>
			{!bundle && (exporting || loadingJob ? <div className="training-empty">
				<KeatingBot variant="body" state="thinking" size={96} label=""/>
				<Loading label={exporting ? "Preparing your records" : "Your dataset starts here"}/>
				<p>{exporting ? "Filtering data and assembling training files. Scoring can take longer." : "Choose your sources and filters, then prepare a dataset to see dataset composition, quality counts, and included files."}</p>
			</div> : <EmptyState heading={<><KeatingBot variant="body" state="idle" size={96} label=""/>Your dataset starts here</>}>
				Choose your sources and filters, then prepare a dataset to see dataset composition, quality counts, and included files.
			</EmptyState>)}
			{bundle && <>
				<DatasetFigures records={bundle.recordCount} examples={bundle.exampleCount} validation={manifest.counts.validationRecords} counts={sourceCounts}/>
				<div className="training-quality"><p>{bundle.skippedCount} skipped · {bundle.redactionCount} redactions · {manifest.counts.duplicatesRemoved} duplicates removed</p><h3>Quality breakdown</h3><p>{Object.entries(manifest.quality).map(([key, value]) => `${value} ${key}`).join(" · ")}</p></div>
				<details className="training-session-list"><summary>Source sessions · {datasetSessions.length}</summary><p>Open Review for detailed annotations, summaries, and response-level work.</p>{datasetSessions.length ? <ul>{datasetSessions.map(session => <li key={session.id}><span>{session.title}<small>{session.count} records</small></span><Link to="/review/sessions/$sessionId" params={{ sessionId: session.id }} target="_blank" rel="noopener noreferrer">Open in Review <KeatingGlyph name="ext" size={13} /></Link></li>)}</ul> : <EmptyState heading="No source sessions in this dataset."/>}</details>
				<div className="training-files"><h3>In the ZIP</h3><DefinitionList items={(archive?.files ?? []).map(file => ({ term: file.path, detail: file.purpose }))}/>
				<p>Canonical records preserve provenance, quality flags, and train/validation labels. Compatibility files combine both partitions: split from canonical records before training and evaluation. Review unscored data before use.</p></div>

				<div className="training-export-row"><KeatingBot state="letter" animated={celebrating} size={44} label=""/>
				{!exporting && <button type="button" disabled={!archive} className="training-share-link" onClick={() => {
					setStep("download");
					setShareOpen(true);
					requestAnimationFrame(() => shareRef.current?.focus());
				}}>Share with Keating…</button>}
					<Button onClick={() => {
						downloadTextFile("keating.training.jsonl", bundle.canonicalJsonl ?? "", "application/x-ndjson");
						setDownloadedSnapshot(manifest.generatedAt);
					}}>Records JSONL</Button>
					<Button variant="primary" glyph="export" onClick={() => { setDownloadError(""); setDownloadBundle(bundle); }}>Download ZIP</Button>
				</div>
				{packaging.error && <p role="alert">{packaging.error}</p>}
			</>}
			<div aria-live="polite">{result && !bundle && <p>{result.records} records · {result.skipped} skipped</p>}{exportWarnings.map(warning => <p className="training-warning" key={warning}>{warning}</p>)}{error && <p role="alert" className="training-warning">{error}</p>}</div>
		</section>
		</div>
		{downloadBundle && <ExportSheet open onClose={() => setDownloadBundle(null)} title="Download dataset"
			included={`${downloadBundle.recordCount} canonical records, ${downloadBundle.exampleCount} training examples, manifest, schema and README.${downloadBundle.sourceDataJson ? " Includes the selected source snapshot." : ""}`}
			excluded={downloadBundle.sourceDataJson ? "Data outside the prepared source snapshot." : "The original source snapshot and data outside this preparation."}
			format="ZIP archive with JSONL training files" destination="Your downloads folder. Nothing is uploaded."
			confirmLabel="Download ZIP" error={downloadError || undefined} onConfirm={() => {
				try {
					const ready = (downloadBundle === bundle && archive) || buildWebTrainingArchive(downloadBundle);
					downloadFile(ready.filename, ready.bytes, "application/zip");
					setDownloadedSnapshot(JSON.parse(downloadBundle.manifestJson).generatedAt);
					setDownloadBundle(null);
				} catch { setDownloadError("ZIP download failed. Use the JSONL download or try again; no rescoring is required."); }
			}}/>}
		<Sheet open={importOpen} onClose={() => setImportOpen(false)} title="Bring existing data in"><section className="training-import"><div><p>Import ChatML or Alpaca JSONL as local sessions, then prepare them with the same controls.</p><p aria-live="polite">{importResult && `${importResult.examplesImported} examples imported into ${importResult.sessionsImported} sessions · ${importResult.skipped} skipped`}</p></div><label className="training-secondary"><KeatingGlyph name="import"/>Choose JSONL files<input className="training-file-input" type="file" accept=".jsonl,application/jsonl,application/x-ndjson" multiple disabled={exporting} onChange={e => { void handleImport(e.target.files); e.target.value = ""; }}/></label>{error && <p role="alert">{error}</p>}</section></Sheet>
		<ModelSelectorDialog open={judgePickerOpen} currentModel={judgeModel} onClose={() => setJudgePickerOpen(false)} onSelect={model => { setJudgeModel(model); const levels = getSupportedThinkingLevels(model); if (!levels.includes(judgeThinkingLevel)) setJudgeThinkingLevel(levels.includes("minimal") ? "minimal" : levels[0] ?? "off"); setJudgePickerOpen(false); }} title="README model" description="Writes the dataset summary. This does not change your judgement model." actionLabel="Use for README" preloadBrowserModel={false}/>
	</main>;
}
function ScorerSettings({ value, onChange }: { value: { maxTokens: number; temperature: number; timeoutMs: number; retries: number }; onChange: (patch: Partial<JudgeScorerConfig>) => void }) {
	return <details className="training-scorer-details"><summary>Request settings</summary><div className="training-fields"><label>Timeout (seconds)<input type="number" min="5" max="600" value={value.timeoutMs / 1000} onChange={e => onChange({ timeoutMs: Math.min(600, Math.max(5, Number(e.target.value))) * 1000 })}/></label><label>Retries per response<input type="number" min="0" max="3" value={value.retries} onChange={e => onChange({ retries: Math.min(3, Math.max(0, Number(e.target.value))) })}/></label></div><p>Retries may use credits. Resume reuses scores only for the same concrete model and calibration. A hosted alias must resolve its version again before cached scores can be reused.</p></details>;
}
export function TrainingData() {
	useSeo({ title: "Training data — Keating", description: "Prepare, inspect, import, and export training datasets from your Keating work.", canonical: "https://keating.help/training-data" });
	return <div className="retro-layout retro-page training-page"><TrainingWorkspace/></div>;
}
