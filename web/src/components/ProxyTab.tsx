import { DefinitionList, Note } from "../design-system/kit";
import { RendererNote } from "./settings/models/RendererNote";
export function ProxyTab() {
	return (
		<div className="s2-pane">
			<Note data-glyph-host>
				<div id="settings-section-proxy">
					<strong>Automatic browser bridge · Always available</strong>
					<p>
						Keating automatically routes browser requests through its
						same-origin server when a provider would otherwise reject the
						browser for CORS. There is no separate proxy URL to configure.
					</p>
					<DefinitionList
						items={[
							{ term: "Browser", detail: "Builds the provider request." },
							{
								term: "Keating server",
								detail: (
									<>
										<code>/api/chat-proxy</code> validates and forwards it.
									</>
								),
							},
							{
								term: "Provider",
								detail: "Returns its normal streaming response.",
							},
							{
								term: "When it is used",
								detail:
									"Anthropic-compatible APIs, custom hosts, and local model servers that do not permit direct browser calls. Model discovery, chat streaming, speech transcription, and browser media tools use the same route.",
							},
							{
								term: "Development and production differ.",
								detail:
									"Local HTTP targets such as Ollama are allowed during development. Production accepts secure public HTTPS targets and rejects local or private destinations. API keys remain attached to the provider request and are never placed in the URL.",
							},
						]}
					/>
				</div>
				<RendererNote />
			</Note>
		</div>
	);
}
