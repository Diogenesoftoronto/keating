import { useEffect, useRef } from "react";
import { usePostHog } from "@posthog/react";

/** Measure section introductions, not tall sections that cannot fit on mobile. */
export function useLandingAnalytics() {
  const posthog = usePostHog();
  const root = useRef<HTMLElement>(null);
  const viewed = useRef(new Set<string>());

  useEffect(() => {
    if (!root.current || !posthog || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const section = (entry.target as HTMLElement).dataset.landingSection;
        if (!entry.isIntersecting || entry.intersectionRatio < 0.5 || !section || viewed.current.has(section)) continue;
        viewed.current.add(section);
        posthog.capture("landing_section_viewed", { section, landing_version: "learner_direction_v1" });
        observer.unobserve(entry.target);
      }
    }, { threshold: 0.5 });
    root.current.querySelectorAll("[data-landing-section]").forEach(element => observer.observe(element));
    return () => observer.disconnect();
  }, [posthog]);

  return { root, posthog };
}
