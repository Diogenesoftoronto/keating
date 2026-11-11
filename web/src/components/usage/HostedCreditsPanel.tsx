import { useCallback, useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { css } from "../../../styled-system/css";
import { PROVIDER_CREDENTIALS_CHANGED_EVENT } from "../../keating/model-prefs";
import { formatMicros, hostedChargeTotal, normalizeHostedUsage, type HostedCharge } from "../../keating/usage-summary";
import { getNotOrganicUsage, getNotOrganicWallet, notOrganicPublicClient } from "../../notorganic-provider";
import { formatCreditBalance, normalizeCreditWallet } from "../../notorganic-provider/credit-wallet";

const RECENT_LIMIT = 50;

type State =
	| { status: "loading" }
	| { status: "signed-out" }
	| { status: "error" }
	| { status: "ready"; balance: string | null; charges: HostedCharge[]; usageUnavailable: boolean };

export interface HostedCreditsSources {
	signedIn(): boolean;
	wallet(): Promise<unknown>;
	usage(limit: number): Promise<unknown>;
}

const defaultSources: HostedCreditsSources = {
	signedIn: () => { try { return Boolean(notOrganicPublicClient()?.getSession()); } catch { return false; } },
	wallet: () => getNotOrganicWallet(),
	usage: (limit) => getNotOrganicUsage({ limit }),
};

/** Balance and charges are read separately: a failed usage list must not hide a balance that loaded. */
export async function loadHostedCredits(sources: HostedCreditsSources = defaultSources): Promise<State> {
	if (!sources.signedIn()) return { status: "signed-out" };
	const [wallet, usage] = await Promise.allSettled([sources.wallet(), sources.usage(RECENT_LIMIT)]);
	let balance: string | null = null;
	if (wallet.status === "fulfilled") {
		try { balance = formatCreditBalance(normalizeCreditWallet(wallet.value).availableMicros); } catch { balance = null; }
	}
	if (balance === null && usage.status === "rejected") return { status: "error" };
	return {
		status: "ready",
		balance,
		charges: usage.status === "fulfilled" ? normalizeHostedUsage(usage.value) : [],
		usageUnavailable: usage.status === "rejected",
	};
}

const styles = {
	panel: css({ mt: "1.5rem", overflow: "hidden", border: "1px solid var(--ink)", bg: "var(--card)" }),
	header: css({ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "0.75rem", borderBottom: "1px solid var(--border)", px: "1rem", py: "0.75rem" }),
	title: css({ fontSize: "0.875rem", fontWeight: "600" }),
	subtitle: css({ mt: "0.25rem", fontSize: "0.75rem", color: "var(--muted-foreground)", lineHeight: "1.45" }),
	body: css({ p: "1rem" }),
	figures: css({ display: "flex", flexWrap: "wrap", gap: "1.5rem", mb: "1rem" }),
	figureValue: css({ fontSize: "1.25rem", fontWeight: "600", fontVariantNumeric: "tabular-nums" }),
	figureLabel: css({ fontSize: "0.75rem", color: "var(--muted-foreground)" }),
	button: css({ display: "inline-flex", alignItems: "center", gap: "0.4rem", minH: "2.5rem", px: "0.75rem", border: "1.5px solid var(--line)", borderRadius: "{radii.keating}", fontSize: "0.8125rem", cursor: "pointer", transitionProperty: "background-color, border-color", transitionDuration: "{durations.fast}", transitionTimingFunction: "{easings.standard}", _hover: { borderColor: "var(--ink)" }, _disabled: { opacity: 0.5, cursor: "default" }, _focusVisible: { outline: "3px solid var(--accent-dim)", outlineOffset: "2px" } }),
	tableWrap: css({ overflowX: "auto" }),
	table: css({ w: "100%", minW: "30rem", borderCollapse: "collapse", fontSize: "0.8125rem" }),
	th: css({ textAlign: "left", fontWeight: "600", px: "0.5rem", py: "0.4rem", borderBottom: "1px solid var(--border)", color: "var(--muted-foreground)", fontSize: "0.75rem" }),
	td: css({ px: "0.5rem", py: "0.45rem", borderBottom: "1px solid var(--border)", verticalAlign: "top", fontVariantNumeric: "tabular-nums" }),
	right: css({ textAlign: "right" }),
	note: css({ fontSize: "0.8125rem", color: "var(--muted-foreground)", lineHeight: "1.5" }),
	alert: css({ fontSize: "0.8125rem", color: "var(--destructive)", lineHeight: "1.5" }),
};

/** The gateway's request states, in plain words. An unfinished request has not been charged yet. */
function chargeStateLabel(state: string): string {
	switch (state) {
		case "succeeded": return "Not charged";
		case "failed": return "Failed, not charged";
		case "expired": return "Expired, not charged";
		case "reserved":
		case "running": return "In progress";
		default: return "Not charged";
	}
}

function when(at: number): string {
	return new Date(at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/**
 * Hosted (Not Organic) credits: what is left and what recent requests cost.
 * Shown only to signed-in learners. Spend on the learner's own provider keys
 * is covered by the estimate above and is not charged to this balance.
 */
export function HostedCreditsPanel({ sources = defaultSources }: { sources?: HostedCreditsSources }) {
	const [state, setState] = useState<State>({ status: "loading" });
	const [refreshing, setRefreshing] = useState(false);

	const load = useCallback(async () => {
		setRefreshing(true);
		try { setState(await loadHostedCredits(sources)); }
		catch { setState({ status: "error" }); }
		finally { setRefreshing(false); }
	}, [sources]);

	useEffect(() => {
		void load();
		window.addEventListener(PROVIDER_CREDENTIALS_CHANGED_EVENT, load);
		return () => window.removeEventListener(PROVIDER_CREDENTIALS_CHANGED_EVENT, load);
	}, [load]);

	if (state.status === "signed-out") return null;
	const total = state.status === "ready" ? hostedChargeTotal(state.charges) : null;

	return <section className={styles.panel} aria-labelledby="hosted-credits-heading">
		<div className={styles.header}>
			<div>
				<h2 id="hosted-credits-heading" className={styles.title}>Keating credits</h2>
				<p className={styles.subtitle}>Your hosted-model balance and what recent requests cost. Credits are a balance to spend; they do not change your plan.</p>
			</div>
			<button type="button" className={styles.button} disabled={refreshing} onClick={() => void load()}>
				<RefreshCw size={14} aria-hidden="true" /> {refreshing ? "Refreshing…" : "Refresh"}
			</button>
		</div>
		<div className={styles.body}>
			{state.status === "loading" && <p className={styles.note} role="status">Loading your balance…</p>}
			{state.status === "error" && <p className={styles.alert} role="alert">Your balance and charges could not be loaded. This does not affect your credits. Use Refresh to try again.</p>}
			{state.status === "ready" && total && <>
				<div className={styles.figures}>
					<div>
						<div className={styles.figureValue}>{state.balance ?? "Unavailable"}</div>
						<div className={styles.figureLabel}>{state.balance ? "Available now" : "Balance could not be verified"}</div>
					</div>
					{!state.usageUnavailable && <div>
						<div className={styles.figureValue}>{formatMicros(total.billedMicros)}</div>
						<div className={styles.figureLabel}>Charged across your last {total.requests} {total.requests === 1 ? "request" : "requests"}</div>
					</div>}
				</div>
				{state.usageUnavailable
					? <p className={styles.alert} role="alert">Recent charges could not be loaded. Your balance above is current. Use Refresh to try again.</p>
					: state.charges.length === 0
						? <p className={styles.note}>No hosted requests yet. Charges appear here after you use a Keating hosted model.</p>
						: <div className={styles.tableWrap}>
							<table className={styles.table}>
								<caption className={css({ srOnly: true })}>Your most recent hosted requests and what each was charged</caption>
								<thead><tr>
									<th scope="col" className={styles.th}>When</th>
									<th scope="col" className={styles.th}>Model</th>
									<th scope="col" className={styles.th}>For</th>
									<th scope="col" className={`${styles.th} ${styles.right}`}>Tokens in / out</th>
									<th scope="col" className={`${styles.th} ${styles.right}`}>Charged</th>
								</tr></thead>
								<tbody>
									{state.charges.map((charge) => <tr key={charge.id}>
										<td className={styles.td}>{when(charge.at)}</td>
										<td className={styles.td}>{charge.model}</td>
										<td className={styles.td}>{charge.feature ?? "—"}</td>
										<td className={`${styles.td} ${styles.right}`}>{charge.inputTokens.toLocaleString()} / {charge.outputTokens.toLocaleString()}</td>
										<td className={`${styles.td} ${styles.right}`}>{charge.billedMicros > 0 ? formatMicros(charge.billedMicros) : chargeStateLabel(charge.state)}</td>
									</tr>)}
								</tbody>
							</table>
						</div>}
				{!state.usageUnavailable && state.charges.length >= RECENT_LIMIT && <p className={styles.note} style={{ marginTop: "0.75rem" }}>Showing your {RECENT_LIMIT} most recent requests. Older charges are not listed here.</p>}
			</>}
		</div>
	</section>;
}
