import { useEffect, useState } from "react";
import { getAppStorage } from "@earendil-works/pi-web-ui";
import { KeyRound, X } from "lucide-react";
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
	resolve: (success: boolean) => void;
};

let activeDioPrompt: DioPromptRequest | null = null;

export function getActiveDioPrompt(): DioPromptRequest | null {
	return activeDioPrompt;
}

function emitDioPromptChange() {
	window.dispatchEvent(new CustomEvent("keating:dio-prompt-changed"));
}

export async function promptDioAccess(): Promise<boolean> {
	if (typeof window === "undefined") return false;
	if (!isDioFeatureEnabled()) return false;

	const existing = await getAppStorage().providerKeys.get(DIO_PROVIDER_ID);
	if (existing) return true;

	if (activeDioPrompt) {
		activeDioPrompt.resolve(false);
	}

	return new Promise((resolve) => {
		activeDioPrompt = {
			id: crypto.randomUUID(),
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
			const result = await startDioCheckout(normalized);
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
		<div className="fixed inset-0 z-[100] flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm">
			<div className="w-full max-w-md rounded-lg border border-border bg-background shadow-xl">
				<div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
					<div className="flex items-center gap-2">
						<KeyRound size={16} className="text-primary" />
						<h2 className="text-sm font-semibold">Dio access</h2>
					</div>
					<button
						type="button"
						className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
						onClick={() => closeDioPrompt(false)}
						aria-label="Close"
					>
						<X size={16} />
					</button>
				</div>
				<div className="space-y-3 p-4">
					{mode === "purchase" && (
						<>
							<p className="text-sm text-muted-foreground">
								Kimi K2.6 runs through Dio. Buy credits to get a Bifrost API key automatically.
							</p>
							<input
								type="email"
								className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
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
								<p className="text-xs text-muted-foreground">
									After completing checkout, you'll return here automatically with your key.
								</p>
							)}
							<div className="flex flex-wrap items-center justify-between gap-3">
								<button
									type="button"
									className="text-xs text-primary underline underline-offset-2"
									onClick={() => setMode("recover")}
								>
									Recover access by email
								</button>
								<div className="flex gap-2">
									{purchaseReference && (
										<button
											type="button"
											className="inline-flex h-9 items-center rounded-md bg-secondary px-3 text-sm font-medium hover:bg-secondary/80 disabled:opacity-50"
											onClick={doClaim}
											disabled={loading}
										>
											{loading ? "Claiming..." : "Claim"}
										</button>
									)}
									<button
										type="button"
										className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
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
							<p className="text-sm text-muted-foreground">
								Enter the email you used to buy Dio credits. We'll email you a verification code to restore your Bifrost key.
							</p>
							<input
								type="email"
								className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
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
									className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
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
								<div className="rounded-md border border-dashed border-yellow-500/50 bg-yellow-500/10 p-2 text-xs text-yellow-700 dark:text-yellow-400">
									Development code: <strong className="font-mono">{devCode}</strong>
								</div>
							)}
							<div className="flex flex-wrap items-center justify-between gap-3">
								<button
									type="button"
									className="text-xs text-primary underline underline-offset-2"
									onClick={() => setMode("purchase")}
								>
									Buy credits
								</button>
								<button
									type="button"
									className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
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
							<p className="text-sm text-muted-foreground">
								Paste a Bifrost virtual key manually. For development and support only.
							</p>
							<input
								type="password"
								className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
								placeholder="Dio virtual key"
								value={apiKey}
								onChange={(event) => setApiKey(event.target.value)}
								onKeyDown={(event) => {
									if (event.key === "Enter") void saveManualKey();
									if (event.key === "Escape") closeDioPrompt(false);
								}}
								autoFocus
							/>
							<div className="flex flex-wrap items-center justify-between gap-3">
								<button
									type="button"
									className="text-xs text-primary underline underline-offset-2"
									onClick={() => setMode("purchase")}
								>
									Back to purchase
								</button>
								<button
									type="button"
									className="inline-flex h-9 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
									onClick={saveManualKey}
									disabled={loading}
								>
									{loading ? "Saving..." : "Save key"}
								</button>
							</div>
						</>
					)}
					<div className="flex items-center justify-between">
						{mode !== "manual" && (
							<button
								type="button"
								className="text-xs text-muted-foreground underline underline-offset-2"
								onClick={() => setMode("manual")}
							>
								Advanced: paste key manually
							</button>
						)}
					</div>
					{error && <div className="text-xs text-destructive">{error}</div>}
				</div>
			</div>
		</div>
	);
}

function isValidEmail(email: string): boolean {
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
