import type { BrowserWindow, Session } from "electron";
import { trustedOrigin } from "./security.js";

type MediaKind = "audio" | "video" | "unknown";

export interface DesktopPermissionDecision {
	ownerMatches: boolean;
	permission: string;
	requestingOrigin?: string;
	isMainFrame: boolean;
	mediaTypes?: readonly MediaKind[];
}

/**
 * Keep the preload-bearing renderer fail closed. Camera and microphone are the
 * only browser permissions Keating currently needs, and only its own main frame
 * may request them. Screen capture remains denied until the desktop app exposes
 * a learner-visible source picker.
 */
export function isAllowedDesktopPermission(
	request: DesktopPermissionDecision,
	appOrigin: string,
): boolean {
	if (!request.ownerMatches || request.permission !== "media" || !request.isMainFrame) {
		return false;
	}
	if (trustedOrigin(request.requestingOrigin ?? "") !== appOrigin) return false;
	const mediaTypes = request.mediaTypes ?? [];
	return mediaTypes.length > 0
		&& mediaTypes.every((type) => type === "audio" || type === "video");
}

export function installDesktopPermissionPolicy(
	window: BrowserWindow,
	appOrigin: string,
): () => void {
	const session: Session = window.webContents.session;
	session.setPermissionCheckHandler((requestingWebContents, permission, requestingOrigin, details) => {
		return isAllowedDesktopPermission({
			ownerMatches: requestingWebContents === window.webContents,
			permission,
			requestingOrigin: details.securityOrigin ?? requestingOrigin ?? details.requestingUrl,
			isMainFrame: details.isMainFrame,
			mediaTypes: details.mediaType ? [details.mediaType] : [],
		}, appOrigin);
	});
	session.setPermissionRequestHandler((requestingWebContents, permission, callback, details) => {
		const mediaDetails = details as typeof details & {
			securityOrigin?: string;
			mediaTypes?: MediaKind[];
		};
		callback(isAllowedDesktopPermission({
			ownerMatches: requestingWebContents === window.webContents,
			permission,
			requestingOrigin: mediaDetails.securityOrigin ?? details.requestingUrl,
			isMainFrame: details.isMainFrame,
			mediaTypes: mediaDetails.mediaTypes,
		}, appOrigin));
	});
	// Never silently pick a monitor or window on the learner's behalf.
	session.setDisplayMediaRequestHandler((_request, callback) => callback({}));

	return () => {
		session.setPermissionCheckHandler(null);
		session.setPermissionRequestHandler(null);
		session.setDisplayMediaRequestHandler(null);
	};
}
