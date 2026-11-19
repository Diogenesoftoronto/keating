import { Stat } from "../../design-system/charts";
import { useCallback, useEffect, useState } from "react";
import { Button, Card, Chip } from "../../design-system/kit";
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

	return <Card as="section" className="lr-card lr-credits" aria-labelledby="hosted-credits-heading">
		<header>
      <h2 id="hosted-credits-heading">Keating credits <Chip>all time</Chip></h2>
      <Button glyph="refresh" disabled={refreshing} onClick={() => void load()}>{refreshing ? "Refreshing…" : "Refresh"}</Button>
    </header>
    <div>
      {state.status !== "ready" && <p className="lr-caption">Your hosted-model balance and what recent requests cost. Credits are a balance to spend; they do not change your plan.</p>}
      {state.status === "loading" && <p className={styles.note} role="status">Loading your balance…</p>}
			{state.status === "error" && <p className={styles.alert} role="alert">Your balance and charges could not be loaded. This does not affect your credits. Use Refresh to try again.</p>}
			{state.status === "ready" && total && <>
				<div className="lr-balances">
					<Stat value={state.balance ?? "Unavailable"} label={state.balance ? "Available now" : "Balance could not be verified"}/>
					{!state.usageUnavailable && <Stat value={formatMicros(total.billedMicros)} label={`Charged across your last ${total.requests} ${total.requests === 1 ? "request" : "requests"}`}/>}
				</div>
				<p className="lr-caption">Your hosted-model balance and what recent requests cost. Credits are a balance to spend; they do not change your plan.</p>
        {state.usageUnavailable
					? <p className={styles.alert} role="alert">Recent charges could not be loaded. Your balance above is current. Use Refresh to try again.</p>
					: state.charges.length === 0
						? <p className={styles.note}>No hosted requests yet. Charges appear here after you use a Keating hosted model.</p>
						: <details><summary>Recent charges</summary><div className={styles.tableWrap}>
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
						</div></details>}
				{!state.usageUnavailable && state.charges.length >= RECENT_LIMIT && <p className={styles.note} style={{ marginTop: "0.75rem" }}>Showing your {RECENT_LIMIT} most recent requests. Older charges are not listed here.</p>}
			</>}
		</div>
	</Card>;
}
