/**
 * Sticky top bar of the course workspace: back link and course switcher,
 * search / add / Keating / invite actions (gated by permissions), the view
 * tabs, and the saving + connection indicator.
 */
import { ArrowLeft, MessageSquareText, Search, Share2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { css, cx } from "../../../styled-system/css";
import { CourseAddMenu } from "../../components/courses/CourseAddMenu";
import type { CourseBuilderSection } from "../../components/courses/CourseBuilder";
import { CourseSwitcher } from "../../components/courses/CourseSwitcher";
import { courseCountChipClass } from "../../components/courses/course-ui";
import { courseChatSearch } from "../../courses/course-ask";
import type { CourseViewerSnapshot } from "../../courses/contracts";
import { workspaceTabs } from "./model";
import type { WorkspaceMutate, WorkspaceView } from "./state";
import { workspaceStyles as s } from "./styles";

export interface WorkspaceHeaderProps {
  snapshot: CourseViewerSnapshot;
  activeLessonId: string | undefined;
  view: WorkspaceView;
  saving: string;
  networkStatus: string;
  mutate: WorkspaceMutate;
  onSnapshot(snapshot: CourseViewerSnapshot): void;
  onError(message: string): void;
  onOpenBuilder(section: CourseBuilderSection): void;
  onViewChange(view: WorkspaceView): void;
  onOpenPalette(): void;
  onOpenInvite(): void;
}

export function WorkspaceHeader({
  snapshot,
  activeLessonId,
  view,
  saving,
  networkStatus,
  mutate,
  onSnapshot,
  onError,
  onOpenBuilder,
  onViewChange,
  onOpenPalette,
  onOpenInvite,
}: WorkspaceHeaderProps) {
  const { course, viewer, permissions } = snapshot;
  return (
      <header className={s.top}>
        <div className={s.topInner}>
          <div
            className={css({
              display: "flex",
              minW: 0,
              flex: 1,
              alignItems: "center",
              gap: "0.5rem",
            })}
          >
            <Link
              to="/courses"
              aria-label="Back to courses"
              className={css({
                display: "grid",
                h: "2rem",
                w: "2rem",
                flexShrink: 0,
                placeItems: "center",
                color: "inherit",
                _hover: { bg: "var(--course-wash, #ddebdd)" },
              })}
            >
              <ArrowLeft size={18} />
            </Link>
            <CourseSwitcher
              courseId={course.id}
              title={course.title}
              role={viewer.role}
            />
          </div>
          <div
            className={css({
              display: "flex",
              alignItems: "center",
              gap: "0.4rem",
            })}
          >
            <button
              type="button"
              className={s.button}
              onClick={onOpenPalette}
              title="Search this course · ⌘K"
            >
              <Search size={14} />
              <span className={css({ display: { base: "none", md: "inline" } })}>
                Search
              </span>
              <kbd
                className={css({
                  display: { base: "none", lg: "inline" },
                  fontFamily: "var(--mono-display)",
                  fontSize: "0.6rem",
                  color: "var(--ink-soft)",
                })}
              >
                ⌘K
              </kbd>
            </button>
            <CourseAddMenu
              snapshot={snapshot}
              {...(activeLessonId ? { activeLessonId } : {})}
              saving={saving}
              mutate={mutate}
              onSnapshot={onSnapshot}
              onError={onError}
              onOpenBuilder={onOpenBuilder}
            />
            <Link
              to="/chat"
              search={courseChatSearch(course.id)}
              target="_blank"
              rel="noreferrer"
              aria-label="Work on this course with Keating"
              title="Work on this course with Keating"
              className={cx(
                s.button,
                css({ color: "inherit", textDecoration: "none" }),
              )}
            >
              <MessageSquareText size={15} />
              <span className={css({ display: { base: "none", sm: "inline" } })}>
                Keating
              </span>
            </Link>
            {permissions.canInvite && (
              <button
                type="button"
                className={s.button}
                onClick={onOpenInvite}
              >
                <Share2 size={15} />
                <span
                  className={css({ display: { base: "none", lg: "inline" } })}
                >
                  Invite
                </span>
              </button>
            )}
          </div>
        </div>
        <div className={s.tabRow}>
          <nav
            aria-label="Course views"
            className={css({
              display: "grid",
              w: "100%",
              minW: 0,
              flex: 1,
              gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
              gap: "0.4rem",
              sm: {
                display: "flex",
                w: "auto",
                flexWrap: "wrap",
              },
            })}
          >
            {workspaceTabs(permissions).map((tab) => {
              const Icon = tab.icon;
              const current = view === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  aria-current={current}
                  className={s.tab}
                  style={
                    current
                      ? {
                          borderBottomColor: "var(--course-green, #1e9b50)",
                          color: "var(--ink)",
                        }
                      : undefined
                  }
                  onClick={() => onViewChange(tab.id)}
                >
                  <Icon size={13} /> {tab.label}
                  {tab.id === "discuss" && course.comments.length ? (
                    <span className={courseCountChipClass}>
                      {course.comments.length}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </nav>
          <span
            className={css({
              display: "inline-flex",
              alignItems: "center",
              gap: "0.4rem",
              fontFamily: "var(--mono-display)",
              fontSize: "0.63rem",
              color:
                networkStatus === "connected"
                  ? "var(--course-green-dark, #14743c)"
                  : "var(--amber, #e8a33d)",
            })}
          >
            {saving ? (
              <span className={css({ color: "var(--ink-soft)" })}>saving…</span>
            ) : null}
            <span
              className={css({
                h: "0.45rem",
                w: "0.45rem",
                borderRadius: "50%",
                bg: "currentColor",
              })}
            />
            {networkStatus}
          </span>
        </div>
      </header>
  );
}
