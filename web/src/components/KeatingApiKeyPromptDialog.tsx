import { useEffect, useState } from "react";
import { getAppStorage } from "@earendil-works/pi-web-ui";
import { KeyRound, X } from "lucide-react";
import { css } from "../../styled-system/css";
import { handleTutorialLinkClick, tutorialApiKeyHref } from "../lib/tutorial-links";
import { isNotOrganicProvider } from "../notorganic-provider";
import {
	NotOrganicAccessPromptDialog,
	promptNotOrganicAccess,
} from "./NotOrganicAccessPromptDialog";

type PromptRequest = {
	id: string;
	provider: string;
	resolve: (success: boolean) => void;
};

let activePrompt: PromptRequest | null = null;

function emitPromptChange() {
	window.dispatchEvent(new CustomEvent("keating:api-key-prompt-changed"));
}

export async function promptKeatingApiKey(
	provider: string,
	options: { force?: boolean } = {},
): Promise<boolean> {
	if (typeof window === "undefined") return false;
	if (!options.force) {
		const existing = await getAppStorage().providerKeys.get(provider);
		if (existing) return true;
	}

	if (isNotOrganicProvider(provider)) {
		return promptNotOrganicAccess({ force: options.force });
	}

	if (activePrompt) {
		activePrompt.resolve(false);
	}

	return new Promise((resolve) => {
		activePrompt = {
			id: crypto.randomUUID(),
			provider,
			resolve,
		};
		emitPromptChange();
	});
}

function closePrompt(success: boolean) {
	if (!activePrompt) return;
	const request = activePrompt;
	activePrompt = null;
	request.resolve(success);
	emitPromptChange();
}

async function providerLabel(provider: string): Promise<string> {
	if (provider === "google") return "Google Gemini";
	if (provider === "openai") return "OpenAI";
	if (provider === "anthropic") return "Anthropic";
	if (provider === "openrouter") return "OpenRouter";
	try {
		const providers = (await getAppStorage().customProviders.getAll()) as Array<{ name?: string }>;
		const match = providers.find((entry) => entry?.name === provider);
		if (match?.name) return match.name;
	} catch {
		/* noop */
	}
	return provider;
}

export function KeatingApiKeyPromptDialog() {
	const [request, setRequest] = useState(activePrompt);
	const [apiKey, setApiKey] = useState("");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState("");
	const [label, setLabel] = useState("");

	useEffect(() => {
		const sync = () => {
			setRequest(activePrompt);
			setApiKey("");
			setError("");
			if (activePrompt) {
				void providerLabel(activePrompt.provider).then(setLabel);
			} else {
				setLabel("");
			}
		};
		sync();
		window.addEventListener("keating:api-key-prompt-changed", sync);
		return () => window.removeEventListener("keating:api-key-prompt-changed", sync);
	}, []);

	if (!request) return <NotOrganicAccessPromptDialog />;

	const save = async () => {
		const trimmed = apiKey.trim();
		if (!trimmed) {
			setError("Enter an API key first.");
			return;
		}
		setSaving(true);
		setError("");
		try {
			await getAppStorage().providerKeys.set(request.provider, trimmed);
			closePrompt(true);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setSaving(false);
		}
	};

	return (
		<div className={css({ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "color-mix(in srgb, var(--background) 70%, transparent)", padding: "1rem", backdropFilter: "blur(4px)" })}>
			<div className={css({ width: "100%", maxWidth: "28rem", borderRadius: "0.5rem", border: "1px solid var(--border)", backgroundColor: "var(--background)", boxShadow: "var(--shadow-xl)" })}>
				<div className={css({ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", borderBottom: "1px solid var(--border)", paddingInline: "1rem", paddingBlock: "0.75rem" })}>
					<div className={css({ display: "flex", alignItems: "center", gap: "0.5rem" })}>
						<KeyRound size={16} className={css({ color: "var(--primary)" })} />
						<h2 className={css({ fontSize: "0.875rem", fontWeight: 600 })}>API key required</h2>
					</div>
					<button
						type="button"
						className={css({ display: "inline-flex", height: "2rem", width: "2rem", alignItems: "center", justifyContent: "center", borderRadius: "0.375rem", color: "var(--muted-foreground)", transitionProperty: "color, background-color, border-color", transitionDuration: "150ms", _hover: { background: "var(--accent)", color: "var(--foreground)" } })}
						onClick={() => closePrompt(false)}
						aria-label="Close"
					>
						<X size={16} />
					</button>
				</div>
				<div className={css({ display: "flex", flexDirection: "column", gap: "0.75rem", padding: "1rem" })}>
					<p className={css({ fontSize: "0.875rem", color: "var(--muted-foreground)" })}>
						Add a local browser API key for {label || request.provider} to use this model.
					</p>
					<input
						type="password"
						className={css({ width: "100%", borderRadius: "0.375rem", border: "1px solid var(--border)", backgroundColor: "var(--background)", paddingInline: "0.75rem", paddingBlock: "0.5rem", fontSize: "0.875rem" })}
						placeholder={`${request.provider} API key`}
						value={apiKey}
						onChange={(event) => setApiKey(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter") void save();
							if (event.key === "Escape") closePrompt(false);
						}}
						autoFocus
					/>
					<div className={css({ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "0.75rem" })}>
						<a
							href={tutorialApiKeyHref(request.provider)}
							className={css({ fontSize: "0.75rem", color: "var(--primary)", textDecorationLine: "underline", textUnderlineOffset: "2px" })}
							onClick={(event) => handleTutorialLinkClick(event.nativeEvent, tutorialApiKeyHref(request.provider))}
						>
							Need a key? Follow the tutorial
						</a>
						<button
							type="button"
							className={css({ display: "inline-flex", height: "2.25rem", alignItems: "center", borderRadius: "0.375rem", backgroundColor: "var(--primary)", paddingInline: "0.75rem", fontSize: "0.875rem", fontWeight: 500, color: "var(--primary-foreground)", transitionProperty: "color, background-color, border-color", transitionDuration: "150ms", _hover: { backgroundColor: "color-mix(in srgb, var(--primary) 90%, black)" }, _disabled: { opacity: 0.5 } })}
							onClick={save}
							disabled={saving}
						>
							{saving ? "Saving..." : "Save key"}
						</button>
					</div>
					{error && <div className={css({ fontSize: "0.75rem", color: "var(--destructive)" })}>{error}</div>}
				</div>
			</div>
		</div>
	);
}
