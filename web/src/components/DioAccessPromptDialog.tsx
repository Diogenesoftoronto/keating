import { useEffect, useState } from "react";
import { getAppStorage } from "@earendil-works/pi-web-ui";
import { KeyRound, X } from "lucide-react";
import { css, cx } from "../../styled-system/css";
import { iconButton, primaryButton } from "../../styled-system/recipes";
import {
	DIO_PROVIDER_ID,
	claimDioAccess,
	isDioFeatureEnabled,
	recoverDioAccess,
	startDioCheckout,
	normalizeEmail,
	rememberDioIdentity,
} from "../dio-provider";

type DioPromptRequest = {
	id: string;
	packId?: string;
	resolve: (success: boolean) => void;
};

let activeDioPrompt: DioPromptRequest | null = null;

export function getActiveDioPrompt(): DioPromptRequest | null {
	return activeDioPrompt;
}

function emitDioPromptChange() {
	window.dispatchEvent(new CustomEvent("keating:dio-prompt-changed"));
}

export async function promptDioAccess(options?: { packId?: string }): Promise<boolean> {
	if (typeof window === "undefined") return false;
	if (!isDioFeatureEnabled()) return false;

	// Buying a specific pack must open checkout even when a key already exists
	// (top-ups add credits to the same key).
	if (!options?.packId) {
		const existing = await getAppStorage().providerKeys.get(DIO_PROVIDER_ID);
		if (existing) return true;
	}

	if (activeDioPrompt) {
		activeDioPrompt.resolve(false);
	}

	return new Promise((resolve) => {
		activeDioPrompt = {
			id: crypto.randomUUID(),
			packId: options?.packId,
			resolve,
		};
		emitDioPromptChange();
	});
}

export function closeDioPrompt(success: boolean) {
	if (!activeDioPrompt) return;
	const request = activeDioPrompt;
	activeDioPrompt = null;
	request.resolve(success);
	emitDioPromptChange();
}

const helperTextClass = css({ fontSize: "0.875rem", color: "var(--muted-foreground)" });
const smallHelperTextClass = css({ fontSize: "0.75rem", color: "var(--muted-foreground)" });
const linkButtonClass = css({ fontSize: "0.75rem", color: "var(--primary)", textDecoration: "underline", textUnderlineOffset: "2px" });
const mutedLinkButtonClass = css({ fontSize: "0.75rem", color: "var(--muted-foreground)", textDecoration: "underline", textUnderlineOffset: "2px" });
const errorTextClass = css({ fontSize: "0.75rem", color: "var(--destructive)" });

export function DioAccessPromptDialog() {
	const [request, setRequest] = useState(activeDioPrompt);
	const [email, setEmail] = useState("");
	const [mode, setMode] = useState<"purchase" | "recover" | "manual">("purchase");
	const [apiKey, setApiKey] = useState("");
	const [purchaseReference, setPurchaseReference] = useState("");
	const [otp, setOtp] = useState("");
	const [requiresOtp, setRequiresOtp] = useState(false);
	const [devCode, setDevCode] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");

	useEffect(() => {
		const sync = () => {
			setRequest(activeDioPrompt);
			setEmail("");
			setMode("purchase");
			setApiKey("");
			setPurchaseReference("");
			setOtp("");
			setRequiresOtp(false);
			setDevCode("");
			setError("");
			setLoading(false);
		};
		window.addEventListener("keating:dio-prompt-changed", sync);
		return () => window.removeEventListener("keating:dio-prompt-changed", sync);
	}, []);

	if (!request) return null;

	const saveManualKey = async () => {
		const trimmed = apiKey.trim();
		if (!trimmed) {
			setError("Enter an API key first.");
			return;
		}
		setLoading(true);
		setError("");
		try {
			await getAppStorage().providerKeys.set(DIO_PROVIDER_ID, trimmed);
			closeDioPrompt(true);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	};

	const doCheckout = async () => {
		const normalized = normalizeEmail(email);
		if (!isValidEmail(normalized)) {
			setError("Enter a valid email address.");
			return;
		}
		setLoading(true);
		setError("");
		try {
			const result = await startDioCheckout(normalized, request.packId);
			setPurchaseReference(result.purchaseReference);
			window.open(result.checkoutUrl, "_blank", "noopener,noreferrer");
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	};

	const doClaim = async () => {
		const normalized = normalizeEmail(email);
		if (!isValidEmail(normalized)) {
			setError("Enter a valid email address.");
			return;
		}
		setLoading(true);
		setError("");
		try {
			const result = await claimDioAccess(normalized, purchaseReference || undefined);
			if (result.success && result.apiKey) {
				await getAppStorage().providerKeys.set(DIO_PROVIDER_ID, result.apiKey);
				await rememberDioIdentity(normalized);
				closeDioPrompt(true);
			} else if (result.pending) {
				setError("Purchase is still pending. Complete payment and try again.");
			} else {
				setError("Could not find a completed purchase for this email.");
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	};

	const doRecover = async () => {
		const normalized = normalizeEmail(email);
		if (!isValidEmail(normalized)) {
			setError("Enter a valid email address.");
			return;
		}
		setLoading(true);
		setError("");
		try {
			const result = await recoverDioAccess(normalized, otp || undefined);
			if (result.success && result.apiKey) {
				await getAppStorage().providerKeys.set(DIO_PROVIDER_ID, result.apiKey);
				await rememberDioIdentity(normalized);
				closeDioPrompt(true);
			} else if (result.requiresOtp) {
				setRequiresOtp(true);
				setDevCode(result.devCode || "");
				setError(otp ? "Invalid or expired code." : "Enter the verification code sent to your email.");
			} else {
				setError("No active access found for this email.");
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	};

	return (
		<div className={css({ position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "color-mix(in srgb, var(--background) 70%, transparent)", padding: "1rem", backdropFilter: "blur(4px)" })}>
			<div className={css({ width: "100%", maxWidth: "28rem", borderRadius: "0.5rem", border: "1px solid var(--border)", backgroundColor: "var(--background)", boxShadow: "var(--shadow-xl)" })}>
				<div className={css({ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", borderBottom: "1px solid var(--border)", paddingInline: "1rem", paddingBlock: "0.75rem" })}>
					<div className={css({ display: "flex", alignItems: "center", gap: "0.5rem" })}>
						<KeyRound size={16} className={css({ color: "var(--primary)" })} />
						<h2 className={css({ fontSize: "0.875rem", fontWeight: 600 })}>Dio access</h2>
					</div>
					<button
						type="button"
						className={cx(iconButton({ size: "md", tone: "ghost" }), css({ _hover: { color: "var(--foreground)" } }))}
						onClick={() => closeDioPrompt(false)}
						aria-label="Close"
					>
						<X size={16} />
					</button>
				</div>
				<div className={css({ display: "flex", flexDirection: "column", gap: "0.75rem", padding: "1rem" })}>
					{mode === "purchase" && (
						<>
							<p className={helperTextClass}>
								Kimi K2.6 runs through Dio. Buy credits to get a Bifrost API key automatically.
							</p>
							<input
								type="email"
								className={css({ width: "100%", borderRadius: "0.375rem", border: "1px solid var(--border)", backgroundColor: "var(--background)", paddingInline: "0.75rem", paddingBlock: "0.5rem", fontSize: "0.875rem" })}
								placeholder="Your email address"
								value={email}
								onChange={(event) => setEmail(event.target.value)}
								onKeyDown={(event) => {
									if (event.key === "Enter") void doCheckout();
									if (event.key === "Escape") closeDioPrompt(false);
								}}
								autoFocus
							/>
							{purchaseReference && (
								<p className={smallHelperTextClass}>
									After completing checkout, you'll return here automatically with your key.
								</p>
							)}
							<div className={css({ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "0.75rem" })}>
								<button
									type="button"
									className={linkButtonClass}
									onClick={() => setMode("recover")}
								>
									Recover access by email
								</button>
								<div className={css({ display: "flex", gap: "0.5rem" })}>
									{purchaseReference && (
										<button
											type="button"
											className={css({ display: "inline-flex", height: "2.25rem", alignItems: "center", borderRadius: "0.375rem", backgroundColor: "var(--secondary)", paddingInline: "0.75rem", fontSize: "0.875rem", fontWeight: 500, transitionProperty: "color, background-color, border-color", transitionDuration: "150ms", _hover: { backgroundColor: "color-mix(in srgb, var(--secondary) 80%, black)" }, _disabled: { opacity: 0.5 } })}
											onClick={doClaim}
											disabled={loading}
										>
											{loading ? "Claiming..." : "Claim"}
										</button>
									)}
									<button
										type="button"
										className={cx(primaryButton(), css({ paddingInline: "0.75rem" }))}
										onClick={doCheckout}
										disabled={loading}
									>
										{loading
											? "Loading..."
											: purchaseReference
												? "Open checkout again"
												: "Buy credits"}
									</button>
								</div>
							</div>
						</>
					)}
					{mode === "recover" && (
						<>
							<p className={helperTextClass}>
								Enter the email you used to buy Dio credits. We'll email you a verification code to restore your Bifrost key.
							</p>
							<input
								type="email"
								className={css({ width: "100%", borderRadius: "0.375rem", border: "1px solid var(--border)", backgroundColor: "var(--background)", paddingInline: "0.75rem", paddingBlock: "0.5rem", fontSize: "0.875rem" })}
								placeholder="Your email address"
								value={email}
								onChange={(event) => {
									setEmail(event.target.value);
									setOtp("");
									setRequiresOtp(false);
								}}
								onKeyDown={(event) => {
									if (event.key === "Enter") void doRecover();
									if (event.key === "Escape") closeDioPrompt(false);
								}}
								autoFocus
							/>
							{requiresOtp && (
								<input
									type="text"
									inputMode="numeric"
									className={css({ width: "100%", borderRadius: "0.375rem", border: "1px solid var(--border)", backgroundColor: "var(--background)", paddingInline: "0.75rem", paddingBlock: "0.5rem", fontSize: "0.875rem" })}
									placeholder="Verification code"
									value={otp}
									onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))}
									onKeyDown={(event) => {
										if (event.key === "Enter") void doRecover();
										if (event.key === "Escape") closeDioPrompt(false);
									}}
									autoFocus
								/>
							)}
							{devCode && (
								<div className={css({ borderRadius: "0.375rem", border: "1px dashed color-mix(in srgb, #eab308 50%, transparent)", backgroundColor: "color-mix(in srgb, #eab308 10%, transparent)", padding: "0.5rem", fontSize: "0.75rem", color: "#a16207" })}>
									Development code: <strong className={css({ fontFamily: "var(--font-mono)" })}>{devCode}</strong>
								</div>
							)}
							<div className={css({ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "0.75rem" })}>
								<button
									type="button"
									className={linkButtonClass}
									onClick={() => setMode("purchase")}
								>
									Buy credits
								</button>
								<button
									type="button"
									className={cx(primaryButton(), css({ paddingInline: "0.75rem" }))}
									onClick={doRecover}
									disabled={loading}
								>
									{loading ? "Recovering..." : requiresOtp ? "Verify" : "Send code"}
								</button>
							</div>
						</>
					)}
					{mode === "manual" && (
						<>
							<p className={helperTextClass}>
								Paste a Bifrost virtual key manually. For development and support only.
							</p>
							<input
								type="password"
								className={css({ width: "100%", borderRadius: "0.375rem", border: "1px solid var(--border)", backgroundColor: "var(--background)", paddingInline: "0.75rem", paddingBlock: "0.5rem", fontSize: "0.875rem" })}
								placeholder="Dio virtual key"
								value={apiKey}
								onChange={(event) => setApiKey(event.target.value)}
								onKeyDown={(event) => {
									if (event.key === "Enter") void saveManualKey();
									if (event.key === "Escape") closeDioPrompt(false);
								}}
								autoFocus
							/>
							<div className={css({ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "0.75rem" })}>
								<button
									type="button"
									className={linkButtonClass}
									onClick={() => setMode("purchase")}
								>
									Back to purchase
								</button>
								<button
									type="button"
									className={cx(primaryButton(), css({ paddingInline: "0.75rem" }))}
									onClick={saveManualKey}
									disabled={loading}
								>
									{loading ? "Saving..." : "Save key"}
								</button>
							</div>
						</>
					)}
					<div className={css({ display: "flex", alignItems: "center", justifyContent: "space-between" })}>
						{mode !== "manual" && (
							<button
								type="button"
								className={mutedLinkButtonClass}
								onClick={() => setMode("manual")}
							>
								Advanced: paste key manually
							</button>
						)}
					</div>
					{error && <div className={errorTextClass}>{error}</div>}
				</div>
			</div>
		</div>
	);
}

function isValidEmail(email: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
