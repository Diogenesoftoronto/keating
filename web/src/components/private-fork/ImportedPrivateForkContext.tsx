import type { ReactNode } from "react";
import { ArrowUpRight, BookOpen } from "lucide-react";
import { css } from "../../../styled-system/css";
import { privateForkId } from "../../keating/private-fork-provenance";

function sourceRecord(provenance: unknown): Record<string, unknown> | null {
  if (!provenance || typeof provenance !== "object") return null;
  const source = (provenance as { source?: unknown }).source;
  return source && typeof source === "object" && !Array.isArray(source)
    ? source as Record<string, unknown>
    : null;
}

/** Reconstruct only known app routes; persisted source URLs are untrusted. */
export function privateForkSourceLink(provenance: unknown): { href: string; label: string; note: string } | null {
  const source = sourceRecord(provenance);
  if (!source) return null;
  try {
    if (source.kind === "room") {
      const roomId = privateForkId(source.roomId as string);
      const messageId = privateForkId(source.sourceMessageId as string);
      return {
        href: `/rooms/${roomId}#room-message-${messageId}`,
        label: "Return to source room",
        note: "Opens in a new tab. Earlier messages may need to be loaded in the room.",
      };
    }
    if (source.kind === "lesson" && source.field === "reading") {
      const courseId = privateForkId(source.courseId as string);
      const lessonId = privateForkId(source.lessonId as string);
      return {
        href: `/courses/${courseId}?lesson=${lessonId}#lesson-reading-${lessonId}`,
        label: "Return to source lesson",
        note: "Opens the lesson reading in a new tab. It may have changed since this copy was saved.",
      };
    }
  } catch {
    // A damaged source still represents imported context, but has no safe link.
  }
  return null;
}

/** A compact display of the original seed; never a replacement for its content. */
export function ImportedPrivateForkContext({ provenance, content, copyAction }: {
  provenance: unknown;
  content: string;
  copyAction?: ReactNode;
}) {
  const source = sourceRecord(provenance);
  const link = privateForkSourceLink(provenance);
  const label = source?.kind === "room" ? "Imported room context"
    : source?.kind === "lesson" ? "Imported lesson context" : "Imported source context";
  return (
    <section aria-label={label} className={css({
      width: "100%", minWidth: 0, border: "1px solid var(--border)",
      bg: "color-mix(in srgb, var(--foreground) 4%, var(--background))",
      color: "var(--foreground)", p: "0.85rem", fontFamily: "var(--font-ui)",
      fontSize: "0.82rem", lineHeight: 1.5, overflowWrap: "anywhere",
    })}>
      <div className={css({ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "0.35rem" })}>
        <h3 className={css({ display: "flex", alignItems: "center", gap: "0.4rem", fontWeight: 750 })}>
          <BookOpen size={15} aria-hidden="true" /> {label}
        </h3>
        {copyAction}
      </div>
      <p className={css({ mt: "0.25rem" })}>Source material copied into this private chat. Original speakers and quotations are preserved below.</p>
      <details className={css({ mt: "0.6rem" })}>
        <summary className={css({
          cursor: "pointer", fontWeight: 700,
          _hover: { textDecoration: "underline" },
          _focusVisible: { outline: "2px solid var(--foreground)", outlineOffset: "3px" },
        })}>View full imported context</summary>
        <pre className={css({ mt: "0.6rem", whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontFamily: "inherit", fontSize: "0.8rem", lineHeight: 1.6 })}>{content}</pre>
      </details>
      {link ? (
        <div className={css({ mt: "0.75rem" })}>
          <a href={link.href} target="_blank" rel="noopener noreferrer" className={css({
            display: "inline-flex", alignItems: "center", gap: "0.3rem",
            border: "1px solid var(--border)", px: "0.65rem", py: "0.4rem",
            fontWeight: 700, textDecoration: "none", color: "inherit",
            _hover: { bg: "color-mix(in srgb, var(--foreground) 8%, var(--background))" },
            _focusVisible: { outline: "2px solid var(--foreground)", outlineOffset: "2px" },
          })}>
            {link.label} <ArrowUpRight size={14} aria-hidden="true" />
          </a>
          <p className={css({ mt: "0.25rem", fontSize: "0.74rem" })}>{link.note}</p>
        </div>
      ) : (
        <p className={css({ mt: "0.6rem", fontSize: "0.74rem" })}>The original source link is unavailable. The saved context is still available above.</p>
      )}
    </section>
  );
}
