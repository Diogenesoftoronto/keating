import { saveLocalAttachment } from "../../submissions/local-store";
import { useMemo, useState } from "react";
import { SubmissionUploadContext } from "../../components/SubmissionAttachments";
import { TaskCourseServices } from "../../components/courses/SaveTaskToCourse";
import { courseSchema, type CourseViewerSnapshot } from "../../courses/contracts";
import { courseAssignmentToTask } from "../../courses/task-assignments";
import { dispatchSharedUiAction } from "./shared-actions";
import { TaskBrief } from "./shared-renderer";
import type { Meta, StoryObj } from "@storybook/react-vite";
import type { UiActionReceipt, UiDocument, UiTaskNode } from "@keating/learner-contracts";
import { css } from "../../../styled-system/css";
import { SharedUiDocumentRenderer } from "./shared-renderer";

const frameClass = css({ width: "min(48rem, calc(100vw - 2rem))", paddingBlock: "1rem" });

function documentOf(node: UiTaskNode): UiDocument {
	return {
		schemaVersion: 1,
		id: `storybook-${node.id}`,
		revision: 0,
		lifecycle: "ready",
		retention: "workspace",
		supportedSurfaces: ["web", "desktop", "mobile", "terminal"],
		nodes: [node],
		createdAt: "2026-09-01T00:00:00.000Z",
		updatedAt: "2026-09-01T00:00:00.000Z",
	};
}

function StoryFrame({ node, receipts }: { node: UiTaskNode; receipts?: UiActionReceipt[] }) {
  return <InteractiveTask key={node.id} node={node} receipts={receipts} />;
}
function InteractiveTask({ node, receipts = [] }: { node: UiTaskNode; receipts?: UiActionReceipt[] }) {
  const [document, setDocument] = useState(() => documentOf(node));
  const [journal, setJournal] = useState(receipts);
  const [lastSubmission, setLastSubmission] = useState<unknown>();
  const [savedTask, setSavedTask] = useState<UiTaskNode>();
  const storage = useMemo(() => {
    const values = new Map<string, string>();
    return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  }, []);
  const at = "2026-09-01T00:00:00.000Z";
  const member = { accountId: "storybook-teacher", displayName: "You", role: "owner" as const, teacherAccess: "private" as const, joinedAt: at, progress: { completedLessonIds: [], lastActiveAt: at } };
  const snapshot: CourseViewerSnapshot = {
    course: courseSchema.parse({ schemaVersion: 1, id: "storybook-course", title: "Reasoning from evidence", ownerAccountId: member.accountId, createdAt: at, updatedAt: at, revision: 0, members: [member], settings: {} }),
    viewer: member, permissions: { canEditCourse: true, canInvite: true, canReview: true, canEditDeck: true, canRequestTeacherAccess: false },
  };
  return <SubmissionUploadContext.Provider value={saveLocalAttachment}>
    <TaskCourseServices.Provider value={{
      listCourses: async () => [{ id: snapshot.course.id, title: snapshot.course.title, description: "", role: "owner", memberCount: 1, lessonCount: 0, completedLessons: 0, updatedAt: at }],
      getCourse: async () => snapshot,
      applyCourseOperation: async (operation) => {
        if (operation.type === "assignment.upsert") setSavedTask(courseAssignmentToTask({ ...operation.assignment, updatedAt: at, updatedBy: member.accountId }));
        return { snapshot, applied: true };
      },
    }}>
      <div className={frameClass}>
        <p>Submit to save your work on this device, even offline. Course saving uses a demo course.</p>
        <SharedUiDocumentRenderer document={document} receipts={journal} onAction={({ intent }) => {
          const result = dispatchSharedUiAction(storage, document, intent, new Date().toISOString());
          setDocument(result.document); setJournal(result.journal.receipts);
          if (intent.type === "submit-task") setLastSubmission(intent);
          return true;
        }} />
        {savedTask ? <section><h3>Assignment as it appears in the course</h3><TaskBrief node={savedTask} /></section> : null}
        {lastSubmission ? <details><summary>Submitted metadata</summary><pre>{JSON.stringify(lastSubmission, null, 2)}</pre></details> : null}
      </div>
    </TaskCourseServices.Provider>
  </SubmissionUploadContext.Provider>;
}

const meta = {
	title: "Learning/Task",
	component: StoryFrame,
	parameters: { layout: "centered" },
} satisfies Meta<typeof StoryFrame>;

export default meta;
type Story = StoryObj<typeof meta>;

/** One deliverable, done once, judged against criteria stated up front. */
export const Assignment: Story = {
	args: {
		node: {
			type: "task",
			kind: "assignment",
			id: "diagnose-update",
			title: "Diagnose a real update",
			brief: "Find a **published base rate** for any screening test, compute the posterior after one positive result, and write up the point where your intuition disagreed with the arithmetic.\n\nUse a real source. Made-up numbers will not surprise you.",
			criteria: [
				"States the prior explicitly, with its source",
				"Shows the update arithmetic rather than asserting the answer",
				"Names the specific intuition that broke, not just 'it was surprising'",
			],
			estimatedMinutes: 90,
			items: [
				{ id: "source", title: "Find a published base rate", detail: "Cite where it came from." },
				{ id: "compute", title: "Compute the posterior" },
				{ id: "writeup", title: "Write the disagreement up" },
			],
			submission: { format: "text", label: "Your submission", placeholder: "Paste or describe the work you produced." },
		},
	},
};

/** Repetition for fluency: each exercise is checked off on its own. */
export const Practice: Story = {
	args: {
		node: {
			type: "task",
			kind: "practice",
			id: "update-drills",
			title: "Update drills",
			brief: "Work ten updates by hand, until the arithmetic stops being the hard part and the setup becomes the hard part.",
			estimatedMinutes: 45,
			items: [
				{ id: "clean", title: "Five updates with a clean 50% prior" },
				{ id: "rare", title: "Five updates with a 1-in-10,000 prior", detail: "Notice what happens to the answer as the base rate falls." },
				{ id: "reverse", title: "Two worked backwards", detail: "Given a posterior, find the prior it implies." },
			],
			submission: { format: "text", label: "What happened while you practised?", placeholder: "Where did you get stuck, and what did you notice?" },
		},
	},
};

/** Long-form writing, revised over numbered rounds against a rubric. */
export const Draft: Story = {
	args: {
		node: {
			type: "task",
			kind: "draft",
			id: "explain-to-sceptic",
			title: "Explain the update to a sceptic",
			brief: "Write an explanation of Bayesian updating for someone who thinks it is a trick for making made-up numbers look rigorous.\n\nNo formulas until the third paragraph.",
			criteria: [
				"Leads with a concrete case, not a definition",
				"Defines the prior before using it",
				"Answers the sceptic's actual objection rather than ignoring it",
			],
			round: 1,
			submission: { format: "text", label: "Your draft", placeholder: "Write your draft here.", targetWords: 600 },
		},
	},
};

/** Sends the learner out to collect evidence against a protocol. */
export const Fieldwork: Story = {
	args: {
		node: {
			type: "task",
			kind: "fieldwork",
			id: "collect-base-rates",
			title: "Collect real base rates",
			brief: "Gather five published base rates from sources you would actually trust, and record how hard each one was to find.\n\nThe difficulty is part of the finding.",
			estimatedMinutes: 60,
			items: [
				{ id: "collect", title: "Record five base rates with citations" },
				{ id: "disagree", title: "Note which sources disagreed", detail: "Disagreement is the interesting part." },
				{ id: "missing", title: "Note which you could not find at all" },
			],
			submission: { format: "text", label: "Your findings", placeholder: "Record what you observed, and anything that surprised you." },
		},
	},
};

/** After submission: the work is shown back, waiting on the teacher. */
export const Submitted: Story = {
	args: {
		node: Draft.args!.node as UiTaskNode,
		receipts: [{
			schemaVersion: 1,
			action: {
				schemaVersion: 1,
				type: "submit-task",
				documentId: "storybook-explain-to-sceptic",
				documentRevision: 0,
				nodeId: "explain-to-sceptic",
				submission: "A friend of mine took a test for a rare condition and it came back positive. He spent a week assuming the worst, because the leaflet said the test was 99% accurate…",
				round: 1,
				idempotencyKey: "storybook-submit",
			},
			actionFingerprint: "storybook-fingerprint",
			state: "completed",
			createdAt: "2026-09-01T00:00:00.000Z",
			updatedAt: "2026-09-01T00:00:00.000Z",
		}],
	},
};

export const FilesAndCourse: Story = {
  args: { node: { type: "task", kind: "assignment", id: "files-and-course", title: "Submit your investigation", brief: "Attach your report and the data behind it. Save this task to the demo course to see its course presentation.", criteria: ["Claims cite evidence", "The source data is attached"], submission: { format: "text", label: "Summary of your findings" } } },
};
