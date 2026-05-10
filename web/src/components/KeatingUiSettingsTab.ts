import { Switch } from "@mariozechner/mini-lit/dist/Switch.js";
import { SettingsTab } from "@mariozechner/pi-web-ui";
import { html, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { loadKeatingUiSettings, saveKeatingUiSettings } from "../keating/ui-settings";

@customElement("keating-ui-settings-tab")
export class KeatingUiSettingsTab extends SettingsTab {
	@state() private showToolUi = false;
	@state() private autoOpenArtifacts = true;
	@state() private showRawErrors = false;

	override connectedCallback() {
		super.connectedCallback();
		const settings = loadKeatingUiSettings();
		this.showToolUi = settings.showToolUi;
		this.autoOpenArtifacts = settings.autoOpenArtifacts;
		this.showRawErrors = settings.showRawErrors;
	}

	getTabName(): string {
		return "Interface";
	}

	private updateSettings(partial: Partial<{ showToolUi: boolean; autoOpenArtifacts: boolean; showRawErrors: boolean }>) {
		const next = { ...loadKeatingUiSettings(), ...partial };
		this.showToolUi = next.showToolUi;
		this.autoOpenArtifacts = next.autoOpenArtifacts;
		this.showRawErrors = next.showRawErrors;
		saveKeatingUiSettings(next);
	}

	render(): TemplateResult {
		return html`
			<div class="flex flex-col gap-6">
				<div>
					<h3 class="text-sm font-semibold text-foreground mb-2">Chat Interface</h3>
					<p class="text-sm text-muted-foreground">
						Control how much internal agent activity appears in the conversation.
					</p>
				</div>

				<div class="flex items-start justify-between gap-4 rounded-lg border border-border p-4">
					<div>
						<div class="text-sm font-medium text-foreground">Show tool details</div>
						<p class="mt-1 text-sm text-muted-foreground">
							Show tool arguments and results inside chat messages. Compact status remains visible when this is off.
						</p>
					</div>
					${Switch({
						checked: this.showToolUi,
						onChange: (checked) => this.updateSettings({ showToolUi: checked }),
						label: "",
					})}
				</div>

				<div class="flex items-start justify-between gap-4 rounded-lg border border-border p-4">
					<div>
						<div class="text-sm font-medium text-foreground">Show raw error details</div>
						<p class="mt-1 text-sm text-muted-foreground">
							Display full error messages and response bodies in tool failures. When off, only a short summary is shown.
						</p>
					</div>
					${Switch({
						checked: this.showRawErrors,
						onChange: (checked) => this.updateSettings({ showRawErrors: checked }),
						label: "",
					})}
				</div>

				<div class="flex items-start justify-between gap-4 rounded-lg border border-border p-4">
					<div>
						<div class="text-sm font-medium text-foreground">Open artifacts automatically</div>
						<p class="mt-1 text-sm text-muted-foreground">
							Open the artifact side panel when Keating creates a plan, map, animation, benchmark, or evolution.
						</p>
					</div>
					${Switch({
						checked: this.autoOpenArtifacts,
						onChange: (checked) => this.updateSettings({ autoOpenArtifacts: checked }),
						label: "",
					})}
				</div>
			</div>
		`;
	}
}
