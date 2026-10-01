export interface NotOrganicProfile {
	name?: string;
	imageUrl?: string;
}

function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "string" && value.trim()) return value.trim();
	}
	return undefined;
}

/**
 * Pull a display name and photo out of the account payload. The account API
 * has used several field spellings, so accept the common ones and ignore the
 * rest. Only https images are kept; anything else would be a tracking or
 * mixed-content risk when we embed it.
 */
export function extractNotOrganicProfile(account: Record<string, unknown>): NotOrganicProfile {
	const nested = account.profile && typeof account.profile === "object" ? account.profile as Record<string, unknown> : {};
	const source = { ...account, ...nested };
	const name = firstString(source, ["displayName", "display_name", "name", "preferred_name", "handle"]);
	const image = firstString(source, ["avatar", "avatar_url", "picture", "image", "photo_url"]);
	return {
		...(name ? { name: name.slice(0, 80) } : {}),
		...(image && /^https:\/\//i.test(image) ? { imageUrl: image } : {}),
	};
}

/** Account page for credits and details; deployments can point this elsewhere. */
export function notOrganicAccountUrl(env: Record<string, string | undefined> = (import.meta as { env?: Record<string, string | undefined> }).env ?? {}): string | null {
	const explicit = env.VITE_NOTORGANIC_ACCOUNT_URL?.trim();
	if (explicit) return /^https:\/\//i.test(explicit) ? explicit : null;
	const authorize = env.VITE_NOTORGANIC_AUTHORIZATION_URL?.trim();
	if (!authorize) return null;
	try {
		return `${new URL(authorize).origin}/account`;
	} catch {
		return null;
	}
}

/** Download a remote avatar as a data URL so it works offline and under our CSP. */
export async function fetchImageAsDataUrl(url: string, fetchImpl: typeof fetch = fetch, maxBytes = 1_500_000): Promise<string | null> {
	try {
		const response = await fetchImpl(url, { credentials: "omit" });
		if (!response.ok) return null;
		const blob = await response.blob();
		if (!blob.type.startsWith("image/") || blob.size > maxBytes) return null;
		return await new Promise((resolve) => {
			const reader = new FileReader();
			reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
			reader.onerror = () => resolve(null);
			reader.readAsDataURL(blob);
		});
	} catch {
		return null;
	}
}
