import { useCallback, useState } from "react";
import { loadKeatingUiSettings, saveKeatingUiSettings, type ReasoningLevel } from "../keating/ui-settings";

const REASONING_LEVELS: { value: ReasoningLevel; label: string; description: string }[] = [
	{ value: "off", label: "Off", description: "Fastest responses, no reasoning tokens" },
	{ value: "minimal", label: "Minimal", description: "Brief internal checks" },
	{ value: "low", label: "Low", description: "Light reasoning for simple tasks" },
	{ value: "medium", label: "Medium", description: "Balanced depth and speed" },
	{ value: "high", label: "High", description: "Deeper analysis for complex questions" },
	{ value: "xhigh", label: "Maximum", description: "Most thorough reasoning (select models only)" },
];

export function KeatingUiSettingsTabReact() {
	const [settings, setSettings] = useState(() => loadKeatingUiSettings());

	const update = useCallback((partial: Partial<typeof settings>) => {
		const next = { ...loadKeatingUiSettings(), ...partial };
		setSettings(next);
		saveKeatingUiSettings(next);
	}, []);

	return (
		<div className="flex flex-col gap-6">
			<div>
				<h3 className="text-sm font-semibold text-foreground mb-2">Chat Interface</h3>
				<p className="text-sm text-muted-foreground">
					Control how much internal agent activity appears in the conversation.
				</p>
			</div>

			<div className="flex items-start justify-between gap-4 rounded-lg border border-border p-4">
				<div>
					<div className="text-sm font-medium text-foreground">Show tool details</div>
					<p className="mt-1 text-sm text-muted-foreground">
						Show tool arguments and results inside chat messages. Compact status remains visible when this is off.
					</p>
				</div>
				<label className="relative inline-flex cursor-pointer items-center">
					<input
						type="checkbox"
						className="sr-only peer"
						checked={settings.showToolUi}
						onChange={(e) => update({ showToolUi: e.target.checked })}
					/>
					<div className="h-5 w-9 rounded-full bg-muted-foreground/30 peer-checked:bg-primary transition-colors after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-4" />
				</label>
			</div>

			<div className="flex items-start justify-between gap-4 rounded-lg border border-border p-4">
				<div>
					<div className="text-sm font-medium text-foreground">Show raw error details</div>
					<p className="mt-1 text-sm text-muted-foreground">
						Display full error messages and response bodies in tool failures. When off, only a short summary is shown.
					</p>
				</div>
				<label className="relative inline-flex cursor-pointer items-center">
					<input
						type="checkbox"
						className="sr-only peer"
						checked={settings.showRawErrors}
						onChange={(e) => update({ showRawErrors: e.target.checked })}
					/>
					<div className="h-5 w-9 rounded-full bg-muted-foreground/30 peer-checked:bg-primary transition-colors after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-4" />
				</label>
			</div>

			<div className="flex items-start justify-between gap-4 rounded-lg border border-border p-4">
				<div>
					<div className="text-sm font-medium text-foreground">Open artifacts automatically</div>
					<p className="mt-1 text-sm text-muted-foreground">
						Open the artifact side panel when Keating creates a plan, map, animation, benchmark, or evolution.
					</p>
				</div>
				<label className="relative inline-flex cursor-pointer items-center">
					<input
						type="checkbox"
						className="sr-only peer"
						checked={settings.autoOpenArtifacts}
						onChange={(e) => update({ autoOpenArtifacts: e.target.checked })}
					/>
					<div className="h-5 w-9 rounded-full bg-muted-foreground/30 peer-checked:bg-primary transition-colors after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-4" />
				</label>
			</div>

			<div>
				<h3 className="text-sm font-semibold text-foreground mb-2">Reasoning Level</h3>
				<p className="text-sm text-muted-foreground mb-3">
					Set how much the model thinks before responding. Higher levels produce more thorough answers but take longer.
				</p>
				<div className="flex flex-col gap-2">
					{REASONING_LEVELS.map((level) => (
						<label
							key={level.value}
							className="flex items-center gap-3 rounded-md border border-border px-3 py-2 cursor-pointer hover:bg-accent/50 transition-colors"
						>
							<input
								type="radio"
								name="reasoning-level"
								value={level.value}
								checked={settings.reasoningLevel === level.value}
								onChange={() => update({ reasoningLevel: level.value })}
								className="shrink-0"
							/>
							<div className="min-w-0">
								<div className="text-sm font-medium text-foreground">{level.label}</div>
								<div className="text-xs text-muted-foreground">{level.description}</div>
							</div>
						</label>
					))}
				</div>
			</div>
		</div>
	);
}
