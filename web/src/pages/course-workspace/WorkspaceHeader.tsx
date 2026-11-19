import { CourseAddMenu } from "../../components/courses/CourseAddMenu";
import type { CourseBuilderSection } from "../../components/courses/CourseBuilder";
import { CourseSwitcher } from "../../components/courses/CourseSwitcher";
import { AppBar, Button, ButtonLink, IconButton, Kbd, Menu, Sheet, StatusDot, SubBar, Tabs } from "../../design-system/kit";
import { Link } from "@tanstack/react-router";
import { KeatingBot } from "../../components/KeatingBot";
import { useState } from "react";
import type { ReactNode } from "react";
import { courseChatSearch } from "../../courses/course-ask";
import type { CourseViewerSnapshot } from "../../courses/contracts";
import { workspaceTabs } from "./model";
import type { WorkspaceMutate, WorkspaceView } from "./state";

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
  unread?: number;
  navigation?: ReactNode;
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
  unread = 0,
  navigation,
}: WorkspaceHeaderProps) {
  const [connectionOpen, setConnectionOpen] = useState(false);
  const { course, viewer, permissions } = snapshot;
  return (
    <>
      <AppBar
        className="cw-bar"
        menu={false}
        start={
          <>
            <ButtonLink className="cw-back k-bloom" variant="ghost" to="/courses" aria-label="Back to courses" glyph="left" />
            <CourseSwitcher courseId={course.id} title={course.title} role={viewer.role} />
          </>
        }
        title={null}
      >
        <Button
          variant="line"
          glyph="search"
          onClick={onOpenPalette}
          aria-label="Search this course"
          title="Search this course · ⌘K"
        >
          Search this course <Kbd>⌘K</Kbd>
        </Button>
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
          className="k-button k-line k-md"
        >
          <KeatingBot size={20} label="" />
          Keating
        </Link>
        {permissions.canInvite && (
          <Button variant="line" onClick={onOpenInvite}>
            Invite
          </Button>
        )}
        <span role="status" className="cw-network">
          <StatusDot tone={networkStatus === "connected" ? "ok" : "warn"} />
          {networkStatus}
          {saving && " · saving…"}
        </span>
        {snapshot.network?.publicKey && (
          <Menu label="Course options" trigger={<IconButton label="Course options" glyph="more" />}
            items={[{ id: "connection", label: "Connection details", onSelect: () => setConnectionOpen(true) }]} />
        )}
      </AppBar>
      {connectionOpen && snapshot.network?.publicKey && (
        <Sheet open onClose={() => setConnectionOpen(false)} title="Connection details">
          <p className="cw-connection-key">Pear feed · {snapshot.network.publicKey}</p>
        </Sheet>
      )}
      <SubBar className="cw-sub">
        <Tabs
          label="Course views"
          items={workspaceTabs(permissions).map((tab) => ({
            id: tab.id,
            label: tab.label,
            glyph: tab.icon,
            ...(tab.id === "discuss" && unread ? { count: unread } : {}),
          }))}
          value={view}
          onChange={(id) => onViewChange(id as WorkspaceView)}
        />
        {navigation}
      </SubBar>
    </>
  );
}
