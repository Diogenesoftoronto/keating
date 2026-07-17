import { ArrowRight, CheckCircle2, ShieldCheck } from "lucide-react";
import { css } from "../../styled-system/css";

const stackClass = css({ display: "flex", flexDirection: "column", gap: "1.25rem" });
const titleClass = css({ fontSize: "0.875rem", fontWeight: 600, color: "var(--foreground)" });
const descriptionClass = css({ fontSize: "0.875rem", lineHeight: 1.55, color: "var(--muted-foreground)" });
const codeClass = css({
	borderRadius: "0.25rem",
	backgroundColor: "var(--muted)",
	paddingInline: "0.3rem",
	paddingBlock: "0.1rem",
	fontFamily: "var(--font-mono)",
	fontSize: "0.72rem",
	color: "var(--foreground)",
});

export function ProxyTab() {
	return (
		<div className={stackClass}>
			<div className={css({ display: "flex", alignItems: "flex-start", gap: "0.75rem" })}>
				<ShieldCheck size={19} className={css({ marginTop: "0.1rem", flexShrink: 0, color: "var(--primary)" })} />
				<div>
					<div className={css({ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem" })}>
						<h3 className={titleClass}>Automatic browser bridge</h3>
						<span className={css({ borderRadius: "9999px", backgroundColor: "color-mix(in srgb, var(--primary) 10%, transparent)", paddingInline: "0.5rem", paddingBlock: "0.125rem", fontSize: "0.625rem", fontWeight: 600, color: "var(--primary)" })}>
							Always available
						</span>
					</div>
					<p className={descriptionClass}>
						Keating automatically routes browser requests through its same-origin server when a provider would otherwise reject the browser for CORS. There is no separate proxy URL to configure.
					</p>
				</div>
			</div>

			<div className={css({ display: "grid", gap: "0.5rem", borderBlock: "1px solid var(--border)", paddingBlock: "0.875rem", sm: { gridTemplateColumns: "1fr auto 1fr auto 1fr", alignItems: "center" } })}>
				<div>
					<div className={titleClass}>1. Browser</div>
					<p className={descriptionClass}>Builds the provider request.</p>
				</div>
				<ArrowRight size={14} className={css({ display: "none", color: "var(--muted-foreground)", sm: { display: "block" } })} />
				<div>
					<div className={titleClass}>2. Keating server</div>
					<p className={descriptionClass}><code className={codeClass}>/api/chat-proxy</code> validates and forwards it.</p>
				</div>
				<ArrowRight size={14} className={css({ display: "none", color: "var(--muted-foreground)", sm: { display: "block" } })} />
				<div>
					<div className={titleClass}>3. Provider</div>
					<p className={descriptionClass}>Returns its normal streaming response.</p>
				</div>
			</div>

			<div className={css({ display: "grid", gap: "0.75rem" })}>
				<h3 className={titleClass}>When it is used</h3>
				<ul className={css({ display: "grid", gap: "0.5rem", fontSize: "0.8rem", lineHeight: 1.5, color: "var(--muted-foreground)" })}>
					<li className={css({ display: "flex", gap: "0.5rem" })}>
						<CheckCircle2 size={14} className={css({ marginTop: "0.2rem", flexShrink: 0, color: "var(--primary)" })} />
						Anthropic-compatible APIs, custom hosts, and local model servers that do not permit direct browser calls.
					</li>
					<li className={css({ display: "flex", gap: "0.5rem" })}>
						<CheckCircle2 size={14} className={css({ marginTop: "0.2rem", flexShrink: 0, color: "var(--primary)" })} />
						Model discovery, chat streaming, speech transcription, and browser media tools use the same route.
					</li>
				</ul>
			</div>

			<div className={css({ borderLeft: "3px solid var(--primary)", backgroundColor: "color-mix(in srgb, var(--primary) 6%, transparent)", padding: "0.75rem", fontSize: "0.75rem", lineHeight: 1.55, color: "var(--muted-foreground)" })}>
				<strong className={css({ color: "var(--foreground)" })}>Development and production differ.</strong>{" "}
				Local HTTP targets such as Ollama are allowed during development. Production accepts secure public HTTPS targets and rejects local or private destinations. API keys remain attached to the provider request and are never placed in the URL.
			</div>
		</div>
	);
}
