import { useCallback, useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { css, cx } from "../../../styled-system/css";
import { loadDeclaredProfile, saveDeclaredProfile } from "../../keating/learner-profile-store";
import { loadKeatingUiSettings, saveKeatingUiSettings } from "../../keating/ui-settings";
import { PROVIDER_CREDENTIALS_CHANGED_EVENT } from "../../keating/model-prefs";
import { getNotOrganicAccount, getNotOrganicWallet, notOrganicPublicClient } from "../../notorganic-provider";
import { formatCreditBalance, normalizeCreditWallet } from "../../notorganic-provider/credit-wallet";
import { extractNotOrganicProfile, fetchImageAsDataUrl, notOrganicAccountUrl, type NotOrganicProfile } from "../../notorganic-provider/profile";

const cardClass = css({ display: "flex", flexDirection: "column", gap: "0.75rem", padding: "1rem", borderRadius: "0.5rem", border: "1px solid var(--border)" });
const rowClass = css({ display: "flex", alignItems: "center", gap: "0.75rem", minWidth: 0 });
const avatarClass = css({ width: "3rem", height: "3rem", flexShrink: 0, borderRadius: "0.375rem", border: "1px solid var(--border)", objectFit: "cover", backgroundColor: "var(--muted)" });
const nameClass = css({ fontSize: "0.9375rem", fontWeight: 600, color: "var(--foreground)" });
const mutedClass = css({ fontSize: "0.75rem", color: "var(--muted-foreground)" });
const actionsClass = css({ display: "flex", flexWrap: "wrap", gap: "0.5rem" });
const buttonClass = css({
	display: "inline-flex", alignItems: "center", gap: "0.375rem", borderRadius: "0.375rem", border: "1px solid var(--border)",
	paddingInline: "0.625rem", paddingBlock: "0.375rem", fontSize: "0.75rem", fontWeight: 500, color: "var(--foreground)",
	_hover: { backgroundColor: "var(--accent)", color: "var(--accent-foreground)" }, _disabled: { opacity: 0.5 },
});

/** Fill only what is empty, so a name or photo you set here is never overwritten. */
async function fillFromProfile(profile: NotOrganicProfile, force: boolean): Promise<boolean> {
	let changed = false;
	if (profile.name) {
		const declared = loadDeclaredProfile();
		if (force || !declared.preferredName.trim()) {
			saveDeclaredProfile({ ...declared, preferredName: profile.name });
			changed = true;
		}
	}
	if (profile.imageUrl) {
		const ui = loadKeatingUiSettings();
		if (force || !ui.userProfileImage) {
			const image = await fetchImageAsDataUrl(profile.imageUrl);
			if (image) { saveKeatingUiSettings({ ...ui, userProfileImage: image }); changed = true; }
		}
	}
	return changed;
}

/** Account summary for the hosted Not Organic provider: identity, credits, and a way to manage both. */
export function NotOrganicAccountCard() {
	const [state, setState] = useState<{ profile: NotOrganicProfile; balance: string } | "signed-out" | "loading" | "error">("loading");
	const [note, setNote] = useState("");
	const accountUrl = notOrganicAccountUrl();

	const load = useCallback(async () => {
		let signedIn = false;
		try { signedIn = Boolean(notOrganicPublicClient()?.getSession()); } catch { /* treated as signed out */ }
		if (!signedIn) { setState("signed-out"); return; }
		try {
			const [account, wallet] = await Promise.all([getNotOrganicAccount(), getNotOrganicWallet()]);
			const profile = extractNotOrganicProfile(account);
			setState({ profile, balance: `${formatCreditBalance(normalizeCreditWallet(wallet).availableMicros)} available` });
			if (await fillFromProfile(profile, false)) setNote("Filled in your name and photo from Not Organic.");
		} catch {
			setState("error");
		}
	}, []);

	useEffect(() => {
		void load();
		window.addEventListener(PROVIDER_CREDENTIALS_CHANGED_EVENT, load);
		return () => window.removeEventListener(PROVIDER_CREDENTIALS_CHANGED_EVENT, load);
	}, [load]);

	if (state === "signed-out" || state === "loading") return null;
	if (state === "error") return <div className={cardClass}><p className={mutedClass}>Couldn't load your Not Organic account right now.</p></div>;

	const { profile, balance } = state;
	return (
		<div className={cardClass}>
			<div className={rowClass}>
				{profile.imageUrl ? <img src={profile.imageUrl} alt="" referrerPolicy="no-referrer" className={avatarClass} /> : <div className={avatarClass} />}
				<div className={css({ minWidth: 0 })}>
					<div className={nameClass}>{profile.name ?? "Not Organic account"}</div>
					<div className={mutedClass}>{balance}</div>
				</div>
			</div>
			<p className={mutedClass}>
				Your name and photo come from your Not Organic account{!profile.name || !profile.imageUrl ? ", and parts of them are still blank. Add them there and they'll fill in here." : ". Edit them there to change them here."}
			</p>
			<div className={actionsClass}>
				{accountUrl && (
					<a className={buttonClass} href={accountUrl} target="_blank" rel="noopener noreferrer">
						Credits &amp; account details <ExternalLink size={12} />
					</a>
				)}
				<button
					type="button"
					className={cx("dialog-compact-button", buttonClass)}
					disabled={!profile.name && !profile.imageUrl}
					onClick={() => void fillFromProfile(profile, true).then((c) => setNote(c ? "Updated your name and photo." : "Couldn't import the photo."))}
				>
					Use my name &amp; photo
				</button>
			</div>
			{note && <p role="status" className={mutedClass}>{note}</p>}
		</div>
	);
}
