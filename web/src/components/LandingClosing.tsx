import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { usePostHog } from "@posthog/react";
import { ArrowDown, ArrowUpRight } from "lucide-react";
import { KeatingBot } from "./KeatingBot";
import "./landing-closing.css";

export function LandingClosing() {
  const posthog = usePostHog();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  return (
    <section className="landing-closing" aria-labelledby="landing-closing-title">
      <div className="landing-closing__inner">
        <div className="landing-closing__bot" aria-hidden="true">
          <KeatingBot variant="body" state={hovered || focused ? "success" : "idle"} size={164} label="" animated={hovered || focused} />
        </div>
        <p className="landing-closing__eyebrow">Done offloading?</p>
        <h2 id="landing-closing-title">Ready to think<br />for yourself?</h2>
        <div className="landing-closing__actions" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onFocus={() => setFocused(true)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
          <Link to="/chat" className="landing-closing__action landing-closing__session" onClick={() => posthog?.capture("start_session_clicked", { source: "landing_closing" })}>
            <span className="landing-closing__action-note">A question is enough.</span>
            <span className="landing-closing__action-label">Start a session <ArrowUpRight aria-hidden="true" size={24} /></span>
          </Link>
          <Link to="/download" className="landing-closing__action landing-closing__download" onClick={() => posthog?.capture("download_intent", { source: "landing_closing", destination: "download_page" })}>
            <span className="landing-closing__action-note">Take it with you.</span>
            <span className="landing-closing__action-label">Download Keating <ArrowDown aria-hidden="true" size={24} /></span>
          </Link>
        </div>
      </div>
    </section>
  );
}
