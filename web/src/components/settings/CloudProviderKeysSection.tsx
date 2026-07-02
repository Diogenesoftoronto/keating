import { useEffect, useState } from "react";
import { getAppStorage } from "@earendil-works/pi-web-ui";
import { handleTutorialLinkClick, tutorialApiKeyHref } from "../../lib/tutorial-links";
import { promptDioAccess } from "../DioAccessPromptDialog";
import {
	completeOAuthFromInput,
	initiateOAuth,
	providerToOAuthId,
	loadOAuthCredentials,
	deleteOAuthCredentials,
	type OAuthProviderId,
} from "../../keating/oauth";
import { DIO_PROVIDER_ID } from "../../dio-provider";

export function CloudProviderKeysSection({ providers }: { providers: string[] }) {
	return (
		<div id="settings-section-cloud-providers" className="flex flex-col gap-4 scroll-mt-20">
			<div>
				<h3 className="text-sm font-semibold text-foreground mb-2">Cloud Providers</h3>
				<p className="text-sm text-muted-foreground">
					Cloud LLM providers with predefined models. API keys are stored locally in your browser.
				</p>
			</div>
			<div className="flex flex-col gap-3">
				<OAuthProviderKeys providers={providers} />
			</div>
		</div>
	);
}

function OAuthProviderKeys({ providers }: { providers: string[] }) {
	const [keys, setKeys] = useState<Record<string, string>>({});
	const [oauthStatus, setOAuthStatus] = useState<Record<string, boolean>>({});
	const [oauthLoading, setOauthLoading] = useState<Record<string, boolean>>({});
	const [oauthInputs, setOAuthInputs] = useState<Record<string, string>>({});
	const [oauthErrors, setOAuthErrors] = useState<Record<string, string>>({});

	useEffect(() => {
		const storage = getAppStorage();
		Promise.all(providers.map(async (p) => ({
			provider: p,
			key: (await storage.providerKeys.get(p)) ?? "",
		}))).then((results) => {
			const map: Record<string, string> = {};
			for (const { provider, key } of results) map[provider] = key;
			setKeys(map);
		});
	}, [providers.join(",")]);

	useEffect(() => {
		const checkOAuth = async () => {
			const storage = getAppStorage();
			const status: Record<string, boolean> = {};
			for (const provider of providers) {
				if (provider === DIO_PROVIDER_ID) {
					status[provider] = !!(await storage.providerKeys.get(DIO_PROVIDER_ID));
					continue;
				}
				const oauthId = providerToOAuthId(provider);
				if (oauthId) {
					const creds = await loadOAuthCredentials(oauthId);
					status[provider] = !!creds;
				}
			}
			setOAuthStatus(status);
		};
		checkOAuth();
	}, [providers.join(",")]);

	useEffect(() => {
		const handler = (event: MessageEvent) => {
			if (event.data?.type !== "keating-oauth-result") return;
			const { success, provider: oauthProvider } = event.data;
			const providerNames = oauthProviderToProviderNames(oauthProvider);
			if (success && oauthProvider) {
				setOAuthStatus((prev) => setProviderAliases(prev, providerNames, true));
				setOAuthInputs((prev) => setProviderAliases(prev, providerNames, ""));
				setOAuthErrors((prev) => setProviderAliases(prev, providerNames, ""));
			} else if (providerNames.length > 0) {
				setOAuthErrors((prev) => setProviderAliases(prev, providerNames, event.data.error ?? "OAuth sign-in failed."));
			}
			setOauthLoading((prev) => {
				const next = { ...prev };
				for (const k of Object.keys(next)) next[k] = false;
				return next;
			});
		};
		window.addEventListener("message", handler);
		return () => window.removeEventListener("message", handler);
	}, []);

	const save = async (provider: string, value: string) => {
		const storage = getAppStorage();
		if (value.trim()) {
			await storage.providerKeys.set(provider, value.trim());
		} else {
			await storage.providerKeys.delete(provider);
		}
	};

	const handleSignIn = (provider: string) => {
		if (provider === DIO_PROVIDER_ID) {
			setOAuthErrors((prev) => ({ ...prev, [provider]: "" }));
			setOauthLoading((prev) => ({ ...prev, [provider]: true }));
			void promptDioAccess().then(async (success) => {
				const hasKey = !!(await getAppStorage().providerKeys.get(DIO_PROVIDER_ID));
				setOAuthStatus((prev) => ({ ...prev, [provider]: success || hasKey }));
				setOauthLoading((prev) => ({ ...prev, [provider]: false }));
				if (!success && !hasKey) {
					setOAuthErrors((prev) => ({ ...prev, [provider]: "Dio sign-in was not completed." }));
				}
			});
			return;
		}
		const oauthId = providerToOAuthId(provider);
		if (!oauthId) return;
		setOAuthErrors((prev) => ({ ...prev, [provider]: "" }));
		setOAuthInputs((prev) => ({ ...prev, [provider]: "" }));
		setOauthLoading((prev) => ({ ...prev, [provider]: true }));
		initiateOAuth(oauthId);
	};

	const handleCompleteOAuth = async (provider: string) => {
		const input = oauthInputs[provider]?.trim() ?? "";
		if (!input) {
			setOAuthErrors((prev) => ({ ...prev, [provider]: "Paste the callback URL or authorization code first." }));
			return;
		}
		setOauthLoading((prev) => ({ ...prev, [provider]: true }));
		setOAuthErrors((prev) => ({ ...prev, [provider]: "" }));
		const result = await completeOAuthFromInput(input);
		if (result.success && result.provider) {
			const statusProviders = oauthProviderToProviderNames(result.provider);
			setOAuthStatus((prev) => setProviderAliases(prev, statusProviders, true));
			setOAuthInputs((prev) => ({ ...prev, [provider]: "" }));
		} else {
			setOAuthErrors((prev) => ({ ...prev, [provider]: result.error ?? "OAuth sign-in failed." }));
		}
		setOauthLoading((prev) => ({ ...prev, [provider]: false }));
	};

	const handleSignOut = async (provider: string) => {
		if (provider === DIO_PROVIDER_ID) {
			const storage = getAppStorage();
			await storage.providerKeys.delete(DIO_PROVIDER_ID);
			setOAuthStatus((prev) => ({ ...prev, [provider]: false }));
			setKeys((prev) => ({ ...prev, [provider]: "" }));
			return;
		}
		const oauthId = providerToOAuthId(provider);
		if (!oauthId) return;
		await deleteOAuthCredentials(oauthId);
		const storage = getAppStorage();
		await storage.providerKeys.delete(provider);
		setOAuthStatus((prev) => ({ ...prev, [provider]: false }));
		setKeys((prev) => ({ ...prev, [provider]: "" }));
	};

	const OAUTH_PROVIDER_LABELS: Record<string, string> = {
		dio: "Dio (Kimi K2.6)",
		openai: "OpenAI Codex",
		anthropic: "Anthropic",
		"openai-codex": "OpenAI Codex",
		google: "Google Gemini",
	};

	return (
		<>
			{providers.map((provider) => {
				const oauthId = providerToOAuthId(provider);
				const isOAuth = !!oauthId || provider === DIO_PROVIDER_ID;
				const hasOAuth = oauthStatus[provider] === true;
				const loading = oauthLoading[provider] === true;

				if (isOAuth) {
					return (
						<div key={provider} className="flex flex-col gap-1">
							<div className="flex items-center justify-between gap-3">
								<label className="text-xs font-medium text-muted-foreground capitalize">
									{OAUTH_PROVIDER_LABELS[provider] ?? provider}
								</label>
								<a
									href={tutorialApiKeyHref(provider)}
									onClick={(event) => handleTutorialLinkClick(event.nativeEvent, tutorialApiKeyHref(provider))}
									className="text-xs text-primary underline underline-offset-2"
								>
									Get a key
								</a>
							</div>
							{hasOAuth ? (
								<div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 px-3 py-2">
									<span className="text-sm text-muted-foreground">Signed in</span>
									<button
										className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2"
										onClick={() => handleSignOut(provider)}
									>
										Sign out
									</button>
								</div>
							) : (
								<div className="flex flex-col gap-2">
									<button
										className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
										disabled={loading}
										onClick={() => handleSignIn(provider)}
									>
										{loading ? "Waiting for sign-in…" : `Sign in with ${OAUTH_PROVIDER_LABELS[provider] ?? provider}`}
									</button>
									{loading && (
										<div className="rounded-md border border-border bg-muted/20 p-2">
											<p className="mb-2 text-xs text-muted-foreground">
												If the provider redirects to a localhost callback that does not load, paste that final URL here.
											</p>
											<div className="flex gap-2">
												<input
													type="text"
													className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-xs"
													placeholder="Callback URL or authorization code"
													value={oauthInputs[provider] ?? ""}
													onChange={(e) => setOAuthInputs((prev) => ({ ...prev, [provider]: e.target.value }))}
												/>
												<button
													className="rounded-md border border-border px-2 py-1.5 text-xs font-medium hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-50"
													disabled={!oauthInputs[provider]?.trim()}
													onClick={() => handleCompleteOAuth(provider)}
												>
													Complete
												</button>
											</div>
										</div>
									)}
									{oauthErrors[provider] && (
										<div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
											{oauthErrors[provider]}
										</div>
									)}
								</div>
							)}
						</div>
					);
				}

				return (
					<div key={provider} className="flex flex-col gap-1">
						<div className="flex items-center justify-between gap-3">
							<label className="text-xs font-medium text-muted-foreground capitalize">{provider} API Key</label>
							<a
								href={tutorialApiKeyHref(provider)}
								onClick={(event) => handleTutorialLinkClick(event.nativeEvent, tutorialApiKeyHref(provider))}
								className="text-xs text-primary underline underline-offset-2"
							>
								Get a key
							</a>
						</div>
						<input
							type="password"
							className="rounded-md border border-border bg-background px-3 py-2 text-sm"
							placeholder={`${provider} API key`}
							value={keys[provider] ?? ""}
							onChange={(e) => setKeys((prev) => ({ ...prev, [provider]: e.target.value }))}
							onBlur={(e) => save(provider, e.target.value)}
						/>
					</div>
				);
			})}
		</>
	);
}

function oauthProviderToProviderNames(provider: OAuthProviderId | string | undefined): string[] {
	if (provider === "google-gemini-cli") return ["google"];
	if (provider === "openai-codex") return ["openai", "openai-codex"];
	if (provider === "anthropic") return ["anthropic"];
	return provider ? [provider] : [];
}

function setProviderAliases<T>(prev: Record<string, T>, providers: string[] | string, value: T): Record<string, T> {
	const next = { ...prev };
	for (const provider of Array.isArray(providers) ? providers : [providers]) {
		next[provider] = value;
	}
	return next;
}