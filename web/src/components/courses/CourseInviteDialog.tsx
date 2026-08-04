import { useEffect, useState } from "react";
import { Check, Copy, Link2, QrCode, X } from "lucide-react";
import QRCode from "qrcode";
import { css } from "../../../styled-system/css";
import { createCourseInvite } from "../../courses/client";
import type { CourseRole } from "../../courses/contracts";

export function CourseInviteDialog({ courseId, onClose }: { courseId: string; onClose: () => void }) {
	const [role, setRole] = useState<Exclude<CourseRole, "owner">>("student");
	const [creating, setCreating] = useState(false);
	const [inviteUrl, setInviteUrl] = useState("");
	const [qrDataUrl, setQrDataUrl] = useState("");
	const [copied, setCopied] = useState(false);
	const [error, setError] = useState("");

	useEffect(() => {
		if (!inviteUrl) return;
		void QRCode.toDataURL(inviteUrl, {
			width: 224,
			margin: 1,
			color: { dark: "#1c211b", light: "#f6f2e8" },
		}).then(setQrDataUrl);
	}, [inviteUrl]);

	const create = async () => {
		setCreating(true);
		setError("");
		try {
			const result = await createCourseInvite(courseId, { role });
			setInviteUrl(new URL(`/courses/join/${result.token}`, window.location.origin).toString());
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : "The invitation could not be created.");
		} finally {
			setCreating(false);
		}
	};

	const copy = async () => {
		await navigator.clipboard.writeText(inviteUrl);
		setCopied(true);
		window.setTimeout(() => setCopied(false), 1_500);
	};

	return (
		<div role="presentation" className={css({ position: "fixed", inset: 0, zIndex: 100, display: "grid", placeItems: "center", bg: "rgba(12, 21, 16, 0.72)", p: "1rem", backdropFilter: "blur(3px)" })} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
			<section role="dialog" aria-modal="true" aria-labelledby="course-invite-title" className={css({ w: "100%", maxW: "34rem", border: "2px solid var(--ink)", bg: "var(--card)", boxShadow: "7px 7px 0 var(--course-green, #1e9b50)" })}>
				<header className={css({ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "2px solid var(--ink)", px: "1rem", py: "0.75rem" })}>
					<div className={css({ display: "flex", alignItems: "center", gap: "0.5rem" })}><QrCode size={18} /><h2 id="course-invite-title" className={css({ fontFamily: "Georgia, serif", fontSize: "1.25rem", fontWeight: 700 })}>Invite to this course</h2></div>
					<button type="button" onClick={onClose} aria-label="Close invitation" className={css({ display: "grid", h: "2rem", w: "2rem", placeItems: "center", _hover: { bg: "var(--course-wash, #ddebdd)" } })}><X size={18} /></button>
				</header>
				<div className={css({ p: "1.25rem" })}>
					{!inviteUrl ? <>
						<p className={css({ color: "var(--ink-soft)", lineHeight: 1.6 })}>Choose what the person can do. They must sign in with Not Organic before the invitation can be accepted.</p>
						<div className={css({ mt: "1rem", display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", border: "1px solid var(--ink)" })}>
							{(["student", "peer", "teacher"] as const).map((option) => <button key={option} type="button" onClick={() => setRole(option)} className={css({ borderRight: "1px solid var(--ink)", px: "0.5rem", py: "0.65rem", fontFamily: "var(--mono-display)", fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", _last: { borderRight: 0 } })} style={role === option ? { background: "var(--ink)", color: "var(--paper)" } : undefined}>{option}</button>)}
						</div>
						<p className={css({ mt: "0.75rem", fontSize: "0.75rem", color: "var(--ink-soft)" })}>{role === "teacher" ? "Teachers can edit lessons, invite members, and request full learner visibility." : role === "peer" ? "Peers co-work and comment; deck edits follow course settings." : "Students work through lessons and control teacher access."}</p>
						<button type="button" onClick={() => void create()} disabled={creating} className={css({ mt: "1.25rem", w: "100%", bg: "var(--course-green, #1e9b50)", px: "1rem", py: "0.75rem", fontWeight: 800, color: "white", _disabled: { opacity: 0.6 } })}>{creating ? "Making a secure link…" : "Create link and QR code"}</button>
					</> : <div className={css({ display: "grid", gap: "1.25rem", sm: { gridTemplateColumns: "14rem minmax(0, 1fr)" } })}>
						<div className={css({ display: "grid", placeItems: "center", border: "1px solid var(--ink)", bg: "#f6f2e8", p: "0.5rem" })}>{qrDataUrl ? <img src={qrDataUrl} alt="QR code for this course invitation" width={224} height={224} /> : <span>Rendering QR…</span>}</div>
						<div className={css({ minW: 0 })}><div className={css({ display: "inline-flex", alignItems: "center", gap: "0.35rem", bg: "var(--course-wash, #ddebdd)", px: "0.5rem", py: "0.25rem", fontFamily: "var(--mono-display)", fontSize: "0.67rem", fontWeight: 700, textTransform: "uppercase", color: "var(--course-green-dark, #14743c)" })}><Link2 size={13} /> {role} invite</div><p className={css({ mt: "0.75rem", overflowWrap: "anywhere", fontFamily: "var(--mono-body)", fontSize: "0.72rem", lineHeight: 1.55, color: "var(--ink-soft)" })}>{inviteUrl}</p><button type="button" onClick={() => void copy()} className={css({ mt: "1rem", display: "inline-flex", alignItems: "center", gap: "0.45rem", border: "1px solid var(--ink)", px: "0.75rem", py: "0.55rem", fontWeight: 700, _hover: { bg: "var(--course-wash, #ddebdd)" } })}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? "Copied" : "Copy link"}</button><p className={css({ mt: "0.75rem", fontSize: "0.7rem", color: "var(--ink-soft)" })}>Expires in 7 days · up to 25 uses</p></div>
					</div>}
					{error && <p role="alert" className={css({ mt: "0.75rem", color: "var(--destructive)", fontSize: "0.78rem" })}>{error}</p>}
				</div>
			</section>
		</div>
	);
}
