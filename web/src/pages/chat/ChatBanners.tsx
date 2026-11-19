/**
 * Notice strips around the chat: course-collaboration context, the browser
 * storage persistence warning and the share-link status. Each is presentational;
 * the page owns the state and passes the callbacks.
 */
import { KeatingGlyph } from "../../design-system/glyphs";
import { css, cx } from "../../../styled-system/css";
import { AppLink as Link } from "../../components/AppLink";
import type { CourseChatContext } from "../../keating/course-collaboration";

const iconButtonClass = css({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "0.375rem",
  color: "var(--muted-foreground)",
  transitionProperty: "color, background-color, border-color, opacity",
  transitionDuration: "150ms",
  _hover: {
    backgroundColor: "var(--accent)",
    color: "var(--accent-foreground)",
  },
});

export function CourseContextBanner({
  courseContext,
}: {
  courseContext: CourseChatContext;
}) {
  return (
    <section
      aria-label="Course collaboration context"
      className={css({
        flexShrink: 0,
        borderBottom: "1px solid var(--border)",
        backgroundColor:
          "color-mix(in srgb, var(--primary) 8%, var(--background))",
        paddingInline: "0.75rem",
        paddingBlock: "0.5rem",
      })}
    >
      <div
        className={css({
          marginInline: "auto",
          display: "flex",
          maxWidth: "56rem",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.75rem",
        })}
      >
        <div
          className={css({
            display: "flex",
            minWidth: 0,
            alignItems: "center",
            gap: "0.55rem",
          })}
        >
          <KeatingGlyph name="book" size={16} />
          <div className={css({ minWidth: 0 })}>
            <p className={css({ fontSize: "0.8rem", fontWeight: 650 })}>
              {courseContext.mode === "create"
                ? "Design a course with Keating"
                : "Keating is working in this course"}
            </p>
            <p
              className={css({
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontSize: "0.7rem",
                color: "var(--muted-foreground)",
              })}
            >
              Agree on the shape first, then Keating can create and revise
              the durable workspace.
            </p>
          </div>
        </div>
        <div
          className={css({
            display: "flex",
            flexShrink: 0,
            alignItems: "center",
            gap: "0.5rem",
            fontSize: "0.75rem",
          })}
        >
          {courseContext.activeCourseId && (
            <Link
              to={`/courses/${encodeURIComponent(courseContext.activeCourseId)}`}
              className={css({
                fontWeight: 650,
                textDecoration: "underline",
                textUnderlineOffset: "3px",
              })}
            >
              Open course
            </Link>
          )}
          <Link
            to="/chat"
            className={css({ color: "var(--muted-foreground)" })}
          >
            Leave course mode
          </Link>
        </div>
      </div>
    </section>
  );
}

export function PersistentStorageBanner({
  onRetry,
  onDismiss,
}: {
  onRetry: () => void;
  onDismiss: () => void;
}) {
  const description = "Browser storage persistence is not enabled. Sessions still save locally, but the browser may clear them under storage pressure.";
  return <div className="ch-storage" data-glyph-host>
    <KeatingGlyph name="alert" size={16} /> Storage is not persistent
    <button type="button" aria-description={description} title={description} onClick={onRetry}>Fix</button>
    <button type="button" aria-label="Dismiss persistence warning" onClick={onDismiss}><KeatingGlyph name="x" size={12}/></button>
  </div>;
}

export { ShareSheet as ShareStatusBanner } from "../../components/export/ShareSheet";
