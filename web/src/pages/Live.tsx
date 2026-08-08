import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, Camera, Mic, MonitorUp, Settings2 } from "lucide-react";

import { Nav } from "../components/Nav";
import { AssistantChatPanel } from "../components/AssistantChatPanel";
import { css, cx } from "../../styled-system/css";
import { useKeatingAgent } from "../hooks/useKeatingAgent";
import { loadWebSpeechSettings, primeSpeechAudio, saveWebSpeechSettings } from "../keating/speech";
import { describeLiveModel, liveModelsFor, recommendedLiveModel } from "../keating/live-models";
import { getProviderApiKey } from "../lib/provider-models";
import { liveCredentialProvider } from "../components/live/use-live-session";
import { useSeo } from "../hooks/useSeo";

/**
 * /live — the pre-flight room for a live conversation.
 *
 * Live mode is not a separate product from chat, and the old page treated it as
 * one: its own session, its own transcript, its own copy of the connection
 * logic, and no way back into the conversation you were already having. Now the
 * conversation itself is owned by the chat panel and appears as a full-screen
 * surface over it, exactly as it does when you press the mic in the composer.
 *
 * What is left here is worth having as a page: somewhere to arrive from a link
 * or a bookmark, check that a key and a model are in place, choose whether the
 * camera starts on, and then step into the call. Everything after "start" is
 * the same code path as the composer button.
 */
export function Live() {
	useSeo({
		title: "Live with Keating",
		description: "Talk to Keating out loud, and show it what you are working on.",
	});

	const { chatPanelRef, dialogs } = useKeatingAgent();
	const [settings, setSettings] = useState(() => loadWebSpeechSettings());
	const [hasKey, setHasKey] = useState<boolean | null>(null);
	const [started, setStarted] = useState(false);

	const model = useMemo(
		() => describeLiveModel(settings.providerId, settings.model),
		[settings.providerId, settings.model],
	);
	const models = useMemo(() => liveModelsFor(settings.providerId), [settings.providerId]);
	const credentialProvider = liveCredentialProvider(settings.providerId);

	useEffect(() => {
		let cancelled = false;
		const check = () => {
			if (!credentialProvider) {
				setHasKey(false);
				return;
			}
			getProviderApiKey(credentialProvider)
				.then((key) => { if (!cancelled) setHasKey(Boolean(key)); })
				.catch(() => { if (!cancelled) setHasKey(false); });
		};
		check();
		window.addEventListener("keating:api-key-prompt-changed", check);
		return () => {
			cancelled = true;
			window.removeEventListener("keating:api-key-prompt-changed", check);
		};
	}, [credentialProvider]);

	const update = (patch: Partial<ReturnType<typeof loadWebSpeechSettings>>) => {
		const next = { ...loadWebSpeechSettings(), ...patch };
		saveWebSpeechSettings(next);
		setSettings(next);
	};

	const start = () => {
		// Unlock audio playback from this gesture; browsers will not let the
		// session do it later on its own.
		void primeSpeechAudio().catch(() => {});
		setStarted(true);
		window.dispatchEvent(new CustomEvent("keating:start-live"));
	};

	const providerName = settings.providerId === "openai-realtime" ? "OpenAI" : "Google";
	const notInCatalog = !models.some((entry) => entry.value === model.value);

	return (
		<div className={css({ minHeight: "100dvh", backgroundColor: "var(--background)", color: "var(--foreground)" })}>
			<Nav />

			{/*
			 * The chat panel is mounted but not shown: it owns the agent, the tool
			 * bridge, the live surface, and the transcript that a finished
			 * conversation is folded back into. Hiding it rather than skipping it is
			 * what makes /live a door into the same conversation instead of a
			 * parallel one.
			 */}
			<div aria-hidden="true" className={css({ display: "none" })}>
				<AssistantChatPanel ref={chatPanelRef} />
			</div>
			{dialogs}

			<main
				className={css({
					maxWidth: "34rem",
					marginInline: "auto",
					paddingInline: "1.25rem",
					paddingTop: "3rem",
					paddingBottom: "4rem",
					display: "flex",
					flexDirection: "column",
					gap: "1.5rem",
				})}
			>
				<div className={css({ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.75rem", textAlign: "center" })}>
					<img src="/brand/mascot-head.png" alt="" className={css({ width: "5.5rem", height: "auto" })} />
					<h1 className={css({ fontSize: "1.75rem", fontWeight: 700, lineHeight: 1.15 })}>Live with Keating</h1>
					<p className={css({ color: "var(--muted-foreground)", fontSize: "0.9375rem", maxWidth: "26rem" })}>
						Talk out loud and get answers out loud. Turn the camera on and Keating can look at what you are
						working on while you explain it.
					</p>
				</div>

				{hasKey === false ? (
					<div
						className={css({
							borderRadius: "0.875rem",
							border: "1px solid color-mix(in srgb, var(--destructive) 40%, transparent)",
							backgroundColor: "color-mix(in srgb, var(--destructive) 8%, var(--background))",
							padding: "1rem 1.125rem",
						})}
					>
						<p className={css({ fontWeight: 600, fontSize: "0.9375rem" })}>
							{credentialProvider ? `${providerName} key needed` : "No live provider selected"}
						</p>
						<p className={css({ fontSize: "0.875rem", color: "var(--muted-foreground)", marginTop: "0.25rem" })}>
							{credentialProvider
								? `Live mode talks to ${providerName} straight from this browser, and there is no key stored for it yet.`
								: "The current speech provider only synthesizes speech; it cannot hold a conversation."}
						</p>
						<button
							type="button"
							onClick={() => window.dispatchEvent(new CustomEvent("keating:open-settings", {
								detail: { tab: credentialProvider ? "models" : "learning" },
							}))}
							className={cx("dialog-compact-button", css({
								display: "inline-flex",
								alignItems: "center",
								gap: "0.375rem",
								marginTop: "0.75rem",
								borderRadius: "0.5rem",
								border: "1px solid var(--border)",
								paddingInline: "0.75rem",
								paddingBlock: "0.4375rem",
								fontSize: "0.8125rem",
								cursor: "pointer",
								_hover: { backgroundColor: "var(--accent)", color: "var(--accent-foreground)" },
							}))}
						>
							<Settings2 size={14} /> {credentialProvider ? "Add a key" : "Choose a live model"}
						</button>
					</div>
				) : null}

				<div
					className={css({
						borderRadius: "0.875rem",
						border: "1px solid var(--border)",
						backgroundColor: "color-mix(in srgb, var(--foreground) 3%, var(--background))",
						padding: "1rem 1.125rem",
						display: "flex",
						flexDirection: "column",
						gap: "0.875rem",
					})}
				>
					<label className={css({ display: "flex", flexDirection: "column", gap: "0.375rem" })}>
						<span className={css({ fontSize: "0.8125rem", fontWeight: 600 })}>Model</span>
						<select
							value={model.value}
							onChange={(event) => update({ model: event.target.value })}
							className={css({
								width: "100%",
								borderRadius: "0.5rem",
								border: "1px solid var(--border)",
								backgroundColor: "var(--background)",
								color: "var(--foreground)",
								paddingInline: "0.625rem",
								paddingBlock: "0.5rem",
								fontSize: "0.875rem",
							})}
						>
							{notInCatalog ? <option value={model.value}>{model.label}</option> : null}
							{models.map((entry) => (
								<option key={entry.value} value={entry.value}>
									{entry.label}
									{entry.grade === "recommended" ? " · recommended" : ""}
								</option>
							))}
						</select>
						{model.note ? (
							<span className={css({ fontSize: "0.75rem", color: "var(--muted-foreground)" })}>{model.note}</span>
						) : null}
					</label>

					<div className={css({ display: "flex", flexDirection: "column", gap: "0.5rem" })}>
						<span className={css({ fontSize: "0.8125rem", fontWeight: 600 })}>Start with</span>
						<div className={css({ display: "flex", flexWrap: "wrap", gap: "0.5rem" })}>
							<StartToggle
								icon={<Mic size={15} />}
								label="Voice"
								active
								disabled
								hint="Always on"
							/>
							<StartToggle
								icon={<Camera size={15} />}
								label="Camera"
								active={settings.videoEnabled && settings.videoSource === "camera"}
								disabled={model.video === "none"}
								hint={model.video === "none" ? "This model cannot see" : undefined}
								onClick={() => update(
									settings.videoEnabled && settings.videoSource === "camera"
										? { videoEnabled: false }
										: { videoEnabled: true, videoSource: "camera" },
								)}
							/>
							<StartToggle
								icon={<MonitorUp size={15} />}
								label="Screen"
								active={settings.videoEnabled && settings.videoSource === "screen"}
								disabled={model.video === "none"}
								hint={model.video === "none" ? "This model cannot see" : undefined}
								onClick={() => update(
									settings.videoEnabled && settings.videoSource === "screen"
										? { videoEnabled: false }
										: { videoEnabled: true, videoSource: "screen" },
								)}
							/>
						</div>
						<p className={css({ fontSize: "0.75rem", color: "var(--muted-foreground)" })}>
							{model.video === "none"
								? `Pick a model with vision — ${recommendedLiveModel(settings.providerId)?.label ?? "a newer live model"} can see your camera.`
								: "You can turn either on or off at any point during the conversation."}
						</p>
					</div>
				</div>

				<button
					type="button"
					onClick={start}
					disabled={started || hasKey === false}
					className={cx("dialog-compact-button", css({
						display: "inline-flex",
						alignItems: "center",
						justifyContent: "center",
						gap: "0.5rem",
						width: "100%",
						borderRadius: "9999px",
						border: "1px solid var(--primary)",
						backgroundColor: "var(--primary)",
						color: "var(--primary-foreground)",
						paddingBlock: "0.875rem",
						fontSize: "1rem",
						fontWeight: 600,
						cursor: "pointer",
						_disabled: { opacity: 0.5, cursor: "not-allowed" },
					}))}
				>
					<Mic size={18} /> {started ? "Connecting…" : "Start talking"}
				</button>

				<Link
					to="/chat"
					className={css({
						display: "inline-flex",
						alignItems: "center",
						justifyContent: "center",
						gap: "0.375rem",
						fontSize: "0.8125rem",
						color: "var(--muted-foreground)",
						_hover: { color: "var(--foreground)" },
					})}
				>
					<ArrowLeft size={14} /> Back to the conversation
				</Link>
			</main>
		</div>
	);
}

function StartToggle({
	icon,
	label,
	active,
	disabled,
	hint,
	onClick,
}: {
	icon: React.ReactNode;
	label: string;
	active?: boolean;
	disabled?: boolean;
	hint?: string;
	onClick?: () => void;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled}
			aria-pressed={active}
			title={hint}
			className={cx("dialog-compact-button", css({
				display: "inline-flex",
				alignItems: "center",
				gap: "0.4375rem",
				borderRadius: "9999px",
				border: "1px solid",
				borderColor: active ? "var(--primary)" : "var(--border)",
				backgroundColor: active ? "color-mix(in srgb, var(--primary) 14%, transparent)" : "transparent",
				color: active ? "var(--foreground)" : "var(--muted-foreground)",
				paddingInline: "0.875rem",
				paddingBlock: "0.5rem",
				fontSize: "0.8125rem",
				cursor: "pointer",
				_disabled: { opacity: 0.45, cursor: "not-allowed" },
			}))}
		>
			{icon} {label}
		</button>
	);
}

export default Live;
