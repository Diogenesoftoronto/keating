import { WebSearchSwitch } from "./WebSearchSection";
import { useEffect, useState, type ReactNode } from "react";
import { KeatingGlyph, type GlyphName } from "../../design-system/glyphs";
import { Button, Chip, Loading } from "../../design-system/kit";
import { useKeatingSetting } from "../../hooks/use-keating-setting";
import { useKeatingUiSettings } from "../../hooks/use-ui-settings";
import { useModelPrefs } from "../../hooks/use-model-prefs";
import { setDefaultChatModel } from "../../keating/model-prefs";
import {
	loadJudgementModelSettings,
	subscribeJudgementModelSettings,
} from "../../keating/judgement-model";
import {
	listSpeechProviders,
	type SpeechProviderDescriptor,
} from "../../keating/speech";
import { useImageAccess } from "./models/image-access";
import { modelKey } from "../../lib/model-catalog";
import { getSelectableModels } from "../../lib/provider-models";
import { ModelSelectorDialog } from "../ModelSelector";
import { Select } from "../Select";
import { SavedHint, ScopeTag, StatusLine } from "./ui";
import { ModelReasoning } from "./models/ModelReasoning";
import { openModelSection, speechProviderChoice } from "./models/model-choices";
import "./models/models.css";

function Job({
	id,
	glyph,
	name,
	help,
	choice,
	children,
}: {
	id: string;
	glyph: GlyphName;
	name: string;
	help: string;
	choice: ReactNode;
	children: ReactNode;
}) {
	return (
		<div id={"job-" + id} className="s2-job" tabIndex={-1} data-glyph-host>
			<KeatingGlyph name={glyph} size={16} />
			<div>
				<strong id={"job-label-" + id}>{name}</strong>{" "}
				<ScopeTag scope={id === "teaching" ? "new chats" : "this device"} />
				<p>{help}</p>
			</div>
			<div className="s2-choice">{choice}</div>
			{children}
		</div>
	);
}
export function useCheckingChoice() {
	const [choice, setChoice] = useState(loadJudgementModelSettings);
	useEffect(() => subscribeJudgementModelSettings(setChoice), []);
	return choice;
}
export function ModelRolesPanel() {
	const [prefs] = useModelPrefs();
	const [ui, patch] = useKeatingUiSettings();
	const [speech, patchSpeech] = useKeatingSetting("speech");
	const checking = useCheckingChoice();
	const [models, setModels] = useState<
		Awaited<ReturnType<typeof getSelectableModels>>
	>([]);
	const [voices, setVoices] = useState<SpeechProviderDescriptor[]>([]);
	const [picker, setPicker] = useState(false);
	const [voicesFailed, setVoicesFailed] = useState(false);
	const [voiceEditor, setVoiceEditor] = useState(false);
	useEffect(() => {
		let active = true;
		void getSelectableModels()
			.then((items) => {
				if (active) setModels(items);
			})
			.catch(() => {});
		void listSpeechProviders()
			.then((items) => {
				if (active) setVoices(items);
			})
			.catch(() => {
				if (active) setVoicesFailed(true);
			});
		return () => {
			active = false;
		};
	}, []);
	const key = prefs.defaultChatModelKey ?? prefs.recentModels[0]?.key;
	const model = models.find((item) => modelKey(item) === key);
	const voice = voices.find((v) => v.id === speech.providerId);
	const { generator, ready } = useImageAccess();
	const checkingLabel =
		checking.backend === "off"
			? "Built-in checks"
			: checking.backend === "local"
				? checking.localModelId
				: checking.hostedProvider === "typesafe"
					? "Jev · TypeSafe"
					: checking.hostedProvider && checking.hostedProvider !== "notorganic"
						? "Gemini Decision 1"
						: "Hosted Jev";
	return (
		<div id="settings-section-model-roles" className="s2-pane">
			<div className="s2-list" id="settings-section-your-models">
				<Job
					id="teaching"
					glyph="message"
					name="Teaching"
					help="A chat keeps the model it started with. You can switch it in the chat picker."
					choice={
						<Chip>
							{model?.name ?? key?.split("::").at(-1) ?? "Most recently used"}
						</Chip>
					}
				>
					<Button
						variant="line"
						aria-label="Change teaching model"
						onClick={() => setPicker(true)}
					>
						Change
					</Button>
				</Job>
				{prefs.defaultChatModelKey && (
					<Button variant="ghost" onClick={() => setDefaultChatModel(null)}>
						Use most recently used instead
					</Button>
				)}
				<ModelSelectorDialog
					open={picker}
					currentModel={model ?? null}
					preloadBrowserModel={false}
					onSelect={(next) => {
						setDefaultChatModel(modelKey(next));
						setPicker(false);
					}}
					onClose={() => setPicker(false)}
				/>
				<Job
					id="checking"
					glyph="verified"
					name="Checking replies"
					help="Reviews work and estimates mastery."
					choice={<Chip>{checkingLabel}</Chip>}
				>
					<Button
						variant="line"
						aria-label="Change checking model"
						onClick={() => openModelSection("checking")}
					>
						Change
					</Button>
				</Job>
				<Job
					id="voice"
					glyph="speaker"
					name="Voice"
					help="Reading aloud and Live. GPT Live uses your Not Organic account."
					choice={
						<Chip>
							{voice?.label ??
								speech.customModels.find(
									(m) => "custom:" + m.id === speech.providerId,
								)?.label ??
								speech.providerId}
						</Chip>
					}
				>
					<Button
						variant="line"
						aria-label="Change voice provider"
						aria-expanded={voiceEditor}
						onClick={() => setVoiceEditor(!voiceEditor)}
					>
						Change
					</Button>
				</Job>
				{voiceEditor && (
					<div className="s2-editor">
						{voices.length ? (
							<Select
								aria-label="Voice provider"
								value={speech.providerId}
								onValueChange={(id) => {
									const next = speechProviderChoice(
										id,
										voices,
										speech.customModels,
									);
									if (next) patchSpeech(next);
								}}
							>
								{voices.map((v) => (
									<option key={v.id} value={v.id}>
										{v.label}
									</option>
								))}
								{speech.customModels.map((m) => (
									<option key={m.id} value={"custom:" + m.id}>
										{m.label}
									</option>
								))}
							</Select>
						) : voicesFailed ? (
							<p role="alert">Voice providers could not be loaded.</p>
						) : (
							<Loading size="inline" label="Loading voice providers" />
						)}
						<Button variant="ghost" onClick={() => openModelSection("voice")}>
							Voice settings
						</Button>
					</div>
				)}
				<Job
					id="images"
					glyph="image"
					name="Images"
					help="Diagrams and pictures in lessons."
					choice={
						ready === false ? (
							<StatusLine tone="warn">
								{generator?.needsBaseUrl
									? "Not set"
									: generator?.auth === "api-key"
										? "Needs a key"
										: "Not connected yet"}
							</StatusLine>
						) : (
							<Chip>{generator?.label ?? "Not set"}</Chip>
						)
					}
				>
					<Button
						variant="line"
						aria-label="Choose image generator"
						onClick={() => openModelSection("images")}
					>
						Choose
					</Button>
				</Job>
				<Job
					id="search"
					glyph="search"
					name="Web search"
					help="Shows sources under the reply when search is available."
					choice={
						<StatusLine tone={ui.webSearch === "auto" ? "ok" : "idle"}>
							{ui.webSearch === "auto" ? "On" : "Off"}
						</StatusLine>
					}
				>
					<WebSearchSwitch
						labelledBy="job-label-search"
						settings={ui}
						onPatch={patch}
					/>
				</Job>
			</div>
			<SavedHint />
			<ModelReasoning />
		</div>
	);
}
