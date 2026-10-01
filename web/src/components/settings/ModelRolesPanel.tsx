import { useEffect, useState } from "react";
import { Brain, Image as ImageIcon, MessageSquare, Mic } from "lucide-react";
import { css } from "../../../styled-system/css";
import { useKeatingSetting } from "../../hooks/use-keating-setting";
import { useKeatingUiSettings } from "../../hooks/use-ui-settings";
import { useModelPrefs } from "../../hooks/use-model-prefs";
import { setDefaultChatModel } from "../../keating/model-prefs";
import { loadJudgementModelSettings, saveJudgementModelSettings, subscribeJudgementModelSettings, type JudgementBackendPreference } from "../../keating/judgement-model";
import { listSpeechProviders, type SpeechProviderDescriptor } from "../../keating/speech";
import { IMAGE_GENERATORS } from "../../lib/image-generators";
import { modelKey } from "../../lib/model-catalog";
import { getSelectableModels } from "../../lib/provider-models";
import { NOTORGANIC_PROVIDER_ID, notOrganicPublicClient } from "../../notorganic-provider";

const scrollToSection = (id: string) => document.getElementById(`settings-section-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });

const gridClass = css({ display: "grid", gap: "0.75rem", gridTemplateColumns: "1fr", sm: { gridTemplateColumns: "1fr 1fr" } });
const cardClass = css({
	display: "flex",
	flexDirection: "column",
	gap: "0.5rem",
	padding: "1rem",
	borderRadius: "0.5rem",
	border: "1px solid var(--border)",
});
const headClass = css({ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.875rem", fontWeight: 600, color: "var(--foreground)" });
const hintClass = css({ fontSize: "0.75rem", color: "var(--muted-foreground)" });
const selectClass = css({
	width: "100%",
	borderRadius: "0.375rem",
	border: "1px solid var(--border)",
	backgroundColor: "var(--background)",
	paddingInline: "0.5rem",
	paddingBlock: "0.5rem",
	fontSize: "0.875rem",
	_focusVisible: { outline: "2px solid var(--primary)", outlineOffset: "1px" },
});
const linkButtonClass = css({ alignSelf: "flex-start", fontSize: "0.75rem", color: "var(--primary)", textDecoration: "underline", textUnderlineOffset: "2px" });

function Role({ icon, title, hint, children }: { icon: React.ReactNode; title: string; hint: string; children: React.ReactNode }) {
	return (
		<div className={cardClass}>
			<div className={headClass}>{icon}{title}</div>
			{children}
			<p className={hintClass}>{hint}</p>
		</div>
	);
}

const JUDGEMENT_LABELS: Record<JudgementBackendPreference, string> = {
	hosted: "Hosted Jev (recommended)",
	local: "On this device",
	off: "Off — built-in checks only",
};

/** One place to see and switch the model behind each job; every change is saved as the default. */
export function ModelRolesPanel() {
	const [prefs] = useModelPrefs();
	const [ui, patchUi] = useKeatingUiSettings();
	const [speech, patchSpeech] = useKeatingSetting("speech");
	const [models, setModels] = useState<Array<{ key: string; label: string; group: string }>>([]);
	const [voices, setVoices] = useState<SpeechProviderDescriptor[]>([]);
	const [judgement, setJudgement] = useState(loadJudgementModelSettings);
	const signedIn = (() => { try { return Boolean(notOrganicPublicClient()?.getSession()); } catch { return false; } })();

	useEffect(() => {
		let active = true;
		void getSelectableModels().then((all) => {
			if (active) setModels(all.map((m) => ({ key: modelKey(m), label: m.name || m.id, group: m.provider })));
		}).catch(() => {});
		void listSpeechProviders().then((p) => { if (active) setVoices(p); }).catch(() => {});
		const unsubscribe = subscribeJudgementModelSettings(() => setJudgement(loadJudgementModelSettings()));
		return () => { active = false; unsubscribe?.(); };
	}, []);

	const chatKey = prefs.defaultChatModelKey ?? prefs.recentModels[0]?.key ?? "";
	const groups = [...new Set(models.map((m) => m.group))];
	const voiceOptions = [...voices].sort((a, b) => Number(b.id === "gpt-live" && signedIn) - Number(a.id === "gpt-live" && signedIn));

	return (
		<div id="settings-section-model-roles" className={css({ display: "flex", flexDirection: "column", gap: "0.75rem", scrollMarginTop: "5rem" })}>
			<div>
				<h3 className={css({ fontSize: "1rem", fontWeight: 600, color: "var(--foreground)" })}>Your models</h3>
				<p className={hintClass}>Choose which model handles each job. Changes are saved as your defaults.</p>
			</div>
			<div className={gridClass}>
				<Role icon={<MessageSquare size={15} />} title="Chat" hint="Used when you start a new chat. You can still switch per chat from the chat model picker.">
					<select
						className={selectClass}
						aria-label="Default chat model"
						value={chatKey}
						onChange={(e) => setDefaultChatModel(e.target.value || null)}
					>
						{!chatKey && <option value="">Most recently used</option>}
						{groups.map((g) => (
							<optgroup key={g} label={g}>
								{models.filter((m) => m.group === g).map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
							</optgroup>
						))}
					</select>
					{prefs.defaultChatModelKey && (
						<button type="button" className={linkButtonClass} onClick={() => setDefaultChatModel(null)}>Use most recently used instead</button>
					)}
				</Role>

				<Role icon={<Brain size={15} />} title="Decisions" hint="Reviews work and estimates mastery. Separate from the chat model.">
					<select
						className={selectClass}
						aria-label="Decision model"
						value={judgement.backend}
						onChange={(e) => { const next = { ...judgement, backend: e.target.value as JudgementBackendPreference }; setJudgement(next); saveJudgementModelSettings(next); }}
					>
						{(Object.keys(JUDGEMENT_LABELS) as JudgementBackendPreference[]).map((k) => <option key={k} value={k}>{JUDGEMENT_LABELS[k]}</option>)}
					</select>
					<button type="button" className={linkButtonClass} onClick={() => scrollToSection("judgement")}>Advanced decision settings</button>
				</Role>

				<Role icon={<Mic size={15} />} title="Voice" hint={signedIn ? "GPT Live through your Not Organic account is the default once you sign in." : "Sign in with Not Organic to make GPT Live your default voice."}>
					<select
						className={selectClass}
						aria-label="Voice provider"
						value={speech.providerId}
						onChange={(e) => {
							const next = voices.find((v) => v.id === e.target.value);
							patchSpeech({ providerId: e.target.value, model: next?.models?.[0]?.value ?? speech.model, voiceName: next?.voices?.[0] ?? speech.voiceName });
						}}
					>
						{voiceOptions.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
					</select>
					<button type="button" className={linkButtonClass} onClick={() => window.dispatchEvent(new CustomEvent("keating:settings-tab", { detail: "learning" }))}>Voice settings</button>
				</Role>

				<Role icon={<ImageIcon size={15} />} title="Images" hint="Generates diagrams and illustrations.">
					<select
						className={selectClass}
						aria-label="Image generator"
						value={ui.imageGenerator}
						onChange={(e) => patchUi({ imageGenerator: e.target.value as typeof ui.imageGenerator, imageModel: "" })}
					>
						{IMAGE_GENERATORS.map((g) => <option key={g.id} value={g.id}>{g.label}</option>)}
					</select>
				</Role>
			</div>
		</div>
	);
}
