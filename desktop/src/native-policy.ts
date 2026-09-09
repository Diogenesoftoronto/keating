import { isTrustedAppNavigation } from "./security.js";

/** Same-origin child frames must never receive authority to launch native processes. */
export function nativeSenderAuthorized(
	event: { sender: unknown; senderFrame?: { url: string } | null },
	window: { webContents: { mainFrame: { url: string } } },
	origin: string,
): boolean {
	return (
		event.sender === window.webContents &&
		event.senderFrame === window.webContents.mainFrame &&
		isTrustedAppNavigation(event.senderFrame?.url ?? "", origin)
	);
}
