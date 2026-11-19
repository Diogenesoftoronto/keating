import { isProfileAvatar, PROFILE_AVATAR_PREFIX } from "./public-profile-contract";

export const PROFILE_IMAGE_ACCEPT = "image/jpeg,image/png,image/webp";

/** Crop and re-encode on this device so the published thumbnail contains only pixels. */
export async function preparePublicProfileImage(file: File): Promise<string> {
	if (!PROFILE_IMAGE_ACCEPT.split(",").includes(file.type)) throw new Error("Choose a JPEG, PNG or WebP image.");
	if (!file.size || file.size > 10 * 1024 * 1024) throw new Error("Choose a nonempty image up to 10 MB.");
	if (typeof createImageBitmap !== "function") throw new Error("This browser can’t prepare profile images.");
	const bitmap = await createImageBitmap(file).catch(() => { throw new Error("Couldn’t open this image. Choose another file."); });
	try {
		const edge = Math.min(bitmap.width, bitmap.height);
		const canvas = document.createElement("canvas");
		const context = canvas.getContext("2d", { alpha: false });
		if (!context || !edge) throw new Error("Couldn’t prepare this image. Choose another file.");
		for (const [size, quality] of [[128, 0.78], [128, 0.55], [96, 0.5], [64, 0.4]] as const) {
			canvas.width = canvas.height = size;
			context.fillStyle = "#fff";
			context.fillRect(0, 0, size, size);
			context.drawImage(bitmap, (bitmap.width - edge) / 2, (bitmap.height - edge) / 2, edge, edge, 0, 0, size, size);
			const dataUrl = canvas.toDataURL("image/jpeg", quality);
			const avatar = dataUrl.startsWith(PROFILE_AVATAR_PREFIX) ? dataUrl.slice(PROFILE_AVATAR_PREFIX.length) : "";
			if (isProfileAvatar(avatar)) return avatar;
		}
		throw new Error("Couldn’t resize this image. Choose another file.");
	} finally {
		bitmap.close();
	}
}
