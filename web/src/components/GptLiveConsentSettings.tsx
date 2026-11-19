import { useEffect, useState } from "react";
import { notOrganicPublicClient } from "../notorganic-provider";
import { Button, Loading } from "../design-system/kit";
import { SettingRow, StatusLine } from "./settings/ui";

const CONSENT_PURPOSE = "portkey-realtime-content-logging";
const CONSENT_POLICY = "realtime-content-logging-v1";

export interface GptLiveConsent {
	purpose: typeof CONSENT_PURPOSE;
	policyVersion: typeof CONSENT_POLICY;
	granted: boolean;
	disclosure: string;
}

interface ConsentClient {
	request(path: string, init?: RequestInit): Promise<Response>;
}

/** Reading consent never creates it. Only an explicit boolean requests a change. */
export async function requestGptLiveConsent(
	granted?: boolean,
	client: ConsentClient | null = notOrganicPublicClient(),
): Promise<GptLiveConsent> {
	if (!client)
		throw new Error(
			"Connect Not Organic under Providers & Models to review live consent.",
		);
	const response = await client.request("/v1/realtime/consent", {
		method: granted === undefined ? "GET" : "POST",
		signal: AbortSignal.timeout(15_000),
		...(granted === undefined
			? {}
			: {
					headers: { "content-type": "application/json" },
					body: JSON.stringify({
						purpose: CONSENT_PURPOSE,
						policyVersion: CONSENT_POLICY,
						granted,
					}),
				}),
	});
	if (!response.ok) {
		if (response.status === 404 || response.status === 503)
			throw new Error(
				"Live consent is not available on this Not Organic deployment yet. Choose another live provider for now.",
			);
		if (response.status === 401 || response.status === 403)
			throw new Error(
				"Reconnect Not Organic under Providers & Models with live access to review consent.",
			);
		throw new Error(
			`Could not update live consent (${response.status}). Try again.`,
		);
	}
	const raw: unknown = await response.json();
	if (!raw || typeof raw !== "object" || Array.isArray(raw))
		throw new Error("Not Organic returned an invalid live consent response.");
	const record = raw as Record<string, unknown>;
	if (
		record.purpose !== CONSENT_PURPOSE ||
		record.policyVersion !== CONSENT_POLICY ||
		typeof record.granted !== "boolean" ||
		typeof record.disclosure !== "string" ||
		!record.disclosure.trim() ||
		record.disclosure.length > 8_000
	) {
		throw new Error(
			"The live consent policy has changed or is unavailable. Review it in your Not Organic account before starting.",
		);
	}
	return record as unknown as GptLiveConsent;
}

export function GptLiveConsentControls({
	consent,
	busy,
	error,
	onChange,
	onRefresh,
	id = "live-consent",
}: {
	id?: string;
	consent: GptLiveConsent | null;
	busy: boolean;
	error: string | null;
	onChange: (granted: boolean) => void;
	onRefresh: () => void;
}) {
	return (
		<SettingRow
			id={id}
			label="Live audio and content logging"
			scope="your account"
			help={
				consent?.disclosure ??
				"Review the account disclosure before approving live content logging."
			}
		>
			{busy && (
				<Loading
					size="inline"
					label={consent ? "Saving live consent" : "Checking live consent"}
				/>
			)}
			{consent && (
				<>
					<StatusLine tone={consent.granted ? "ok" : "warn"}>
						{consent.granted
							? "Live content logging is approved for this account."
							: "Live content logging has not been approved."}
					</StatusLine>
					<Button disabled={busy} onClick={() => onChange(!consent.granted)}>
						{consent.granted ? "Revoke" : "Approve"}
					</Button>
					{consent.granted && (
						<p>
							Revoking consent prevents new sessions. End any current call to
							stop sending audio.
						</p>
					)}
				</>
			)}
			{error && (
				<div role="alert">
					<p>{error}</p>
					<Button disabled={busy} onClick={onRefresh}>
						Check again
					</Button>
				</div>
			)}
		</SettingRow>
	);
}

export function GptLiveConsentSettings({
	onGrantedChange,
}: {
	onGrantedChange?: (granted: boolean) => void;
}) {
	const [consent, setConsent] = useState<GptLiveConsent | null>(null);
	const [busy, setBusy] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [refresh, setRefresh] = useState(0);
	useEffect(() => {
		let active = true;
		setBusy(true);
		setError(null);
		onGrantedChange?.(false);
		void requestGptLiveConsent()
			.then((next) => {
				if (!active) return;
				setConsent(next);
				onGrantedChange?.(next.granted);
			})
			.catch((cause: unknown) => {
				if (!active) return;
				setConsent(null);
				setError(
					cause instanceof Error
						? cause.message
						: "Could not read live consent.",
				);
			})
			.finally(() => {
				if (active) setBusy(false);
			});
		return () => {
			active = false;
		};
	}, [refresh, onGrantedChange]);
	const change = async (granted: boolean) => {
		if (!consent || busy) return;
		setBusy(true);
		setError(null);
		try {
			const next = await requestGptLiveConsent(granted);
			setConsent(next);
			onGrantedChange?.(next.granted);
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "Could not change live consent.",
			);
		} finally {
			setBusy(false);
		}
	};
	return (
		<GptLiveConsentControls
			id={onGrantedChange ? "live-call-consent" : "live-consent"}
			consent={consent}
			busy={busy}
			error={error}
			onChange={(granted) => {
				void change(granted);
			}}
			onRefresh={() => setRefresh((value) => value + 1)}
		/>
	);
}
