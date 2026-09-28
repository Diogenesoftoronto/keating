import type { ComponentProps } from "react";
import { Link } from "@tanstack/react-router";
import { hostedNavigationHref } from "../lib/hosted-navigation";
import { desktopMarketingUrl, isDesktopShell } from "../lib/desktop-navigation";

/** Keep workspace navigation local and website links in the desktop browser. */
export function AppLink(props: ComponentProps<typeof Link>) {
  const desktop = isDesktopShell();
  const hostname = typeof window !== "undefined" ? window.location?.hostname ?? "" : "";
  const appOnly = import.meta.env.KEATING_WEB_BUILD_TARGET === "app";
  const destination = typeof props.to === "string"
    ? hostedNavigationHref(props.to, hostname, appOnly) : props.to;
  const external = desktop && typeof destination === "string" && destination !== "/"
    ? desktopMarketingUrl(destination) : null;
  let href = external ?? destination;
  // TanStack external links do not serialize route params/search. Preserve
  // course handoffs when the public page opens the application origin.
  if (typeof href === "string" && /^https?:\/\//.test(href) && href !== props.to) {
    if (props.params && typeof props.params === "object") {
      for (const [key, value] of Object.entries(props.params)) href = href.replace(`$${key}`, encodeURIComponent(String(value)));
    }
    if (props.search && typeof props.search === "object") {
      const url = new URL(href);
      for (const [key, value] of Object.entries(props.search)) {
        if (value !== undefined) url.searchParams.set(key, typeof value === "string" ? value : JSON.stringify(value));
      }
      href = url.href;
    }
  }
  return <Link {...props} to={href} target={external ? "_blank" : props.target} rel={external ? "noopener noreferrer" : props.rel} />;
}
