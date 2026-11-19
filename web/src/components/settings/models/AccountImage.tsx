import { useCallback, useRef } from "react";
import { Button } from "../../../design-system/kit";
import { SettingRow } from "../ui";
import { useKeatingUiSettings } from "../../../hooks/use-ui-settings";

function readImageAsDataUrl(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result ?? ""));
		reader.onerror = () =>
			reject(reader.error ?? new Error(`Could not read ${file.name}`));
		reader.readAsDataURL(file);
	});
}

export function AccountImage() {
	const upload = useRef<HTMLInputElement>(null);
	const [settings, update] = useKeatingUiSettings();
	const updateProfileImage = useCallback(
		async (file: File | undefined) => {
			if (!file) return;
			if (!file.type.startsWith("image/")) return;
			const image = await readImageAsDataUrl(file);
			update({ userProfileImage: image });
		},
		[update],
	);

	return (
		<SettingRow
			id="account-image"
			label="Your profile image"
			help="Shown beside your chat messages on this device."
			scope="this device"
		>
			{settings.userProfileImage && (
				<img
					src={settings.userProfileImage}
					className="s2-avatar"
					alt="Your profile"
				/>
			)}
			<input
				type="file"
				ref={upload}
				hidden
				accept="image/*"
				aria-label="Upload your profile image"
				onChange={(event) => {
					void updateProfileImage(event.target.files?.[0]);
					event.currentTarget.value = "";
				}}
			/>
			<Button onClick={() => upload.current?.click()}>Upload</Button>
			<Button
				variant="ghost"
				disabled={!settings.userProfileImage}
				onClick={() => update({ userProfileImage: null })}
			>
				Remove
			</Button>
		</SettingRow>
	);
}
