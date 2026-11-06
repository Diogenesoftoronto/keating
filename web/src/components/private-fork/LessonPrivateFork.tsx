import { useId, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { LockKeyhole } from "lucide-react";
import { css } from "../../../styled-system/css";
import {
  createLessonPrivateForkSession,
  type LessonPrivateForkContext,
} from "../../courses/private-fork-session";
import { roomStyles } from "../rooms/room-ui";
import { PrivateForkPanel } from "./PrivateForkPanel";

export type LessonPrivateForkNavigation = {
  to: "/chat";
  search: { session: string; ask?: string };
};

export interface LessonPrivateForkProps {
  context: LessonPrivateForkContext;
  /** Product adapter boundary; tests can supply the real adapter with local storage. */
  createSession?: typeof createLessonPrivateForkSession;
  onNavigate?: (destination: LessonPrivateForkNavigation) => void | Promise<void>;
}

/** A changed source closes the picker and invalidates any pending continuation. */
export function LessonPrivateFork(props: LessonPrivateForkProps) {
  const { context } = props;
  return (
    <LessonPrivateForkAction
      key={JSON.stringify([
        context.courseId, context.lessonId, context.revision, context.reading,
      ])}
      {...props}
    />
  );
}

function LessonPrivateForkAction(props: LessonPrivateForkProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  if (!props.context.reading.trim()) return null;
  return (
    <div className={css({ mt: "1rem" })}>
      <button
        ref={trigger}
        type="button"
        className={roomStyles.button}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => open ? close() : setOpen(true)}
      >
        <LockKeyhole size={14} aria-hidden="true" /> Continue privately
      </button>
      {open && (
        <div id={panelId} className={css({ mt: "0.75rem" })}>
          {props.onNavigate ? (
            <LessonPrivateForkEditor {...props} onNavigate={props.onNavigate} onCancel={close} />
          ) : (
            <RoutedLessonPrivateForkEditor {...props} onCancel={close} />
          )}
        </div>
      )}
    </div>
  );
}

type EditorProps = LessonPrivateForkProps & { onCancel: () => void };

function RoutedLessonPrivateForkEditor(props: EditorProps) {
  const navigate = useNavigate();
  return <LessonPrivateForkEditor {...props} onNavigate={navigate} />;
}

function LessonPrivateForkEditor({
  context,
  createSession = createLessonPrivateForkSession,
  onNavigate,
  onCancel,
}: EditorProps & { onNavigate: NonNullable<LessonPrivateForkProps["onNavigate"]> }) {
  const live = useRef(true);
  useLayoutEffect(() => {
    live.current = true;
    return () => { live.current = false; };
  }, []);

  return (
    <PrivateForkPanel
      title="Continue this reading privately"
      sourceText={context.reading}
      sourceLabel={context.lessonTitle}
      sourceKind="lesson"
      onCancel={onCancel}
      onOpen={async ({ passage, question, signal }) => {
        if (signal.aborted || !live.current) return;
        const session = await createSession({ ...context, ...passage }, { question });
        // Persistence cannot be cancelled by this UI. A late result must never
        // move the learner away after cancellation, source changes, or unmount.
        if (signal.aborted || !live.current) return;
        await onNavigate({ to: "/chat", search: { session, ...(question ? { ask: question } : {}) } });
      }}
    />
  );
}
