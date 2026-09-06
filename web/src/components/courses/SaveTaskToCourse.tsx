import { Select } from "../Select";
import { createContext, useContext, useId, useRef, useState } from "react";
import { BookPlus, Check, FolderOpen, RotateCcw } from "lucide-react";
import type { UiTaskNode } from "@keating/learner-contracts";
import { applyCourseOperation, getCourse, listCourses, newCourseOperationId } from "../../courses/client";
import type { CourseListItem, CourseViewerSnapshot } from "../../courses/contracts";
import { taskToCourseAssignment } from "../../courses/task-assignments";
import "../assignment-controls.css";

export const TaskCourseServices = createContext({ listCourses, getCourse, applyCourseOperation });

export function SaveTaskToCourse({ task }: { task: UiTaskNode }) {
  const { listCourses, getCourse, applyCourseOperation } = useContext(TaskCourseServices);
  const controlId = useId();
  const [courses, setCourses] = useState<CourseListItem[]>();
  const [selected, setSelected] = useState("");
  const [destination, setDestination] = useState("");
  const [snapshot, setSnapshot] = useState<CourseViewerSnapshot>();
  const [phase, setPhase] = useState<"idle" | "courses" | "destinations" | "saving">("idle");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<{ course: string; destination: string }>();
  const [assignmentId] = useState(() => `assignment_${crypto.randomUUID().replaceAll("-", "")}`);
  const [operationId] = useState(newCourseOperationId);
  const request = useRef(0);
  const writing = useRef(false);
  async function load() {
    if (writing.current) return;
    const token = ++request.current;
    setPhase("courses"); setError("");
    try {
      const available = (await listCourses()).filter((course) => course.role === "owner" || course.role === "teacher");
      if (token === request.current) setCourses(available);
    } catch (cause) {
      if (token === request.current) setError(cause instanceof Error ? cause.message : "Could not load courses.");
    } finally { if (token === request.current) setPhase("idle"); }
  }
  async function chooseCourse(courseId: string) {
    if (writing.current) return;
    const token = ++request.current;
    setSelected(courseId); setDestination(""); setSnapshot(undefined); setError("");
    if (!courseId) { setPhase("idle"); return; }
    setPhase("destinations");
    try {
      const loaded = await getCourse(courseId);
      if (token === request.current) setSnapshot(loaded);
    } catch (cause) {
      if (token === request.current) setError(cause instanceof Error ? cause.message : "Could not load course destinations.");
    } finally { if (token === request.current) setPhase("idle"); }
  }
  async function save() {
    if (writing.current || !selected || !snapshot || phase !== "idle") return;
    writing.current = true;
    setPhase("saving"); setError("");
    try {
      const latest = await getCourse(selected);
      setSnapshot(latest);
      const lesson = latest.course.modules.flatMap((module) => module.lessons).find((lesson) => lesson.id === destination);
      if (destination && !lesson) { setDestination(""); throw new Error("That lesson is no longer available. Choose a destination again."); }
      await applyCourseOperation({ id: operationId, courseId: selected, baseRevision: latest.course.revision,
        type: "assignment.upsert", assignment: taskToCourseAssignment(task, assignmentId, destination || undefined) });
      setSaved({ course: latest.course.title, destination: lesson?.title ?? "Course assignments" });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save this assignment."); }
    finally { writing.current = false; setPhase("idle"); }
  }
  if (saved) return <div className="task-course task-course--saved" role="status"><Check aria-hidden="true" /><span><strong>Saved to {saved.course}</strong><span className="assignment-control__hint">{saved.destination}</span></span></div>;
  const loadingCourse = phase === "destinations";
  const saving = phase === "saving";
  return <div className="task-course">
    {courses === undefined ? <button type="button" className="task-course__button task-course__open" disabled={phase !== "idle"} onClick={() => void load()}><BookPlus aria-hidden="true" />{phase === "courses" ? "Loading courses…" : error ? "Retry courses" : "Save to course"}</button> : courses.length === 0 ? <div className="task-course__empty"><p>No courses you can edit yet.</p><button type="button" className="task-course__button task-course__secondary" disabled={phase !== "idle"} onClick={() => void load()}><RotateCcw aria-hidden="true" />{phase === "courses" ? "Loading courses…" : "Refresh courses"}</button></div> : <>
      <div className="task-course__fields">
        <label className="task-course__field" htmlFor={`${controlId}-course`}><span>Course</span><Select id={`${controlId}-course`} className="task-course__select" value={selected} disabled={saving} onValueChange={(value) => void chooseCourse(value)}>
          <option value="">Choose a course</option>{courses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}
        </Select></label>
        <label className="task-course__field" htmlFor={`${controlId}-destination`}><span>Destination</span><Select id={`${controlId}-destination`} className="task-course__select" value={destination} disabled={!snapshot || loadingCourse || saving} onValueChange={(value) => setDestination(value)}>
          <option value="">{loadingCourse ? "Loading destinations…" : !selected ? "Choose a course first" : "Course assignments"}</option>
          {snapshot?.course.modules.filter((module) => module.lessons.length).map((module) => <optgroup key={module.id} label={module.title}>{module.lessons.map((lesson) => <option key={lesson.id} value={lesson.id}>{lesson.title}</option>)}</optgroup>)}
        </Select></label>
      </div>
      {snapshot && <p className="task-course__location"><FolderOpen aria-hidden="true" /><span>{snapshot.course.title}<span className="assignment-control__hint">{destination ? snapshot.course.modules.flatMap((module) => module.lessons).find((lesson) => lesson.id === destination)?.title : "Course assignments"}</span></span></p>}
      <button type="button" className="task-course__button task-course__save" disabled={!selected || !snapshot || phase !== "idle"} onClick={() => void save()}><BookPlus aria-hidden="true" />{saving ? "Saving assignment…" : "Save assignment"}</button>
      {loadingCourse && <p className="assignment-control__status" role="status">Loading destinations…</p>}
      {error && selected && !snapshot && <button type="button" className="task-course__button task-course__secondary" disabled={phase !== "idle"} onClick={() => void chooseCourse(selected)}><RotateCcw aria-hidden="true" />Retry destinations</button>}
    </>}
    {error && <p className="assignment-control__error" role="alert">{error}</p>}
  </div>;
}
