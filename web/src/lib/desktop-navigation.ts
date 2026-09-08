// The pure Electron policy is shared so direct navigation and SPA links agree.
export { desktopMarketingUrl } from "../../../desktop/src/navigation";

export function isDesktopShell(): boolean {
	return typeof window !== "undefined" && "keatingDesktop" in window;
}
