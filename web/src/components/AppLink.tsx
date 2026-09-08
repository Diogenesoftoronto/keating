import type { ComponentProps } from "react";
import { Link } from "@tanstack/react-router";
import { desktopMarketingUrl, isDesktopShell } from "../lib/desktop-navigation";

/** Keep workspace navigation local and website links in the desktop browser. */
export function AppLink(props: ComponentProps<typeof Link>) {
	const external = isDesktopShell() && typeof props.to === "string" ? desktopMarketingUrl(props.to) : null;
	return <Link {...props} to={external ?? props.to} target={external ? "_blank" : props.target} rel={external ? "noopener noreferrer" : props.rel} />;
}
