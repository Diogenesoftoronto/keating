/**
 * Notice strips around the chat: course-collaboration context, the browser
 * storage persistence warning and the share-link status. Each is presentational;
 * the page owns the state and passes the callbacks.
 */
import { BookOpen, X } from "lucide-react";
import { css, cx } from "../../../styled-system/css";
import { AppLink as Link } from "../../components/AppLink";
import type { CourseChatContext } from "../../keating/course-collaboration";
import type { ShareState } from "./session-sharing";

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
          <BookOpen size={16} aria-hidden="true" />
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
  return (
    <div
      className={css({
        flexShrink: 0,
        borderBottom: "1px solid var(--border)",
        backgroundColor: "rgb(245 158 11 / 0.1)",
        paddingInline: "0.75rem",
        paddingBlock: "0.5rem",
      })}
    >
      <div
        className={css({
          marginInline: "auto",
          display: "flex",
          maxWidth: "48rem",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.75rem",
        })}
      >
        <div
          className={css({
            display: "flex",
            alignItems: "center",
            gap: "0.5rem",
            fontSize: "0.75rem",
            fontWeight: 500,
            color: "rgb(146 64 14)",
            _dark: { color: "rgb(253 230 138)" },
          })}
        >
          <span
            className={css({ display: "none", sm: { display: "inline" } })}
          >
            Browser storage persistence is not enabled. Sessions still save
            locally, but the browser may clear them under storage pressure.
          </span>
          <span className={css({ sm: { display: "none" } })}>
            Storage persistence is not enabled.
          </span>
        </div>
        <div
          className={css({
            display: "flex",
            flexShrink: 0,
            alignItems: "center",
            gap: "0.5rem",
          })}
        >
          <button
            type="button"
            className={css({
              display: "inline-flex",
              height: "1.5rem",
              alignItems: "center",
              borderRadius: "0.25rem",
              backgroundColor: "var(--primary)",
              paddingInline: "0.5rem",
              fontSize: "10px",
              fontWeight: 500,
              color: "var(--primary-foreground)",
              _hover: {
                backgroundColor:
                  "color-mix(in srgb, var(--primary) 90%, transparent)",
              },
            })}
            onClick={onRetry}
          >
            Try again
          </button>
          <button
            type="button"
            className={cx(
              iconButtonClass,
              css({ width: "1.5rem", height: "1.5rem" }),
            )}
            onClick={onDismiss}
            aria-label="Dismiss persistence warning"
          >
            <X size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}

export function ShareStatusBanner({
  shareState,
  shareUrl,
  shareMessage,
  onConfirm,
  onDismiss,
}: {
  shareState: ShareState;
  shareUrl: string | null;
  shareMessage: string | null;
  onConfirm: () => Promise<void>;
  onDismiss: () => void;
}) {
  return (
    <div
      className={css({
        borderTop: "1px solid var(--border)",
        backgroundColor: "var(--background)",
        paddingInline: "1rem",
        paddingBlock: "0.75rem",
        fontSize: "0.875rem",
      })}
    >
      <div
        className={css({
          marginInline: "auto",
          display: "flex",
          maxWidth: "56rem",
          flexDirection: "column",
          gap: "0.5rem",
          sm: { flexDirection: "row", alignItems: "center" },
        })}
      >
        <span
          className={
            shareState === "error"
              ? css({ color: "var(--destructive)" })
              : css({ color: "var(--muted-foreground)" })
          }
        >
          {shareMessage}
        </span>
        {shareUrl && (
          <input
            className={css({
              minWidth: 0,
              flex: 1,
              borderRadius: "0.375rem",
              border: "1px solid var(--border)",
              backgroundColor: "var(--muted)",
              paddingInline: "0.75rem",
              paddingBlock: "0.5rem",
              fontFamily: "var(--mono-body)",
              fontSize: "0.75rem",
              color: "var(--foreground)",
            })}
            readOnly
            value={shareUrl}
            onFocus={(event) => event.currentTarget.select()}
          />
        )}
        {shareState === "confirm" && (
          <button
            className={css({
              display: "inline-flex",
              height: "2rem",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "0.375rem",
              border: "1px solid var(--border)",
              backgroundColor: "var(--primary)",
              paddingInline: "0.75rem",
              fontSize: "0.75rem",
              color: "var(--primary-foreground)",
              _hover: {
                backgroundColor:
                  "color-mix(in srgb, var(--primary) 90%, transparent)",
              },
            })}
            onClick={onConfirm}
          >
            Share publicly
          </button>
        )}
        <button
          className={css({
            display: "inline-flex",
            height: "2rem",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "0.375rem",
            border: "1px solid var(--border)",
            paddingInline: "0.75rem",
            fontSize: "0.75rem",
            _hover: { backgroundColor: "var(--accent)" },
          })}
          onClick={onDismiss}
        >
          {shareState === "confirm" ? "Cancel" : "Dismiss"}
        </button>
      </div>
    </div>
  );
}
