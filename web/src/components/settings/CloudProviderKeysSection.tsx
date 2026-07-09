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
	OAUTH_MESSAGE_CHANNEL,
	type OAuthProviderId,
} from "../../keating/oauth";
import { DIO_PROVIDER_ID } from "../../dio-provider";
import { css } from "../../../styled-system/css";

const sectionClass = css({ display: "flex", flexDirection: "column", gap: "1rem", scrollMarginTop: "5rem" });
const titleClass = css({ marginBottom: "0.5rem", fontSize: "0.875rem", fontWeight: 600, color: "var(--foreground)" });
const descriptionClass = css({ fontSize: "0.875rem", color: "var(--muted-foreground)" });
const providerStackClass = css({ display: "flex", flexDirection: "column", gap: "0.25rem" });
const labelRowClass = css({ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem" });
const labelClass = css({ fontSize: "0.75rem", fontWeight: 500, color: "var(--muted-foreground)", textTransform: "capitalize" });
const linkClass = css({ fontSize: "0.75rem", color: "var(--primary)", textDecoration: "underline", textUnderlineOffset: "2px" });
const inputClass = css({
	borderRadius: "0.375rem",
	border: "1px solid var(--border)",
	backgroundColor: "var(--background)",
	paddingInline: "0.75rem",
	paddingBlock: "0.5rem",
	fontSize: "0.875rem",
	color: "var(--foreground)",
});
const primaryButtonClass = css({
	display: "inline-flex",
	alignItems: "center",
	justifyContent: "center",
	borderRadius: "0.375rem",
	backgroundColor: "var(--primary)",
	paddingInline: "0.75rem",
	paddingBlock: "0.5rem",
	fontSize: "0.875rem",
	fontWeight: 500,
	color: "var(--primary-foreground)",
	transitionProperty: "color, background-color",
	transitionDuration: "150ms",
	_hover: { backgroundColor: "color-mix(in srgb, var(--primary) 90%, transparent)" },
	_disabled: { opacity: 0.5 },
});
const smallButtonClass = css({
	borderRadius: "0.375rem",
	border: "1px solid var(--border)",
	paddingInline: "0.5rem",
	paddingBlock: "0.375rem",
	fontSize: "0.75rem",
	fontWeight: 500,
	transitionProperty: "color, background-color",
	transitionDuration: "150ms",
	_hover: { backgroundColor: "var(--accent)", color: "var(--accent-foreground)" },
	_disabled: { opacity: 0.5 },
});

export function CloudProviderKeysSection({ providers }: { providers: string[] }) {
	return (
		<div id="settings-section-cloud-providers" className={sectionClass}>
			<div>
				<h3 className={titleClass}>Cloud Providers</h3>
				<p className={descriptionClass}>
					Cloud LLM providers with predefined models. API keys are stored locally in your browser.
				</p>
			</div>
			<div className={css({ display: "flex", flexDirection: "column", gap: "0.75rem" })}>
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
		const handler = (event: MessageEvent | { data: unknown }) => {
			if ((event.data as any)?.type !== OAUTH_MESSAGE_CHANNEL) return;
			const { success, provider: oauthProvider } = event.data as any;
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
		let channel: BroadcastChannel | undefined;
		try {
			channel = new BroadcastChannel(OAUTH_MESSAGE_CHANNEL);
			channel.addEventListener("message", handler);
		} catch {}
		return () => {
			window.removeEventListener("message", handler);
			channel?.close();
		};
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
		"google-gemini-cli": "Google Gemini CLI",
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
						<div key={provider} className={providerStackClass}>
							<div className={labelRowClass}>
								<label className={labelClass}>
									{OAUTH_PROVIDER_LABELS[provider] ?? provider}
								</label>
								<a
									href={tutorialApiKeyHref(provider)}
									onClick={(event) => handleTutorialLinkClick(event.nativeEvent, tutorialApiKeyHref(provider))}
									className={linkClass}
								>
									Get a key
								</a>
							</div>
							{hasOAuth ? (
								<div className={css({ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", borderRadius: "0.375rem", border: "1px solid var(--border)", backgroundColor: "color-mix(in srgb, var(--muted) 30%, transparent)", paddingInline: "0.75rem", paddingBlock: "0.5rem" })}>
									<span className={css({ fontSize: "0.875rem", color: "var(--muted-foreground)" })}>Signed in</span>
									<button
										className={css({ fontSize: "0.75rem", color: "var(--muted-foreground)", textDecoration: "underline", textUnderlineOffset: "2px", _hover: { color: "var(--foreground)" } })}
										onClick={() => handleSignOut(provider)}
									>
										Sign out
									</button>
								</div>
							) : (
								<div className={css({ display: "flex", flexDirection: "column", gap: "0.5rem" })}>
									<button
										className={primaryButtonClass}
										disabled={loading}
										onClick={() => handleSignIn(provider)}
									>
										{loading ? "Waiting for sign-in…" : `Sign in with ${OAUTH_PROVIDER_LABELS[provider] ?? provider}`}
									</button>
									{loading && (
										<div className={css({ borderRadius: "0.375rem", border: "1px solid var(--border)", backgroundColor: "color-mix(in srgb, var(--muted) 20%, transparent)", padding: "0.5rem" })}>
											<p className={css({ marginBottom: "0.5rem", fontSize: "0.75rem", color: "var(--muted-foreground)" })}>
												After you approve access, the browser lands on a localhost page that won&apos;t load — that&apos;s expected. Copy that page&apos;s full URL (or the code it shows) and paste it here.
											</p>
											<div className={css({ display: "flex", gap: "0.5rem" })}>
												<input
													type="text"
													className={css({ minWidth: 0, flex: 1, borderRadius: "0.375rem", border: "1px solid var(--border)", backgroundColor: "var(--background)", paddingInline: "0.5rem", paddingBlock: "0.375rem", fontSize: "0.75rem" })}
													placeholder="Callback URL or authorization code"
													value={oauthInputs[provider] ?? ""}
													onChange={(e) => setOAuthInputs((prev) => ({ ...prev, [provider]: e.target.value }))}
												/>
												<button
													className={smallButtonClass}
													disabled={!oauthInputs[provider]?.trim()}
													onClick={() => handleCompleteOAuth(provider)}
												>
													Complete
												</button>
											</div>
										</div>
									)}
									{oauthErrors[provider] && (
										<div className={css({ borderRadius: "0.375rem", border: "1px solid color-mix(in srgb, var(--destructive) 30%, transparent)", backgroundColor: "color-mix(in srgb, var(--destructive) 5%, transparent)", paddingInline: "0.75rem", paddingBlock: "0.5rem", fontSize: "0.75rem", color: "var(--destructive)" })}>
											{oauthErrors[provider]}
										</div>
									)}
								</div>
							)}
						</div>
					);
				}

				return (
					<div key={provider} className={providerStackClass}>
						<div className={labelRowClass}>
							<label className={labelClass}>{provider} API Key</label>
							<a
								href={tutorialApiKeyHref(provider)}
								onClick={(event) => handleTutorialLinkClick(event.nativeEvent, tutorialApiKeyHref(provider))}
								className={linkClass}
							>
								Get a key
							</a>
						</div>
						<input
							type="password"
							className={inputClass}
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
	if (provider === "google-gemini-cli") return ["google", "google-gemini-cli"];
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
