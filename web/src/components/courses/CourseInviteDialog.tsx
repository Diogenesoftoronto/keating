import { useEffect, useState } from "react";
import { KeatingGlyph } from "../../design-system/glyphs";
import { Button, IconButton, Loading } from "../../design-system/kit";
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
		<div role="presentation" className={css({ position: "fixed", inset: 0, zIndex: 100, display: "grid", placeItems: "center", bg: "rgba(12, 21, 16, 0.72)", p: "1rem" })} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
			<section role="dialog" aria-modal="true" aria-labelledby="course-invite-title" className="cw-invite-dialog">
				<header className="cw-invite-head k-halftone" data-glyph-host>
					<div className={css({ display: "flex", alignItems: "center", gap: "0.5rem" })}><KeatingGlyph name="qr" size={18} /><h2 id="course-invite-title">Invite to this course</h2></div>
					<IconButton label="Close invitation" glyph="x" onClick={onClose} />
				</header>
				<div className={css({ p: "1.25rem" })}>
					{!inviteUrl ? <>
						<p className={css({ color: "var(--ink-soft)", lineHeight: 1.6 })}>Choose what the person can do. They must sign in with Not Organic before the invitation can be accepted.</p>
						<div className={css({ mt: "1rem", display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", border: "1px solid var(--ink)" })}>
							{(["student", "peer", "teacher"] as const).map((option) => <button key={option} type="button" onClick={() => setRole(option)} className={css({ borderRight: "1px solid var(--ink)", px: "0.5rem", py: "0.65rem", fontFamily: "var(--mono-display)", fontSize: "0.72rem", fontWeight: 700, textTransform: "uppercase", _last: { borderRight: 0 } })} style={role === option ? { background: "var(--ink)", color: "var(--paper)" } : undefined}>{option}</button>)}
						</div>
						<p className={css({ mt: "0.75rem", fontSize: "0.75rem", color: "var(--ink-soft)" })}>{role === "teacher" ? "Teachers can edit lessons, invite members, and request full learner visibility." : role === "peer" ? "Peers co-work and comment; deck edits follow course settings." : "Students work through lessons and control teacher access."}</p>
						<Button variant="primary" busy={creating} onClick={() => void create()}>{creating ? <Loading size="inline" label="Making a secure link…" /> : "Create link and QR code"}</Button>
					</> : <div className={css({ display: "grid", gap: "1.25rem", sm: { gridTemplateColumns: "14rem minmax(0, 1fr)" } })}>
						<div className={css({ display: "grid", placeItems: "center", border: "1px solid var(--ink)", bg: "#f6f2e8", p: "0.5rem" })}>{qrDataUrl ? <img src={qrDataUrl} alt="QR code for this course invitation" width={224} height={224} /> : <Loading label="Rendering QR…" />}</div>
						<div className={css({ minW: 0 })}><div data-glyph-host className={css({ display: "inline-flex", alignItems: "center", gap: "0.35rem", bg: "var(--course-wash, #ddebdd)", px: "0.5rem", py: "0.25rem", fontFamily: "var(--mono-display)", fontSize: "0.67rem", fontWeight: 700, textTransform: "uppercase", color: "var(--course-green-dark, #14743c)" })}><KeatingGlyph name="link" size={13} /> {role} invite</div><p className={css({ mt: "0.75rem", overflowWrap: "anywhere", fontFamily: "var(--mono-body)", fontSize: "0.72rem", lineHeight: 1.55, color: "var(--ink-soft)" })}>{inviteUrl}</p><Button variant="ghost" glyph={copied ? "check" : "copy"} onClick={() => void copy()}>{copied ? "Copied" : "Copy link"}</Button><p className={css({ mt: "0.75rem", fontSize: "0.7rem", color: "var(--ink-soft)" })}>Expires in 7 days · up to 25 uses</p></div>
					</div>}
					{error && <p role="alert" className={css({ mt: "0.75rem", color: "var(--destructive)", fontSize: "0.78rem" })}>{error}</p>}
				</div>
			</section>
		</div>
	);
}
