import { Loading } from "../../design-system/kit";
import { useEffect, useState } from "react";
import { useModelPrefs } from "../../hooks/use-model-prefs";
import { useKeatingUiSettings } from "../../hooks/use-ui-settings";
import {
	desktopOfflineBridge,
	installedDesktopOfflineModels,
} from "../../lib/desktop-offline";
import { useImageAccess } from "./models/image-access";
export { useModelsAttention } from "./models/image-access";
import { loadHostedCredits } from "../usage/HostedCreditsPanel";
import { formatMicros, hostedChargeTotal } from "../../keating/usage-summary";
import { PROVIDER_CREDENTIALS_CHANGED_EVENT } from "../../keating/model-prefs";
import { StatusLine } from "./ui";
import { useCheckingChoice } from "./ModelRolesPanel";
import { KnowledgeSources } from "./KnowledgeSources";
import { WebSearchSection } from "./WebSearchSection";

/** Settings › Connections: the Connect sources experience (account, sources, tool permissions). */
export function Connections() {
	return (
		<div className="s2-pane" id="settings-section-knowledge-sources">
			<KnowledgeSources />
		</div>
	);
}

export function WebSearch() {
	const [settings, patch] = useKeatingUiSettings();
	return (
		<div className="s2-pane">
			<WebSearchSection settings={settings} onPatch={patch} />
		</div>
	);
}

/** Older mount: both panes together. Kept for stories and any external caller. */
export function SourcesAndSearch() {
	return (
		<>
			<Connections />
			<WebSearch />
		</>
	);
}

export function ModelsAside() {
	const [prefs] = useModelPrefs();
	const checking = useCheckingChoice();
	const { generator, ready } = useImageAccess();
	const [credit, setCredit] = useState<
		Awaited<ReturnType<typeof loadHostedCredits>>
	>({ status: "loading" });
	const [offline, setOffline] = useState<string[]>([]);
	useEffect(() => {
		let version = 0,
			active = true;
		async function refresh() {
			const current = ++version;
			const result = await loadHostedCredits().catch(() => ({
				status: "error" as const,
			}));
			if (current === version) setCredit(result);
		}
		const refreshOffline = () => {
			void installedDesktopOfflineModels().then((list) => {
				if (active) setOffline(list.map((m) => m.name));
			});
		};
		refreshOffline();
		const timer = desktopOfflineBridge()
			? setInterval(refreshOffline, 2500)
			: undefined;
		void refresh();
		window.addEventListener(PROVIDER_CREDENTIALS_CHANGED_EVENT, refresh);
		return () => {
			version++;
			active = false;
			clearInterval(timer);
			window.removeEventListener(PROVIDER_CREDENTIALS_CHANGED_EVENT, refresh);
		};
	}, []);
	const teaching = (prefs.defaultChatModelKey ?? prefs.recentModels[0]?.key)
		?.split("::")
		.at(-1);
	return (
		<div className="s2-aside k-halftone">
			<h4>Right now</h4>
			<StatusLine tone="idle">
				{teaching
					? teaching + " answers new chats."
					: "New chats use the most recent teaching model."}
			</StatusLine>
			<StatusLine tone="idle">
				{checking.backend === "off"
					? "Only built-in checks are enabled."
					: checking.backend === "local"
						? "Local reviews require verified calibration."
						: "Hosted reviews are selected for checking replies."}
			</StatusLine>
			{offline.map((name) => (
				<StatusLine key={name} tone="ok">
					Works offline with {name}.
				</StatusLine>
			))}
			{prefs.hiddenProviders.length > 0 && (
				<StatusLine tone="idle">
					Hidden from the picker: {prefs.hiddenProviders.join(", ")}.
				</StatusLine>
			)}
			<StatusLine tone={ready === false ? "warn" : "idle"}>
				{ready === false
					? generator?.needsBaseUrl
						? "Set a local endpoint and model for lesson pictures."
						: generator?.auth === "api-key"
							? generator.label + " needs a key for lesson pictures."
							: "Connect your account for lesson pictures."
					: "Lesson pictures use " +
						(generator?.label ?? "the selected generator") +
						"."}
			</StatusLine>
			<h4>Keating credits</h4>
			{credit.status === "ready" ? (
				<>
					<p>
						{credit.balance
							? credit.balance + " available"
							: "Balance unavailable"}
					</p>
					{!credit.usageUnavailable && credit.charges.length > 0 && (
						<p>
							{formatMicros(
								hostedChargeTotal(credit.charges.slice(0, 12)).billedMicros,
							)}{" "}
							across the last {Math.min(12, credit.charges.length)} requests.
						</p>
					)}
				</>
			) : credit.status === "error" ? (
				<p>Balance unavailable</p>
			) : credit.status === "signed-out" ? (
				<p>Connect your account to see your balance.</p>
			) : (
				<Loading size="inline" label="Checking credits" />
			)}
			<a href="/usage">See charges in Activity</a>
		</div>
	);
}
