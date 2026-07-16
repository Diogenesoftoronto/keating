export const SHARE_MAX_BYTES = 512 * 1024;
export const SHARE_ID_BYTES = 9;
export const SHARE_ID_PATTERN = /^[A-Za-z0-9_-]{8,32}$/;

export function isValidShareId(value: unknown): value is string {
	return typeof value === "string" && SHARE_ID_PATTERN.test(value);
}

export function compactShareIdFromBytes(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function validateSharedSessionPayload(value: any): string | null {
	if (!value || typeof value !== "object") return "Expected shared session object";
	if (typeof value.title !== "string" || !value.title.trim()) return "Missing shared session title";
	if (!Array.isArray(value.messages) || value.messages.length === 0) return "Missing shared session messages";
	if (value.id !== undefined && !isValidShareId(value.id)) return "Invalid shared session id";
	for (const message of value.messages) {
		const role = message?.role;
		if (role !== "user" && role !== "user-with-attachments" && role !== "assistant") {
			return "Invalid shared session message role";
		}
		if (!Array.isArray(message?.content)) return "Invalid shared session message content";
	}
	return null;
}
