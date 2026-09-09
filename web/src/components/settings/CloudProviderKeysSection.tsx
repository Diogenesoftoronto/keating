import { useCallback, useEffect, useRef, useState } from "react";
import { getAppStorage } from "../../keating/app-storage";
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
	type DeviceOAuthProviderId,
} from "../../keating/oauth";
import {
	beginNotOrganicAuthorization,
	getNotOrganicAccount,
	getNotOrganicWallet,
	NOTORGANIC_PROVIDER_ID,
	notOrganicPublicClient,
} from "../../notorganic-provider";
import { recordDiagnostic } from "../../lib/diagnostics";
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
	const [persistence, setPersistence] = useState<"encrypted" | "session" | null>(null);
	useEffect(() => {
		const bridge = window.keatingCredentials;
		if (!bridge?.status) return;
		let active = true;
		const refresh = () => void bridge.status!().then(status => { if (active) setPersistence(status.persistence); }).catch(() => { if (active) setPersistence(null); });
		refresh();
		window.addEventListener("focus", refresh);
		const interval = window.setInterval(refresh, 30_000);
		return () => { active = false; window.clearInterval(interval); window.removeEventListener("focus", refresh); };
	}, []);
	const storageDescription = typeof window !== "undefined" && window.keatingCredentials
		? persistence === "session"
			? "Your system keyring is unavailable. Sign-ins and keys stay in memory until you quit Keating; sign in again after restarting."
			: persistence === "encrypted"
				? "Sign-ins and API keys are encrypted using your system keyring."
				: "Sign-ins and API keys are managed by the desktop app."
		: "Cloud LLM providers with predefined models. API keys are stored locally in your browser.";
	return (
		<div id="settings-section-cloud-providers" className={sectionClass}>
			<div>
				<h3 className={titleClass}>Cloud Providers</h3>
				<p className={descriptionClass}>
					{storageDescription}
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
	const [keyErrors, setKeyErrors] = useState<Record<string, string>>({});
	const [oauthStatus, setOAuthStatus] = useState<Record<string, boolean>>({});
	const [oauthLoading, setOauthLoading] = useState<Record<string, boolean>>({});
	const [oauthAutomatic, setOAuthAutomatic] = useState<Record<string, boolean>>({});
	const [oauthInputs, setOAuthInputs] = useState<Record<string, string>>({});
	const [oauthErrors, setOAuthErrors] = useState<Record<string, string>>({});
	const [oauthDevices, setOAuthDevices] = useState<
		Record<string, { userCode: string; verificationUri: string; expiresAt: number } | undefined>
	>({});
	const [hostedSummary, setHostedSummary] = useState<string>("");
	const devicePollAbortRef = useRef<AbortController | null>(null);

	const finishDeviceSignIn = useCallback(async (provider: string, oauthProvider: DeviceOAuthProviderId) => {
		devicePollAbortRef.current?.abort();
		const controller = new AbortController();
		devicePollAbortRef.current = controller;
		const result = await completeOAuthDeviceFlow(oauthProvider, controller.signal);
		if (controller.signal.aborted) return;
		if (result.success && result.provider) {
			recordDiagnostic("info", "auth", "Provider sign-in completed", { provider: result.provider, method: "device-code" });
			const providerNames = oauthProviderToProviderNames(result.provider);
			setOAuthStatus((prev) => setProviderAliases(prev, providerNames, true));
			setOAuthErrors((prev) => setProviderAliases(prev, providerNames, ""));
		} else {
			recordDiagnostic("error", "auth", "Provider sign-in failed", { provider, method: "device-code" });
			setOAuthErrors((prev) => ({
				...prev,
				[provider]: result.error ?? "Sign-in failed. Please try again.",
			}));
		}
		setOAuthDevices((prev) => ({ ...prev, [provider]: undefined }));
		setOauthLoading((prev) => ({ ...prev, [provider]: false }));
		if (devicePollAbortRef.current === controller) devicePollAbortRef.current = null;
	}, []);

	useEffect(() => () => devicePollAbortRef.current?.abort(), []);

	useEffect(() => {
		const storage = getAppStorage();
		Promise.all(providers.map(async (p) => {
			try {
				return { provider: p, key: (await storage.providerKeys.get(p)) ?? "", error: "" };
			} catch (error) {
				return {
					provider: p,
					key: "",
					error: error instanceof Error ? error.message : "Secure credential storage is unavailable.",
				};
			}
		})).then((results) => {
			const map: Record<string, string> = {};
			const errors: Record<string, string> = {};
			for (const { provider, key, error } of results) {
				map[provider] = key;
				if (error) errors[provider] = error;
			}
			setKeys(map);
			setKeyErrors(errors);
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
		if (pending.flow !== "device-code") {
			setOAuthAutomatic(prev => setProviderAliases(prev, providerNames, pending.automatic));
			return;
		}

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
		const handleResult = (event: { data: { success: boolean; provider?: OAuthProviderId; error?: string } }) => {
			const { success, provider: oauthProvider } = event.data;
			const providerNames = oauthProviderToProviderNames(oauthProvider);
			if (success && oauthProvider) {
				recordDiagnostic("info", "auth", "Provider sign-in completed", { provider: oauthProvider, method: "browser-oauth" });
				setOAuthStatus((prev) => setProviderAliases(prev, providerNames, true));
				setOAuthInputs((prev) => setProviderAliases(prev, providerNames, ""));
				setOAuthErrors((prev) => setProviderAliases(prev, providerNames, ""));
			} else if (providerNames.length > 0) {
				recordDiagnostic("error", "auth", "Provider sign-in failed", { provider: oauthProvider ?? "unknown", method: "browser-oauth" });
				setOAuthErrors((prev) => setProviderAliases(prev, providerNames, event.data.error ?? "OAuth sign-in failed."));
			}
			setOauthLoading((prev) => {
				const next = { ...prev };
				for (const k of Object.keys(next)) next[k] = false;
				return next;
			});
		};
		const handler = (event: MessageEvent) => {
			if (event.origin !== window.location.origin || event.data?.type !== "keating-oauth-result") return;
			handleResult(event);
		};
		window.addEventListener("message", handler);
		return () => {
			window.removeEventListener("message", handler);
		};
	}, []);

	const save = async (provider: string, value: string) => {
		const storage = getAppStorage();
		try {
			if (value.trim()) {
				await storage.providerKeys.set(provider, value.trim());
			} else {
				await storage.providerKeys.delete(provider);
			}
			setKeyErrors((prev) => ({ ...prev, [provider]: "" }));
			recordDiagnostic("info", "auth", value.trim() ? "Provider API key saved" : "Provider API key removed", { provider, method: "api-key" });
		} catch (error) {
			recordDiagnostic("error", "auth", "Provider API key storage failed", { provider, method: "api-key" });
			setKeyErrors((prev) => ({
				...prev,
				[provider]: error instanceof Error ? error.message : "Secure credential storage is unavailable.",
			}));
		}
	};

	const handleSignIn = (provider: string, method?: "device-code" | "manual") => {
		recordDiagnostic("info", "auth", "Provider sign-in started", { provider, method: "subscription" });
		if (provider === NOTORGANIC_PROVIDER_ID) {
			setOAuthErrors((prev) => ({ ...prev, [provider]: "" }));
			setOauthLoading((prev) => ({ ...prev, [provider]: true }));
			if (!notOrganicPublicClient()?.getSession()) {
				void beginNotOrganicAuthorization(window.location.pathname)
					.catch((error) => {
						setOAuthErrors((prev) => ({ ...prev, [provider]: error instanceof Error ? error.message : "Not Organic sign-in could not start." }));
						setOauthLoading((prev) => ({ ...prev, [provider]: false }));
					});
				return;
			}
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
		devicePollAbortRef.current?.abort();
		setOAuthDevices({});
		setOAuthAutomatic({});
		setOauthLoading({ [provider]: true });
		void initiateOAuth(oauthId, { method })
			.then((initiation) => {
				if (initiation.flow !== "device-code") {
					setOAuthAutomatic(prev => ({ ...prev, [provider]: initiation.automatic }));
					return;
				}
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
				recordDiagnostic("error", "auth", "Provider sign-in could not start", { provider, method: "subscription" });
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
			recordDiagnostic("info", "auth", "Provider sign-in completed", { provider: result.provider, method: "manual-code" });
			const statusProviders = oauthProviderToProviderNames(result.provider);
			setOAuthStatus((prev) => setProviderAliases(prev, statusProviders, true));
			setOAuthInputs((prev) => setProviderAliases(prev, statusProviders, ""));
			setOAuthErrors((prev) => setProviderAliases(prev, statusProviders, ""));
			setOauthLoading((prev) => setProviderAliases(prev, statusProviders, false));
		} else {
			recordDiagnostic("error", "auth", "Provider sign-in failed", { provider, method: "manual-code" });
			setOAuthErrors((prev) => ({ ...prev, [provider]: result.error ?? "OAuth sign-in failed." }));
			setOauthLoading((prev) => ({ ...prev, [provider]: false }));
		}
	};

	const handlePasteOAuth = async (provider: string) => {
		const pending = getPendingOAuthRequest();
		try {
			const input = await navigator.clipboard.readText();
			// Clipboard permission can outlive a cancelled or restarted sign-in.
			const current = getPendingOAuthRequest();
			if (!pending || !current || pending.provider !== current.provider || pending.createdAt !== current.createdAt) return;
			setOAuthInputs((prev) => ({ ...prev, [provider]: input.trim() }));
			setOAuthErrors((prev) => ({ ...prev, [provider]: input.trim() ? "" : "Copy the authorization code from Claude first." }));
		} catch {
			setOAuthErrors((prev) => ({ ...prev, [provider]: "Clipboard access is unavailable. Paste the code into the field below." }));
		}
	};

	const handleSignOut = async (provider: string) => {
		if (provider === NOTORGANIC_PROVIDER_ID) {
			await notOrganicPublicClient()?.signOut();
			setOAuthStatus((prev) => ({ ...prev, [provider]: false }));
			setHostedSummary("");
			recordDiagnostic("info", "auth", "Provider signed out", { provider });
			return;
		}
		const oauthId = providerToOAuthId(provider);
		if (!oauthId) return;
		await deleteOAuthCredentials(oauthId);
		const storage = getAppStorage();
		await storage.providerKeys.delete(provider);
		setOAuthStatus((prev) => ({ ...prev, [provider]: false }));
		setKeys((prev) => ({ ...prev, [provider]: "" }));
		recordDiagnostic("info", "auth", "Provider signed out", { provider });
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
									Hosted sign-in uses a five-minute, device-bound Not Organic capability. The non-extractable DPoP key stays in this browser.
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
									{loading ? "Checking session…" : hasSession ? "Refresh account" : "Connect Not Organic"}
								</button>
								{hasSession && (
									<button className={smallButtonClass} type="button" onClick={() => void handleSignOut(provider)}>
										Sign out
									</button>
								)}
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
				const approvalName = oauthId === "openai-codex" ? "OpenAI" : "GitHub";
				const automatic = oauthAutomatic[provider] === true;

				if (isOAuth) {
					return (
						<div key={provider} className={providerStackClass}>
							<div className={labelRowClass}>
								<label className={labelClass}>
									{OAUTH_PROVIDER_LABELS[provider] ?? provider}
								</label>
								<span className={css({ fontSize: "0.75rem", color: "var(--muted-foreground)" })}>
									Subscription sign-in
								</span>
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
												? `Waiting for ${approvalName} approval…`
												: automatic ? "Waiting for browser approval…" : "Connecting…"
											: `Sign in with ${OAUTH_PROVIDER_LABELS[provider] ?? provider}`}
									</button>
									{loading && device && (
										<div className={css({ borderRadius: "0.375rem", border: "1px solid var(--border)", backgroundColor: "color-mix(in srgb, var(--muted) 20%, transparent)", padding: "0.75rem" })}>
											<p className={css({ fontSize: "0.75rem", color: "var(--muted-foreground)" })}>
												Enter this one-time code on {approvalName}’s page. Keating will connect automatically after you approve.
											</p>
											<div className={css({ marginTop: "0.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem" })}>
												<code aria-label="One-time sign-in code" className={css({ fontSize: "1rem", fontWeight: 700, letterSpacing: "0.08em", color: "var(--foreground)" })}>
													{device.userCode}
												</code>
												<button type="button" className={smallButtonClass} onClick={() => void navigator.clipboard.writeText(device.userCode).catch(() => setOAuthErrors(prev => ({ ...prev, [provider]: "Copy is unavailable. Select the code above to copy it." })))}>Copy code</button>
												<a href={device.verificationUri} target="_blank" rel="noreferrer" className={linkClass}>
													Open {approvalName}
												</a>
											</div>
											<button className={smallButtonClass} type="button" onClick={() => handleCancelOAuth(provider)}>
												Cancel and restart
											</button>
										</div>
									)}
									{loading && !device && (oauthId === "openai-codex" || automatic) && (
										<div className={css({ border: "1px solid var(--border)", borderRadius: "0.375rem", padding: "0.75rem", display: "grid", gap: "0.75rem" })}>
											<p role="status" className={descriptionClass}>{automatic ? "Approve sign-in in your browser. Keating will finish connecting automatically." : "Preparing sign-in…"}</p>
											<div className={css({ display: "flex", flexWrap: "wrap", gap: "0.75rem" })}>
												{oauthId === "openai-codex" && <button type="button" className={smallButtonClass} onClick={() => { handleCancelOAuth(provider); handleSignIn(provider, "device-code"); }}>Use a one-time code instead</button>}
												{oauthId !== "openai-codex" && <button type="button" className={smallButtonClass} onClick={() => { handleCancelOAuth(provider); handleSignIn(provider, "manual"); }}>Use an authorization code instead</button>}
												<button type="button" className={smallButtonClass} onClick={() => handleCancelOAuth(provider)}>Cancel</button>
											</div>
										</div>
									)}
									{loading && !device && !automatic && oauthId === "anthropic" && (
										<div className={css({ borderRadius: "0.375rem", border: "1px solid var(--border)", backgroundColor: "color-mix(in srgb, var(--muted) 20%, transparent)", padding: "0.5rem" })}>
											<p className={css({ marginBottom: "0.5rem", fontSize: "0.75rem", color: "var(--muted-foreground)" })}>
												Copy the authorization code from Claude, then paste it here to connect.
											</p>
											{(typeof window === "undefined" || !window.keatingDesktop) && <p className={descriptionClass}>Claude’s browser sign-in needs this code. Automatic return is available in the Keating desktop app.</p>}
											<div className={css({ display: "flex", flexWrap: "wrap", gap: "0.5rem" })}>
												<input
													type="text"
													className={css({ minWidth: 0, flex: 1, borderRadius: "0.375rem", border: "1px solid var(--border)", backgroundColor: "var(--background)", paddingInline: "0.5rem", paddingBlock: "0.375rem", fontSize: "0.75rem" })}
													aria-label="Authorization code" placeholder="Authorization code"
													value={oauthInputs[provider] ?? ""}
													onChange={(e) => setOAuthInputs((prev) => ({ ...prev, [provider]: e.target.value }))}
												/>
												{typeof navigator !== "undefined" && typeof navigator.clipboard?.readText === "function" && <button type="button" className={smallButtonClass} onClick={() => void handlePasteOAuth(provider)}>Paste code</button>}
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
									{!loading && oauthId === "anthropic" && oauthErrors[provider]?.includes("automatic return") && (
										<button type="button" className={smallButtonClass} onClick={() => handleSignIn(provider, "manual")}>Use authorization-code sign-in</button>
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
							onBlur={(e) => void save(provider, e.target.value)}
						/>
						{keyErrors[provider] && (
							<p role="alert" className={css({ fontSize: "0.75rem", color: "var(--destructive)" })}>
								{keyErrors[provider]} Your entered key remains in this field; restore OS credential storage and blur the field to retry.
							</p>
						)}
					</div>
				);
			})}
		</>
	);
}

function oauthProviderToProviderNames(provider: OAuthProviderId | string | undefined): string[] {
	if (provider === "openai-codex") return ["openai-codex"];
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
