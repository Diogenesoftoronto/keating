import { useEffect, useState } from "react";
import { KeyRound, X } from "lucide-react";
import { css, cx } from "../../styled-system/css";
import { iconButton, primaryButton } from "../../styled-system/recipes";
import {
	createNotOrganicCheckout,
	getNotOrganicAccount,
	getNotOrganicWallet,
	isNotOrganicFeatureEnabled,
	type NotOrganicAccount,
	type NotOrganicWallet,
} from "../notorganic-provider";
import {
	DEFAULT_NOTORGANIC_PACK_ID,
	getNotOrganicPack,
	type NotOrganicPackId,
} from "../notorganic-provider/packs";

type NotOrganicPromptRequest = {
	id: string;
	packId?: NotOrganicPackId;
	resolve: (success: boolean) => void;
};

let activePrompt: NotOrganicPromptRequest | null = null;

export function getActiveNotOrganicPrompt(): NotOrganicPromptRequest | null {
	return activePrompt;
}

function emitPromptChange() {
	window.dispatchEvent(new CustomEvent("keating:notorganic-prompt-changed"));
}

export async function hasNotOrganicProductSession(): Promise<boolean> {
	if (!isNotOrganicFeatureEnabled()) return false;
	try {
		await getNotOrganicAccount();
		return true;
	} catch {
		return false;
	}
}

export async function promptNotOrganicAccess(
	options: { packId?: NotOrganicPackId; force?: boolean } = {},
): Promise<boolean> {
	if (typeof window === "undefined" || !isNotOrganicFeatureEnabled()) return false;
	if (!options.force && !options.packId && await hasNotOrganicProductSession()) return true;

	activePrompt?.resolve(false);
	return new Promise((resolve) => {
		activePrompt = {
			id: crypto.randomUUID(),
			packId: options.packId,
			resolve,
		};
		emitPromptChange();
	});
}

export function closeNotOrganicPrompt(success: boolean) {
	if (!activePrompt) return;
	const request = activePrompt;
	activePrompt = null;
	request.resolve(success);
	emitPromptChange();
}

function accountSummary(account: NotOrganicAccount, wallet: NotOrganicWallet): string {
	const identity = account.did ?? account.id;
	const balance = typeof wallet.balance_microusd === "number"
		? `$${(wallet.balance_microusd / 1_000_000).toFixed(2)} available`
		: "wallet connected";
	return `${identity} · ${balance}`;
}

export function NotOrganicAccessPromptDialog() {
	const [request, setRequest] = useState(activePrompt);
	const [summary, setSummary] = useState("");
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");

	useEffect(() => {
		const sync = () => {
			setRequest(activePrompt);
			setSummary("");
			setError("");
			setLoading(false);
		};
		window.addEventListener("keating:notorganic-prompt-changed", sync);
		return () => window.removeEventListener("keating:notorganic-prompt-changed", sync);
	}, []);

	if (!request) return null;
	const pack = getNotOrganicPack(request.packId ?? DEFAULT_NOTORGANIC_PACK_ID);

	const refreshSession = async () => {
		setLoading(true);
		setError("");
		try {
			const [account, wallet] = await Promise.all([
				getNotOrganicAccount(),
				getNotOrganicWallet(),
			]);
			setSummary(accountSummary(account, wallet));
			if (!request.packId) closeNotOrganicPrompt(true);
		} catch (cause) {
			setSummary("");
			setError(cause instanceof Error ? cause.message : "Not Organic product session is unavailable.");
		} finally {
			setLoading(false);
		}
	};

	const openCheckout = async () => {
		if (!pack) return;
		setLoading(true);
		setError("");
		try {
			const returnUrl = new URL("/pricing?checkout=success", window.location.origin);
			const checkout = await createNotOrganicCheckout(pack.id, returnUrl.toString());
			const checkoutUrl = checkout.url ?? checkout.checkout_url;
			if (!checkoutUrl) throw new Error("Not Organic returned no checkout URL.");
			window.open(checkoutUrl, "_blank", "noopener,noreferrer");
			setSummary("Checkout opened. Your wallet updates after the provider confirms payment.");
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "Could not open Not Organic checkout.");
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
						<h2 className={css({ fontSize: "0.875rem", fontWeight: 600 })}>Not Organic access</h2>
					</div>
					<button
						type="button"
						className={cx(iconButton({ size: "md", tone: "ghost" }), css({ _hover: { color: "var(--foreground)" } }))}
						onClick={() => closeNotOrganicPrompt(false)}
						aria-label="Close"
					>
						<X size={16} />
					</button>
				</div>
				<div className={css({ display: "flex", flexDirection: "column", gap: "0.75rem", padding: "1rem" })}>
					<p className={css({ fontSize: "0.875rem", color: "var(--muted-foreground)" })}>
						Not Organic uses Keating&apos;s server-validated product session and shared wallet.
						No provider token or virtual key is stored in this browser.
					</p>
					{pack && request.packId && (
						<p className={css({ fontSize: "0.875rem" })}>
							Add <strong>${pack.priceUsd}</strong> in hosted inference credits.
						</p>
					)}
					{summary && <p className={css({ fontSize: "0.75rem" })}>{summary}</p>}
					{error && <p className={css({ fontSize: "0.75rem", color: "var(--destructive)" })}>{error}</p>}
					<div className={css({ display: "flex", justifyContent: "flex-end", gap: "0.5rem" })}>
						<button
							type="button"
							className={css({ display: "inline-flex", height: "2.25rem", alignItems: "center", borderRadius: "0.375rem", backgroundColor: "var(--secondary)", paddingInline: "0.75rem", fontSize: "0.875rem", fontWeight: 500, _disabled: { opacity: 0.5 } })}
							onClick={() => void refreshSession()}
							disabled={loading}
						>
							{loading ? "Checking…" : "Check session"}
						</button>
						{request.packId && (
							<button
								type="button"
								className={cx(primaryButton(), css({ paddingInline: "0.75rem" }))}
								onClick={() => void openCheckout()}
								disabled={loading}
							>
								{loading ? "Opening…" : "Continue to checkout"}
							</button>
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
