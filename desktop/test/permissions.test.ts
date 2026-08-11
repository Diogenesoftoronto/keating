import { describe, expect, test } from "bun:test";
import {
	installDesktopPermissionPolicy,
	isAllowedDesktopPermission,
} from "../src/permissions.js";

const APP_ORIGIN = "http://127.0.0.1:43123";

describe("desktop permission policy", () => {
	test("allows only camera and microphone from the owning main frame", () => {
		const allowed = {
			ownerMatches: true,
			permission: "media",
			requestingOrigin: APP_ORIGIN,
			isMainFrame: true,
		} as const;
		expect(isAllowedDesktopPermission({ ...allowed, mediaTypes: ["audio"] }, APP_ORIGIN)).toBe(true);
		expect(isAllowedDesktopPermission({ ...allowed, mediaTypes: ["video"] }, APP_ORIGIN)).toBe(true);
		expect(isAllowedDesktopPermission({ ...allowed, mediaTypes: ["audio", "video"] }, APP_ORIGIN)).toBe(true);
		expect(isAllowedDesktopPermission({ ...allowed, mediaTypes: ["unknown"] }, APP_ORIGIN)).toBe(false);
		expect(isAllowedDesktopPermission({ ...allowed, permission: "display-capture", mediaTypes: ["video"] }, APP_ORIGIN)).toBe(false);
		expect(isAllowedDesktopPermission({ ...allowed, ownerMatches: false, mediaTypes: ["audio"] }, APP_ORIGIN)).toBe(false);
		expect(isAllowedDesktopPermission({ ...allowed, isMainFrame: false, mediaTypes: ["audio"] }, APP_ORIGIN)).toBe(false);
		expect(isAllowedDesktopPermission({ ...allowed, requestingOrigin: "https://attacker.example", mediaTypes: ["audio"] }, APP_ORIGIN)).toBe(false);
	});

	test("installs check, request, and explicit screen-capture denial handlers", () => {
		let checkHandler: ((...args: any[]) => boolean) | null = null;
		let requestHandler: ((...args: any[]) => void) | null = null;
		let displayHandler: ((...args: any[]) => void) | null = null;
		const session = {
			setPermissionCheckHandler: (handler: typeof checkHandler) => { checkHandler = handler; },
			setPermissionRequestHandler: (handler: typeof requestHandler) => { requestHandler = handler; },
			setDisplayMediaRequestHandler: (handler: typeof displayHandler) => { displayHandler = handler; },
		};
		const owner = { session };
		const cleanup = installDesktopPermissionPolicy({ webContents: owner } as any, APP_ORIGIN);

		expect(checkHandler?.(owner, "media", APP_ORIGIN, {
			isMainFrame: true,
			mediaType: "audio",
		})).toBe(true);
		let granted: boolean | undefined;
		requestHandler?.(owner, "media", (value: boolean) => { granted = value; }, {
			isMainFrame: true,
			requestingUrl: `${APP_ORIGIN}/chat`,
			securityOrigin: APP_ORIGIN,
			mediaTypes: ["video"],
		});
		expect(granted).toBe(true);
		let displayStreams: unknown = "not-called";
		displayHandler?.({}, (streams: unknown) => { displayStreams = streams; });
		expect(displayStreams).toEqual({});

		cleanup();
		expect(checkHandler).toBeNull();
		expect(requestHandler).toBeNull();
		expect(displayHandler).toBeNull();
	});
});
