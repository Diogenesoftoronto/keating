import { useMemo, useRef, useState } from "react";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import type { UiSubmissionAttachment, UiTaskNode } from "@keating/learner-contracts";
import { SubmissionAttachments, SubmissionUploadContext } from "./SubmissionAttachments";
import { SaveTaskToCourse, TaskCourseServices } from "./courses/SaveTaskToCourse";
import { courseSchema, type CourseOperation, type CourseViewerSnapshot } from "../courses/contracts";

const task: UiTaskNode = { type: "task", kind: "assignment", id: "controls-story", title: "Submit your investigation", brief: "Attach your report and the data behind it.", criteria: ["Claims cite evidence"] };
const at = "2026-09-01T00:00:00.000Z";
const member = { accountId: "story-teacher", displayName: "You", role: "owner" as const, teacherAccess: "private" as const, joinedAt: at, progress: { completedLessonIds: [], lastActiveAt: at } };
const snapshot: CourseViewerSnapshot = {
  course: courseSchema.parse({ schemaVersion: 1, id: "evidence-course", title: "Reasoning from evidence", ownerAccountId: member.accountId, createdAt: at, updatedAt: at, revision: 3, members: [member], settings: {}, modules: [{ id: "investigation", title: "An investigation", lessons: [{ id: "reading-data", title: "Reading the source data" }, { id: "drawing-conclusions", title: "Drawing conclusions" }] }] }),
  viewer: member, permissions: { canEditCourse: true, canInvite: true, canReview: true, canEditDeck: true, canRequestTeacherAccess: false },
};
const reportName = "investigation-report-with-source-data-and-a-long-filename.txt";

function ControlPreview({ surface = "files", scenario = "ready", onSave }: { surface?: "files" | "courses"; scenario?: "ready" | "slow-file" | "file-error" | "empty-courses" | "course-error" | "save-error"; onSave?: (operation: CourseOperation) => void }) {
  const [files, setFiles] = useState<UiSubmissionAttachment[]>([]);
  const attempts = useRef(0);
  const services = useMemo(() => ({
    listCourses: async () => {
      if (scenario === "course-error") throw new Error("Courses could not be loaded. Try again.");
      return scenario === "empty-courses" ? [] : [{ id: snapshot.course.id, title: snapshot.course.title, description: "", role: "owner" as const, memberCount: 1, lessonCount: 2, completedLessons: 0, updatedAt: at }];
    },
    getCourse: async () => snapshot,
    applyCourseOperation: async (operation: CourseOperation) => {
      if (scenario === "save-error") throw new Error("Assignment could not be saved. Try again.");
      onSave?.(operation);
      return { snapshot, applied: true };
    },
  }), [onSave, scenario]);
  return <div style={{ width: "min(36rem, calc(100vw - 2rem))", paddingBlock: "1rem" }}>
    {surface === "files" ? <SubmissionUploadContext.Provider value={async (file) => {
      attempts.current++;
      if (scenario === "slow-file") await new Promise((resolve) => setTimeout(resolve, 3_000));
      if (scenario === "file-error" && attempts.current === 1) throw new Error("Could not save this file. Try again.");
      return { id: `story-attachment-${attempts.current}`, name: file.name, mimeType: file.type || "text/plain", sizeBytes: file.size };
    }}><SubmissionAttachments value={files} onChange={setFiles} /></SubmissionUploadContext.Provider> : <TaskCourseServices.Provider value={services}><SaveTaskToCourse task={task} /></TaskCourseServices.Provider>}
  </div>;
}

const meta = { title: "Learning/AssignmentControls", component: ControlPreview, parameters: { layout: "centered" }, args: { onSave: fn() } } satisfies Meta<typeof ControlPreview>;
export default meta;
type Story = StoryObj<typeof meta>;

export const AttachFiles: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("button", { name: "Attach files" })).toBeEnabled();
    await userEvent.upload(canvas.getByLabelText("Choose files to attach"), new File(["Source data and findings"], reportName, { type: "text/plain" }));
    await expect(canvas.findByText(reportName)).resolves.toBeTruthy();
    await expect(canvas.getByRole("status")).toHaveTextContent("1 file attached");
  },
};

export const RemoveFile: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.upload(canvas.getByLabelText("Choose files to attach"), new File(["Report"], "report.txt", { type: "text/plain" }));
    await userEvent.click(await canvas.findByRole("button", { name: "Remove report.txt" }));
    await expect(canvas.queryByText("report.txt")).toBeNull();
  },
};

export const SavingFile: Story = {
  args: { scenario: "slow-file" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.upload(canvas.getByLabelText("Choose files to attach"), new File(["Report"], reportName, { type: "text/plain" }));
    await expect(canvas.getByRole("button", { name: "Attaching…" })).toBeDisabled();
    await expect(canvas.getByRole("status")).toHaveTextContent(reportName);
  },
};

export const FailedFile: Story = {
  args: { scenario: "file-error" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.upload(canvas.getByLabelText("Choose files to attach"), new File(["Report"], "report.txt", { type: "text/plain" }));
    await expect(canvas.findByRole("alert")).resolves.toHaveTextContent("report.txt");
    await expect(canvas.getByRole("button", { name: "Retry file" })).toBeEnabled();
  },
};

export const RetryFile: Story = {
  args: { scenario: "file-error" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.upload(canvas.getByLabelText("Choose files to attach"), new File(["Report"], "report.txt", { type: "text/plain" }));
    await userEvent.click(await canvas.findByRole("button", { name: "Retry file" }));
    await expect(canvas.findByText("report.txt", { exact: true })).resolves.toBeTruthy();
    await expect(canvas.queryByRole("alert")).toBeNull();
  },
};

export const CourseDestination: Story = {
  args: { surface: "courses" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Save to course" }));
    await expect(canvas.getByRole("button", { name: "Save assignment" })).toBeDisabled();
    await userEvent.click(canvas.getByRole("combobox", { name: "Course" }));
    await userEvent.click(await within(canvasElement.ownerDocument.body).findByRole("option", { name: "Reasoning from evidence" }));
    await userEvent.click(await canvas.findByRole("combobox", { name: "Destination" }));
    await userEvent.click(await within(canvasElement.ownerDocument.body).findByRole("option", { name: "Reading the source data" }));
    await expect(canvas.getByRole("button", { name: "Save assignment" })).toBeEnabled();
  },
};

export const SavedToLesson: Story = {
  args: { surface: "courses" },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Save to course" }));
    await userEvent.click(canvas.getByRole("combobox", { name: "Course" }));
    await userEvent.click(await within(canvasElement.ownerDocument.body).findByRole("option", { name: "Reasoning from evidence" }));
    await userEvent.click(canvas.getByRole("combobox", { name: "Destination" }));
    await userEvent.click(await within(canvasElement.ownerDocument.body).findByRole("option", { name: "Reading the source data" }));
    await userEvent.click(canvas.getByRole("button", { name: "Save assignment" }));
    await expect(canvas.findByRole("status")).resolves.toHaveTextContent("Saved to Reasoning from evidence");
    await expect(args.onSave).toHaveBeenCalledWith(expect.objectContaining({ courseId: "evidence-course", baseRevision: 3, type: "assignment.upsert", assignment: expect.objectContaining({ lessonId: "reading-data" }) }));
  },
};

export const EmptyCourses: Story = {
  args: { surface: "courses", scenario: "empty-courses" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Save to course" }));
    await expect(canvas.findByText("No courses you can edit yet.")).resolves.toBeTruthy();
  },
};

export const CourseLoadError: Story = {
  args: { surface: "courses", scenario: "course-error" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Save to course" }));
    await expect(canvas.findByRole("alert")).resolves.toHaveTextContent("Courses could not be loaded");
    await expect(canvas.getByRole("button", { name: "Retry courses" })).toBeEnabled();
  },
};

export const CourseSaveError: Story = {
  args: { surface: "courses", scenario: "save-error" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Save to course" }));
    await userEvent.click(canvas.getByRole("combobox", { name: "Course" }));
    await userEvent.click(await within(canvasElement.ownerDocument.body).findByRole("option", { name: "Reasoning from evidence" }));
    await userEvent.click(canvas.getByRole("button", { name: "Save assignment" }));
    await expect(canvas.findByRole("alert")).resolves.toHaveTextContent("Assignment could not be saved");
    await expect(canvas.getByRole("combobox", { name: "Course" })).toHaveTextContent("Reasoning from evidence");
  },
};
