import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { KeyRound, X } from "lucide-react";
import { css, cx } from "../../styled-system/css";
import { iconButton, primaryButton } from "../../styled-system/recipes";
import {
	beginNotOrganicAuthorization,
	getNotOrganicAccount,
	getNotOrganicWallet,
	isNotOrganicFeatureEnabled,
	notOrganicPublicClient,
	type NotOrganicAccount,
	type NotOrganicWallet,
} from "../notorganic-provider";
import { formatCreditBalance, normalizeCreditWallet } from "../notorganic-provider/credit-wallet";
import { NotOrganicCreditRecovery } from "./NotOrganicCreditRecovery";
import {
	DEFAULT_NOTORGANIC_PACK_ID,
	getNotOrganicPack,
	type NotOrganicPack,
	type NotOrganicPackId,
} from "../notorganic-provider/packs";

type NotOrganicPromptRequest = {
	id: string;
	packId?: NotOrganicPackId;
	allowSignIn?: boolean;
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
	try {
		const client = notOrganicPublicClient();
		if (client) return client.getSession() !== null;
		if (!isNotOrganicFeatureEnabled()) return false;
		await getNotOrganicAccount();
		return true;
	} catch {
		return false;
	}
}

export async function promptNotOrganicAccess(
	options: { packId?: NotOrganicPackId; force?: boolean; allowSignIn?: boolean } = {},
): Promise<boolean> {
	if (typeof window === "undefined") return false;
	if (!isNotOrganicFeatureEnabled() && !(options.allowSignIn && !options.packId)) return false;
	if (!options.force && !options.packId && await hasNotOrganicProductSession()) return true;

	activePrompt?.resolve(false);
	return new Promise((resolve) => {
		activePrompt = {
			id: crypto.randomUUID(),
			packId: options.packId,
			allowSignIn: options.allowSignIn,
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
	const balance = `${formatCreditBalance(normalizeCreditWallet(wallet).availableMicros)} available`;
	return `${identity} · ${balance}`;
}

export interface NotOrganicAccessPanelProps {
	loading?: boolean;
	error?: string;
	summary?: string;
	connected?: boolean;
	pack?: NotOrganicPack;
	onConnect(): void;
	onDismiss(): void;
	onCheckout?(): void;
	creditContent?: ReactNode;
}

/** Native modal semantics keep keyboard focus here and make the page behind it inert. */
export function NotOrganicAccessPanel({ loading = false, error, summary, connected = false, pack, onConnect, onDismiss, onCheckout, creditContent }: NotOrganicAccessPanelProps) {
	const dialog = useRef<HTMLDialogElement>(null);
	const titleId = useId();
	const descriptionId = useId();
	// Capture before React mounts the autofocus button, not after it steals focus.
	const [priorFocus] = useState(() => typeof document !== "undefined" && document.activeElement instanceof HTMLElement ? document.activeElement : null);
	useEffect(() => {
		const element = dialog.current;
		element?.showModal();
		return () => {
			element?.close();
			if (priorFocus?.isConnected) priorFocus.focus();
		};
	}, [priorFocus]);

	return <dialog ref={dialog} aria-labelledby={titleId} aria-describedby={descriptionId}
		onCancel={event => { event.preventDefault(); onDismiss(); }}
		onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); onDismiss(); } }}
		className={css({ width: "calc(100% - 2rem)", maxWidth: "28rem", maxHeight: "calc(100dvh - 2rem)", margin: "auto", padding: 0, borderRadius: "0.5rem", border: "1px solid var(--border)", backgroundColor: "var(--background)", color: "var(--foreground)", boxShadow: "var(--shadow-xl)", overflowY: "auto", "&::backdrop": { backgroundColor: "color-mix(in srgb, var(--background) 70%, transparent)", backdropFilter: "blur(4px)" } })}>
		<header className={css({ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", padding: "1rem", borderBottom: "1px solid var(--border)" })}>
			<div className={css({ display: "flex", alignItems: "center", gap: "0.625rem" })}>
				<KeyRound size={20} aria-hidden="true" className={css({ color: "var(--primary)" })} />
				<h2 id={titleId} className={css({ fontSize: "1.125rem", fontWeight: 600 })}>{pack ? "Add Keating credits" : "Use Keating’s model"}</h2>
			</div>
			<button type="button" onClick={onDismiss} aria-label="Close account sign-in" className={cx(iconButton({ size: "md", tone: "ghost" }), css({ minWidth: "2.75rem", minHeight: "2.75rem" }))}><X size={18} aria-hidden="true" /></button>
		</header>
		{creditContent ? <div id={descriptionId} className={css({ padding: "0.75rem" })}>{creditContent}</div> : <div className={css({ display: "flex", flexDirection: "column", gap: "1rem", padding: "1.25rem" })}>
			<p id={descriptionId} className={css({ fontSize: "0.9375rem", lineHeight: 1.6 })}>{pack
				? <>Add <strong>${pack.priceUsd}</strong> in Keating credits with your Not Organic account.</>
				: <>Sign up or sign in to use <strong>Inkling Small</strong>, Keating’s default model. Your account is managed by Not Organic.</>}</p>
			{summary && <p role="status" className={css({ fontSize: "0.875rem", overflowWrap: "anywhere" })}>{summary}</p>}
			{error && <p role="alert" className={css({ fontSize: "0.875rem", color: "var(--destructive)", overflowWrap: "anywhere" })}>{error}</p>}
			<div className={css({ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: "0.75rem" })}>
				<button type="button" onClick={onDismiss} className={css({ minHeight: "2.75rem", paddingInline: "1rem", borderRadius: "0.375rem", border: "1px solid var(--border)", fontSize: "0.875rem", cursor: "pointer", _hover: { backgroundColor: "var(--secondary)" } })}>Not now</button>
				<button type="button" autoFocus className={cx(primaryButton(), css({ minHeight: "2.75rem", paddingInline: "1rem" }))} onClick={onConnect} disabled={loading}>
					{loading ? "Connecting…" : connected ? (pack ? "Refresh wallet" : "Continue") : "Sign up / Sign in"}
				</button>
				{pack && onCheckout && <button type="button" className={cx(primaryButton(), css({ minHeight: "2.75rem", paddingInline: "1rem" }))} onClick={onCheckout} disabled={loading}>Continue to checkout</button>}
			</div>
		</div>}
	</dialog>;
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
			const client = notOrganicPublicClient();
			if ((client && !client.getSession()) || (!client && request.allowSignIn)) {
				await beginNotOrganicAuthorization(window.location.pathname);
				return;
			}
			if (client && !request.packId) {
				closeNotOrganicPrompt(true);
				return;
			}
			const [account, wallet] = await Promise.all([
				getNotOrganicAccount(),
				getNotOrganicWallet(),
			]);
			if (activePrompt?.id === request.id) {
				setSummary(accountSummary(account, wallet));
				if (!request.packId) closeNotOrganicPrompt(true);
			}
		} catch (cause) {
			if (activePrompt?.id === request.id) {
				setSummary("");
				setError(cause instanceof Error ? cause.message : "Sign-in could not open. Please try again.");
			}
		} finally {
			if (activePrompt?.id === request.id) setLoading(false);
		}
	};

	let connected = false;
	try { connected = !!notOrganicPublicClient()?.getSession(); } catch { /* Unavailable storage is signed out. */ }
	return <NotOrganicAccessPanel key={request.id} pack={request.packId ? pack : undefined}
		connected={connected} loading={loading} summary={summary} error={error}
		creditContent={connected && request.packId ? <NotOrganicCreditRecovery initialPackId={request.packId} preserveMessage={false} onRetry={() => closeNotOrganicPrompt(true)} /> : undefined}
		onConnect={() => void refreshSession()}
		onDismiss={() => closeNotOrganicPrompt(false)} />;
}
