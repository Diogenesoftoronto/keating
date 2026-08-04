import { useCallback, useEffect, useRef, useState } from "react";
import { getAppStorage } from "@earendil-works/pi-web-ui";
import { handleTutorialLinkClick, tutorialApiKeyHref } from "../../lib/tutorial-links";
import {
	completeOAuthFromInput,
	completeOAuthDeviceFlow,
	cancelPendingOAuthRequest,
	getPendingOAuthRequest,
	initiateOAuth,
	providerToOAuthId,
	loadOAuthCredentials,
	deleteOAuthCredentials,
	type OAuthProviderId,
} from "../../keating/oauth";
import {
	getNotOrganicAccount,
	getNotOrganicWallet,
	NOTORGANIC_PROVIDER_ID,
} from "../../notorganic-provider";
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
	const [oauthDevices, setOAuthDevices] = useState<
		Record<string, { userCode: string; verificationUri: string; expiresAt: number } | undefined>
	>({});
	const [hostedSummary, setHostedSummary] = useState<string>("");
	const devicePollAbortRef = useRef<AbortController | null>(null);

	const finishDeviceSignIn = useCallback(async (provider: string, oauthProvider: "github-copilot") => {
		devicePollAbortRef.current?.abort();
		const controller = new AbortController();
		devicePollAbortRef.current = controller;
		const result = await completeOAuthDeviceFlow(oauthProvider, controller.signal);
		if (controller.signal.aborted) return;
		if (result.success && result.provider) {
			const providerNames = oauthProviderToProviderNames(result.provider);
			setOAuthStatus((prev) => setProviderAliases(prev, providerNames, true));
			setOAuthErrors((prev) => setProviderAliases(prev, providerNames, ""));
		} else {
			setOAuthErrors((prev) => ({
				...prev,
				[provider]: result.error ?? "GitHub Copilot sign-in failed.",
			}));
		}
		setOAuthDevices((prev) => ({ ...prev, [provider]: undefined }));
		setOauthLoading((prev) => ({ ...prev, [provider]: false }));
		if (devicePollAbortRef.current === controller) devicePollAbortRef.current = null;
	}, []);

	useEffect(() => () => devicePollAbortRef.current?.abort(), []);

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
				if (provider === NOTORGANIC_PROVIDER_ID) {
					try {
						const [account, wallet] = await Promise.all([
							getNotOrganicAccount(),
							getNotOrganicWallet(),
						]);
						status[provider] = true;
						const balance = typeof wallet.balance_microusd === "number"
							? `$${(wallet.balance_microusd / 1_000_000).toFixed(2)} available`
							: "Wallet connected";
						setHostedSummary(`${account.did ?? account.id} · ${balance}`);
					} catch {
						status[provider] = false;
					}
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
		const pending = getPendingOAuthRequest();
		if (!pending) return;
		const providerNames = oauthProviderToProviderNames(pending.provider);
		setOauthLoading((prev) => setProviderAliases(prev, providerNames, true));
		setOAuthErrors((prev) => setProviderAliases(prev, providerNames, ""));
		if (pending.flow !== "device-code") return;

		const device = {
			userCode: pending.userCode,
			verificationUri: pending.verificationUri,
			expiresAt: pending.expiresAt,
		};
		setOAuthDevices((prev) => setProviderAliases(prev, providerNames, device));
		const provider = providerNames.find((name) => providers.includes(name)) ?? pending.provider;
		void finishDeviceSignIn(provider, pending.provider);
	}, [providers.join(","), finishDeviceSignIn]);

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
		if (provider === NOTORGANIC_PROVIDER_ID) {
			setOAuthErrors((prev) => ({ ...prev, [provider]: "" }));
			setOauthLoading((prev) => ({ ...prev, [provider]: true }));
			void Promise.all([getNotOrganicAccount(), getNotOrganicWallet()])
				.then(([account, wallet]) => {
					setOAuthStatus((prev) => ({ ...prev, [provider]: true }));
					const balance = typeof wallet.balance_microusd === "number"
						? `$${(wallet.balance_microusd / 1_000_000).toFixed(2)} available`
						: "Wallet connected";
					setHostedSummary(`${account.did ?? account.id} · ${balance}`);
				})
				.catch((error) => {
					setOAuthStatus((prev) => ({ ...prev, [provider]: false }));
					setOAuthErrors((prev) => ({
						...prev,
						[provider]: error instanceof Error
							? error.message
							: "The deployment-owned product session is unavailable.",
					}));
				})
				.finally(() => {
					setOauthLoading((prev) => ({ ...prev, [provider]: false }));
				});
			return;
		}
		const oauthId = providerToOAuthId(provider);
		if (!oauthId) return;
		setOAuthErrors((prev) => ({ ...prev, [provider]: "" }));
		setOAuthInputs((prev) => ({ ...prev, [provider]: "" }));
		setOauthLoading((prev) => ({ ...prev, [provider]: true }));
		void initiateOAuth(oauthId)
			.then((initiation) => {
				if (initiation.flow !== "device-code") return;
				setOAuthDevices((prev) => ({
					...prev,
					[provider]: {
						userCode: initiation.userCode,
						verificationUri: initiation.verificationUri,
						expiresAt: initiation.expiresAt,
					},
				}));
				void finishDeviceSignIn(provider, initiation.provider);
			})
			.catch((error) => {
				setOAuthErrors((prev) => ({
					...prev,
					[provider]: error instanceof Error ? error.message : "OAuth sign-in failed.",
				}));
				setOauthLoading((prev) => ({ ...prev, [provider]: false }));
			});
	};

	const handleCancelOAuth = (provider: string) => {
		devicePollAbortRef.current?.abort();
		devicePollAbortRef.current = null;
		cancelPendingOAuthRequest();
		const providerNames = oauthProviderToProviderNames(providerToOAuthId(provider) ?? provider);
		setOauthLoading((prev) => setProviderAliases(prev, providerNames, false));
		setOAuthInputs((prev) => setProviderAliases(prev, providerNames, ""));
		setOAuthDevices((prev) => setProviderAliases(prev, providerNames, undefined));
		setOAuthErrors((prev) => setProviderAliases(prev, providerNames, ""));
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
			setOAuthInputs((prev) => setProviderAliases(prev, statusProviders, ""));
			setOAuthErrors((prev) => setProviderAliases(prev, statusProviders, ""));
			setOauthLoading((prev) => setProviderAliases(prev, statusProviders, false));
		} else {
			setOAuthErrors((prev) => ({ ...prev, [provider]: result.error ?? "OAuth sign-in failed." }));
			setOauthLoading((prev) => ({ ...prev, [provider]: false }));
		}
	};

	const handleSignOut = async (provider: string) => {
		const oauthId = providerToOAuthId(provider);
		if (!oauthId) return;
		await deleteOAuthCredentials(oauthId);
		const storage = getAppStorage();
		await storage.providerKeys.delete(provider);
		setOAuthStatus((prev) => ({ ...prev, [provider]: false }));
		setKeys((prev) => ({ ...prev, [provider]: "" }));
	};

	const OAUTH_PROVIDER_LABELS: Record<string, string> = {
		notorganic: "Not Organic Hosted",
		openai: "OpenAI Codex",
		anthropic: "Anthropic",
		"openai-codex": "OpenAI Codex",
		"github-copilot": "GitHub Copilot",
		google: "Google Gemini",
	};

	return (
		<>
			{providers.map((provider) => {
				const oauthId = providerToOAuthId(provider);
				if (provider === NOTORGANIC_PROVIDER_ID) {
					const hasSession = oauthStatus[provider] === true;
					const loading = oauthLoading[provider] === true;
					return (
						<div key={provider} className={providerStackClass}>
							<div className={labelRowClass}>
								<label className={labelClass}>Not Organic Hosted</label>
								<span className={css({ fontSize: "0.75rem", color: "var(--muted-foreground)" })}>
									Balanced routing
								</span>
							</div>
							<div className={css({ borderRadius: "0.375rem", border: "1px solid var(--border)", backgroundColor: "color-mix(in srgb, var(--muted) 20%, transparent)", padding: "0.75rem" })}>
								<p className={css({ fontSize: "0.75rem", color: "var(--muted-foreground)" })}>
									Hosted sign-in is owned by Keating&apos;s server session. Browser DID and email values are never treated as authentication.
								</p>
								{hasSession && hostedSummary && (
									<p className={css({ marginTop: "0.5rem", fontSize: "0.75rem", color: "var(--foreground)" })}>
										{hostedSummary}
									</p>
								)}
								<button
									className={smallButtonClass}
									disabled={loading}
									onClick={() => handleSignIn(provider)}
								>
									{loading ? "Checking session…" : hasSession ? "Refresh account" : "Check product session"}
								</button>
								{oauthErrors[provider] && (
									<p className={css({ marginTop: "0.5rem", fontSize: "0.75rem", color: "var(--destructive)" })}>
										{oauthErrors[provider]}
									</p>
								)}
							</div>
						</div>
					);
				}
				const isOAuth = !!oauthId;
				const hasOAuth = oauthStatus[provider] === true;
				const loading = oauthLoading[provider] === true;
				const device = oauthDevices[provider];

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
										{loading
											? device
												? "Waiting for GitHub approval…"
												: "Finish sign-in below"
											: `Sign in with ${OAUTH_PROVIDER_LABELS[provider] ?? provider}`}
									</button>
									{loading && device && (
										<div className={css({ borderRadius: "0.375rem", border: "1px solid var(--border)", backgroundColor: "color-mix(in srgb, var(--muted) 20%, transparent)", padding: "0.75rem" })}>
											<p className={css({ fontSize: "0.75rem", color: "var(--muted-foreground)" })}>
												Enter this one-time code in the GitHub window. Keating will finish connecting after GitHub approves your Copilot subscription.
											</p>
											<div className={css({ marginTop: "0.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem" })}>
												<code className={css({ fontSize: "1rem", fontWeight: 700, letterSpacing: "0.08em", color: "var(--foreground)" })}>
													{device.userCode}
												</code>
												<a href={device.verificationUri} target="_blank" rel="noreferrer" className={linkClass}>
													Open GitHub
												</a>
											</div>
											<button className={smallButtonClass} type="button" onClick={() => handleCancelOAuth(provider)}>
												Cancel and restart
											</button>
										</div>
									)}
									{loading && !device && oauthId !== "github-copilot" && (
										<div className={css({ borderRadius: "0.375rem", border: "1px solid var(--border)", backgroundColor: "color-mix(in srgb, var(--muted) 20%, transparent)", padding: "0.5rem" })}>
											<p className={css({ marginBottom: "0.5rem", fontSize: "0.75rem", color: "var(--muted-foreground)" })}>
												{oauthId === "anthropic"
													? "After approval, Claude displays an authorization code. Copy it, return to this Keating tab, paste it below, and choose Complete."
													: "The localhost error page after approval is expected. Copy its full URL, return to this Keating tab, paste it below, and choose Complete."}
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
										<button className={smallButtonClass} type="button" onClick={() => handleCancelOAuth(provider)}>
											Cancel
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
	if (provider === "openai-codex") return ["openai", "openai-codex"];
	if (provider === "anthropic") return ["anthropic"];
	if (provider === "github-copilot") return ["github-copilot"];
	return provider ? [provider] : [];
}

function setProviderAliases<T>(prev: Record<string, T>, providers: string[] | string, value: T): Record<string, T> {
	const next = { ...prev };
	for (const provider of Array.isArray(providers) ? providers : [providers]) {
		next[provider] = value;
	}
	return next;
}
