import { Button, Switch, SelectField, Loading } from "../../../design-system/kit";
import { SavedHint, SettingRow, type Scope } from "../ui";
import { requestGptLiveConsent, type GptLiveConsent } from "../../GptLiveConsentSettings";
import { learningIntelligenceEnabled, setLearningIntelligenceEnabled, subscribeLearningIntelligence } from "../../../keating/learning-intelligence/account";
import { turnJudgementSavingEnabled, setTurnJudgementSavingEnabled, subscribeTurnJudgementSaving } from "../../../keating/judgement/turn-ledger";
import { ExtractionAccount } from "./ExtractionAccount";
import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import {
	isPostHogEnabled,
	isSessionReplayAvailable,
	updateAnalyticsPreferences,
} from "../../../lib/posthog";
import {
	ANALYTICS_PREFERENCES_KEY,
	readAnalyticsPreferences,
	writeAnalyticsPreferences,
} from "../../../lib/analytics-preferences";
import {
	getArizePublicConfig,
	subscribeArizeTraceStatus,
	type ArizePublicConfig,
	type ArizeTraceStatus,
} from "../../../lib/arize-observability";
import {
	SHARE_LINK_MODE_OPTIONS,
	type ShareLinkMode,
} from "../../../keating/ui-settings";
import { useKeatingUiSettings } from "../../../hooks/use-ui-settings";

import "./data.css";

function Destination({ id, label, help, to, scope = "this device", children }: {
	id: string; label: string; help: string; to: string; scope?: Scope; children: ReactNode;
}) {
	return <tr>
		<td colSpan={2}>
			<SettingRow id={id} label={label} help={help} scope={scope}>{null}</SettingRow>
		</td>
		<td className="sd-destination"><span>Goes to </span>{to}</td>
		<td><div className="sd-choice">{children}</div></td>
	</tr>;
}

function LiveConsentRow() {
	const [consent, setConsent] = useState<GptLiveConsent | null>(null);
	const [unavailable, setUnavailable] = useState(false);
	useEffect(() => {
		let active = true;
		void requestGptLiveConsent().then(value => { if (active) setConsent(value); },
			() => { if (active) setUnavailable(true); });
		return () => { active = false; };
	}, []);
	return <Destination id="sd-live" label="Live audio and content logging" to="GPT Live via Not Organic" scope="your account"
		help={consent?.disclosure ?? "GPT Live requires your account’s consent for live audio and content logging."}>
		{consent ? (consent.granted ? "Approved" : "Not approved") : unavailable ? "Consent unavailable" : <Loading size="inline" label="Checking consent" />}
		<Button variant="ghost" onClick={() => window.dispatchEvent(new CustomEvent("keating:settings-tab", { detail: "learning.voice" }))}>Voice and Live</Button>
	</Destination>;
}

export function SharingPrivacy() {
	const [settings, update] = useKeatingUiSettings();
	const replayAvailable = isSessionReplayAvailable();
	const [analyticsPreferences, setAnalyticsPreferences] = useState(() =>
		readAnalyticsPreferences(replayAvailable),
	);
	const analyticsAvailable = isPostHogEnabled();
	const [arizeConfig, setArizeConfig] = useState<ArizePublicConfig>({
		enabled: false,
		reason: "checking availability",
		evaluationContentEnabled: false,
		maxContentChars: 16_000,
		rateLimitPerMinute: 30,
	});
	const [arizeTraceStatus, setArizeTraceStatus] = useState<ArizeTraceStatus>({
		state: "idle",
	});

	useEffect(() => {
		void getArizePublicConfig().then(setArizeConfig);
		const refresh = (event: StorageEvent) => {
			if (!event.key || event.key === ANALYTICS_PREFERENCES_KEY) setAnalyticsPreferences(readAnalyticsPreferences(replayAvailable));
		};
		window.addEventListener("storage", refresh);
		const unsubscribe = subscribeArizeTraceStatus((status) => {
			setArizeTraceStatus(status);
			if (status.state === "disabled") {
				setAnalyticsPreferences(readAnalyticsPreferences(replayAvailable));
			}
		});
		return () => { unsubscribe(); window.removeEventListener("storage", refresh); };
	}, [replayAvailable]);

	const setAnalytics = useCallback(
		(captureEnabled: boolean) => {
			const next = { ...readAnalyticsPreferences(replayAvailable), captureEnabled };
			setAnalyticsPreferences(next);
			updateAnalyticsPreferences(next);
		},
		[replayAvailable],
	);

	const setReplay = useCallback(
		(replayEnabled: boolean) => {
			const next = { ...readAnalyticsPreferences(replayAvailable), replayEnabled };
			setAnalyticsPreferences(next);
			updateAnalyticsPreferences(next);
		},
		[replayAvailable],
	);

	const setArizeEvaluation = useCallback(
		(arizeEvaluationEnabled: boolean) => {
			const next = { ...readAnalyticsPreferences(replayAvailable), arizeEvaluationEnabled };
			setAnalyticsPreferences(next);
			// Arize consent is independent from PostHog and must not emit a product event.
			writeAnalyticsPreferences(next);
			if (!arizeEvaluationEnabled) {
				window.dispatchEvent(new Event("keating:arize-trace-turn-off"));
				setArizeTraceStatus({ state: "disabled" });
			}
		},
		[replayAvailable],
	);
	const extraction = useSyncExternalStore(subscribeLearningIntelligence, learningIntelligenceEnabled, () => false);
	const saving = useSyncExternalStore(subscribeTurnJudgementSaving, turnJudgementSavingEnabled, () => false);
	const mode = SHARE_LINK_MODE_OPTIONS.find(option => option.value === settings.shareLinkMode)!;
	const acknowledged = settings.shareWarningAcknowledged || settings.trajectoryShareWarningAcknowledged;
	return <div className="sd-privacy">
		<div className="sd-table">
			<table aria-label="Data destinations">
			<colgroup><col className="sd-what"/><col className="sd-sent"/><col/><col/></colgroup>
			<thead><tr className="sd-columns k-halftone">{["What", "What is sent", "Goes to", "Control"].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
			<tbody>
			<Destination id="sd-lessons" label="Your lessons" help="Your messages and teaching context go to your teaching model so the tutor can answer." to="Your teaching model’s provider">
				<span>Always on with a hosted model</span>
			</Destination>
			<Destination id="sd-analytics" label="Anonymous usage analytics" to="PostHog" help={analyticsAvailable
				? "Measures activation, feature use, AI response timing, errors and release health."
				: "Analytics is not configured in this build, so no product events are sent."}>
				<span id="settings-section-ui-privacy"/>
				<Switch labelledBy="sd-analytics-label" checked={analyticsAvailable && analyticsPreferences.captureEnabled} disabled={!analyticsAvailable} onChange={setAnalytics}/>
			</Destination>
			<Destination id="sd-replay" label="Session replay" to="PostHog" help={replayAvailable
				? "Records interaction shape while masking text, inputs, element attributes, dynamic route IDs and network bodies."
				: "Session replay is not available in this build. A deployment must explicitly enable it."}>
				<Switch labelledBy="sd-replay-label" checked={replayAvailable && analyticsPreferences.captureEnabled && analyticsPreferences.replayEnabled}
					disabled={!analyticsAvailable || !replayAvailable || !analyticsPreferences.captureEnabled} onChange={setReplay}/>
			</Destination>
			<Destination id="sd-crash" label="Crash and error reports" to="Keating support" help="Reports contain the app version, page and sanitized error messages. Prompts, replies, tool payloads and credentials are removed.">
				<Switch labelledBy="sd-crash-label" checked={settings.diagnosticsReporting} onChange={diagnosticsReporting => update({ diagnosticsReporting })}/>
			</Destination>
			<Destination id="sd-extraction" label="Learning extraction" to="Not Organic" help="Hosted requests use bounded lesson and learner passages to ground feedback, quizzes, constraints and memory.">
				<span id="settings-section-extraction-privacy"/>
				<Switch labelledBy="sd-extraction-label" checked={extraction} onChange={setLearningIntelligenceEnabled}/>
				<details className="sd-extraction-account"><summary>Account details</summary><ExtractionAccount/></details>
			</Destination>
			<Destination id="sd-judgements" label="Save judgements for review" to="This device only" help="Each turn’s judgements, extracted passages and memory decisions are saved with the conversation and deleted with it.">
				<Switch labelledBy="sd-judgements-label" checked={saving} onChange={setTurnJudgementSavingEnabled}/>
			</Destination>
			<Destination id="sd-arize" label="Arize evaluation" to="Arize" help={!arizeConfig.enabled
				? `Arize evaluation is unavailable (${arizeConfig.reason}); no turn data is sent.`
				: !arizeConfig.evaluationContentEnabled ? "This deployment allows metadata-only Arize traces. Visible prompt and reply text are not permitted."
				: "Sends each future turn’s current visible prompt and final visible reply. Thinking, tool arguments and results, files, prior turns and provider keys are excluded."}>
				<Switch labelledBy="sd-arize-label" checked={arizeConfig.enabled && analyticsPreferences.arizeEvaluationEnabled} disabled={!arizeConfig.enabled} onChange={setArizeEvaluation}/>
				{arizeTraceStatus.state === "failed" && <div role="alert">Arize trace was not sent. Your answer and local session are safe. The one retry payload stays only in memory.
					<Button variant="ghost" onClick={() => void arizeTraceStatus.retry()}>Retry</Button><Button variant="ghost" onClick={arizeTraceStatus.turnOff}>Turn off</Button></div>}
			</Destination>
			<LiveConsentRow/>
			<Destination id="sd-links" label="Public links" to={mode.public ? "Anyone with the link" : "This browser’s cache"} help="Copied links can carry the visible conversation, safe session artifacts and finalized review feedback. Every public share requires a fresh checkbox.">
				<span id="settings-section-ui-share"/>
				<SelectField label="Share link mode" value={mode.value} onValueChange={value => update({ shareLinkMode: value as ShareLinkMode })}>
					{SHARE_LINK_MODE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
				</SelectField>
			</Destination>
			</tbody></table>
			<div className="sd-sharing-note">
				<p>{mode.description} {acknowledged ? "A first-use sharing warning was acknowledged." : "No first-use sharing warning is acknowledged."}</p>
				<Button variant="ghost" disabled={!acknowledged} onClick={() => update({ shareWarningAcknowledged: false, trajectoryShareWarningAcknowledged: false })}>Ask me again before the next public share</Button>
			</div>
		</div>
		<p className="sd-footnote">Keating never sends prompts, replies, file contents, provider keys or full share links to PostHog. <a href="/privacy">Privacy policy</a></p>
		<SavedHint/>
	</div>;
}
