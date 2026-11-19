import { usePostHog } from "@posthog/react";
import { AppLink } from "./AppLink";
import { Eyebrow } from "../design-system/kit";
import { KeatingBot } from "./KeatingBot";
import { KeatingGlyph } from "../design-system/glyphs";

export function LandingClosing() {
  const posthog = usePostHog();
  return <section className="lp-close k-halftone" aria-labelledby="landing-closing-title">
    <KeatingBot variant="body" state="clapping" size={120} label=""/>
    <Eyebrow muted>Done offloading?</Eyebrow>
    <h2 id="landing-closing-title" data-landing-section="closing">Ready to think<br/>for yourself?</h2>
    <div className="lp-cta">
      <AppLink to="/chat" className="k-button k-primary" data-glyph-surface="inverse" onClick={() => posthog?.capture("start_session_clicked", { source: "landing_closing" })}>Start a session <KeatingGlyph name="right" size={14}/></AppLink>
      <AppLink to="/download" className="k-button k-outline" onClick={() => posthog?.capture("download_intent", { source: "landing_closing", destination: "download_page" })}><KeatingGlyph name="export" size={14}/>Download Keating</AppLink>
    </div>
  </section>;
}
