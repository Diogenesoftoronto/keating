import { useEffect, useState } from "react";
import { getAppStorage } from "@earendil-works/pi-web-ui";
import { KeyRound, X } from "lucide-react";
import { handleTutorialLinkClick, tutorialApiKeyHref } from "../lib/tutorial-links";
import { isDioProvider } from "../dio-provider";
import { DioAccessPromptDialog, promptDioAccess } from "./DioAccessPromptDialog";

type PromptRequest = {
	id: string;
	provider: string;
	resolve: (success: boolean) => void;
};

let activePrompt: PromptRequest | null = null;

function emitPromptChange() {
	window.dispatchEvent(new CustomEvent("keating:api-key-prompt-changed"));
}

export async function promptKeatingApiKey(provider: string): Promise<boolean> {
	if (typeof window === "undefined") return false;
	const existing = await getAppStorage().providerKeys.get(provider);
	if (existing) return true;

	if (isDioProvider(provider)) {
		return promptDioAccess();
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

function providerLabel(provider: string) {
	if (provider === "google") return "Google Gemini";
	if (provider === "openai") return "OpenAI";
	if (provider === "anthropic") return "Anthropic";
	if (provider === "openrouter") return "OpenRouter";
	return provider;
}

export function KeatingApiKeyPromptDialog() {
	const [request, setRequest] = useState(activePrompt);
	const [apiKey, setApiKey] = useState("");
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState("");

	useEffect(() => {
		const sync = () => {
			setRequest(activePrompt);
			setApiKey("");
			setError("");
		};
		window.addEventListener("keating:api-key-prompt-changed", sync);
		return () => window.removeEventListener("keating:api-key-prompt-changed", sync);
	}, []);

	if (!request) return <DioAccessPromptDialog />;

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
		<div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm">
			<div className="w-full max-w-md rounded-lg border border-border bg-background shadow-xl">
				<div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
					<div className="flex items-center gap-2">
						<KeyRound size={16} className="text-primary" />
						<h2 className="text-sm font-semibold">API key required</h2>
					</div>
					<button
						type="button"
						className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
						onClick={() => closePrompt(false)}
						aria-label="Close"
					>
						<X size={16} />
					</button>
				</div>
				<div className="space-y-3 p-4">
					<p className="text-sm text-muted-foreground">
						Add a local browser API key for {providerLabel(request.provider)} to use this model.
					</p>
					<input
						type="password"
						className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
						placeholder={`${request.provider} API key`}
						value={apiKey}
						onChange={(event) => setApiKey(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter") void save();
							if (event.key === "Escape") closePrompt(false);
						}}
						autoFocus
					/>
					<div className="flex flex-wrap items-center justify-between gap-3">
						<a
							href={tutorialApiKeyHref(request.provider)}
							className="text-xs text-primary underline underline-offset-2"
							onClick={(event) => handleTutorialLinkClick(event.nativeEvent, tutorialApiKeyHref(request.provider))}
						>
							Need a key? Follow the tutorial
						</a>
						<button
							type="button"
							className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
							onClick={save}
							disabled={saving}
						>
							{saving ? "Saving..." : "Save key"}
						</button>
					</div>
					{error && <div className="text-xs text-destructive">{error}</div>}
				</div>
			</div>
		</div>
	);
}
