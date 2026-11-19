import { DEFAULT_MODELS, MODEL_CHOICES } from "@keating/runtime-config";
import {
	Button,
	ConfirmDialog,
	Loading,
	SelectField,
} from "../../design-system/kit";
import { useEffect, useState } from "react";
import { useOnlineLearningPreference } from "../../hooks/useOnlineLearning";
import {
	connectOnlineLearning,
	onlineLearningModels,
	setOnlineLearningChatMode,
	setOnlineLearningModel,
	type ActivityLearningMode,
	type TabularModelListing,
	type TabularModelPreference,
} from "../../keating/judgement/tabular-account";
import { clearWebActivityLearningHistory } from "../../keating/judgement/activity-learning";

export function OnlineLearningSettings() {
	const account = useOnlineLearningPreference(),
		[error, setError] = useState("");
	const [models, setModels] = useState<TabularModelListing[]>([]),
		[loading, setLoading] = useState(false);
	const [confirm, setConfirm] = useState(false);
	const [historyCleared, setHistoryCleared] = useState(false);
	useEffect(() => {
		setModels([]);
		setError("");
		if (!account.authorized || !account.scope) {
			setLoading(false);
			return;
		}
		const controller = new AbortController();
		setLoading(true);
		void onlineLearningModels(account.scope, controller.signal)
			.then((rows) => {
				if (!controller.signal.aborted) setModels(rows);
			})
			.catch(() => {
				if (!controller.signal.aborted)
					setError("The account service could not list tabular models yet.");
			})
			.finally(() => {
				if (!controller.signal.aborted) setLoading(false);
			});
		return () => controller.abort();
	}, [account.scope, account.authorized]);
	const selected = models.find((model) => model.id === account.model);
	return (
		<section aria-labelledby="online-learning-title" className="pf-fields">
			<h3 id="online-learning-title">Learning predictions</h3>
			<p>
				A tabular model uses saved answers and reviews to estimate your next
				answer, delayed recall, and which due decks need attention.
			</p>
			{account.authorized && account.scope ? (
				<>
					<SelectField
						id="prediction-model"
						label="Tabular model"
						value={account.model}
						onValueChange={(value) => {
							try {
								setOnlineLearningModel(
									account.scope!,
									value as TabularModelPreference,
								);
								setError("");
							} catch {
								setError("Could not save this preference.");
							}
						}}
					>
						<option value="off">Off · usual learning rules</option>
						<option
							value={DEFAULT_MODELS.judgement.tabular}
							disabled={
								!models.some(
									(model) =>
										model.id === DEFAULT_MODELS.judgement.tabular &&
										model.available,
								)
							}
						>
							{MODEL_CHOICES.judgement.tabular.shortLabel}
							{loading
								? " · checking availability"
								: models.some((model) => model.available)
									? ""
									: " · unavailable"}
						</option>
					</SelectField>
					{account.enabled && (
						<SelectField
							id="prediction-mode"
							label="Chat learning"
							value={account.chatMode}
							onValueChange={(value) => {
								try {
									setOnlineLearningChatMode(
										account.scope!,
										value as ActivityLearningMode,
									);
									setError("");
								} catch {
									setError("Could not save this preference.");
								}
							}}
						>
							<option value="background">
								Background learning · no extra reply wait
							</option>
							<option value="live">Live reply comparison · experimental</option>
						</SelectField>
					)}
					{selected?.available && selected.priceMicrousd != null && (
						<p>
							US${(selected.priceMicrousd / 1_000_000).toFixed(6)} per
							prediction batch. Background chat learning uses one batch when
							enough new evidence is available, at most once a minute. Live
							comparison can use one batch per eligible reply instead. Coming Up
							uses up to three batches per update. Your request spending limit
							still applies.
						</p>
					)}
					{loading && (
						<Loading
							label="Checking prediction model availability"
							size="inline"
						/>
					)}
					{account.enabled && !loading && !selected?.available && (
						<p>
							The selected model is unavailable. The usual learning rules remain
							active.
						</p>
					)}
					<Button id="prediction-history" onClick={() => setConfirm(true)}>
						Clear chat prediction history
					</Button>
					<ConfirmDialog
						open={confirm}
						title="Clear chat prediction history?"
						description="This removes the saved chat prediction history on this device."
						confirmLabel="Clear history"
						onCancel={() => setConfirm(false)}
						onConfirm={() => {
							setConfirm(false);
							try {
								clearWebActivityLearningHistory(account.scope!);
								setHistoryCleared(true);
								setError("");
							} catch {
								setError(
									"Could not clear chat prediction history on this device.",
								);
							}
						}}
					/>
					{historyCleared && (
						<p role="status">
							Chat prediction history cleared on this device. New replies can
							start a fresh history while predictions are enabled.
						</p>
					)}
				</>
			) : (
				<Button
					onClick={() => {
						void connectOnlineLearning("/chat?settings=learning.recall")
							.then((url) => window.location.assign(url))
							.catch(() =>
								setError(
									"Could not connect online predictions. Check your account settings.",
								),
							);
					}}
				>
					Connect online predictions
				</Button>
			)}
			<p>
				When enabled, numerical learning history and activity features go
				through Not Organic to Prior Labs. This prediction service receives no
				question text, answers, names or card content. Hosted updates use
				account credit.
			</p>
			<p>
				Background learning uses saved outcomes to test activity preferences for
				future replies. Your conversation never waits for TabPFN; each turn
				keeps the tested policy it started with. The usual teaching checks still
				apply. This does not rewrite Jev's questions.
			</p>
			<p>
				Experimental live comparison waits for TabPFN to compare approved reply
				options. Both modes record only the reply shown and its matching later
				graded answer; missing answers stay unknown.
			</p>
			<p>
				Updates run on Coming Up when evidence changes, at most once a minute.
				Later saved outcomes check each candidate before it can change review
				order. These estimates describe patterns in recorded activity; they do
				not establish causal effects.
			</p>
			{error && <p role="alert">{error}</p>}
		</section>
	);
}
