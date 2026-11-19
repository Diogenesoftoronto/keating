import { useEffect, useState } from "react";
import { usePostHog } from "@posthog/react";
import { Link, useNavigate } from "@tanstack/react-router";
import { motion } from "motion/react";
import {
  AppBar,
  Button,
  ButtonLink,
  Card,
  Chip,
  Eyebrow,
  EmptyState,
  Loading,
  SearchField,
} from "../design-system/kit";
import { Meter } from "../design-system/charts";
import { KeatingGlyph } from "../design-system/glyphs";
import { SOFT, useMotionAllowed } from "../design-system/motion";
import "./course-workspace/courses.css";
import { KeatingBot } from "../components/KeatingBot";
import "./courses-mascot.css";
import { CoursesAccessGate } from "../components/courses/CoursesAccessGate";
import { CourseAssembler } from "../components/courses/CourseAssembler";
import { listCourses } from "../courses/client";
import type { CourseListItem } from "../courses/contracts";
import { type CoursesAccount, useCoursesAccess } from "../courses/useCoursesAccess";
import { useSeo } from "../hooks/useSeo";

type LibraryFilter = "All" | "Learning" | "Teaching";
const isTeaching = (course: CourseListItem) => course.role === "owner" || course.role === "teacher";

export function courseLibraryView(courses: CourseListItem[], filter: LibraryFilter, query: string) {
  const teachers = courses.filter(isTeaching).length;
  const counts = { All: courses.length, Learning: courses.length - teachers, Teaching: teachers };
  const needle = query.trim().toLowerCase();
  const visible = courses.filter(
    (course) =>
      (filter === "All" || isTeaching(course) === (filter === "Teaching")) &&
      [course.title, course.description].some((value) => value.toLowerCase().includes(needle)),
  );
  return { counts, visible };
}

export function CourseCard({ course, featured = false }: { course: CourseListItem; featured?: boolean }) {
  const next = course.nextLesson;
  const complete = course.lessonCount > 0 && course.completedLessons >= course.lessonCount;
  return (
    <Card as="article" tone={featured ? "hard" : "plain"} className={featured ? "cw-course k-lift" : "cw-course"}>
      <Link className="courses-card-main" to="/courses/$courseId" params={{ courseId: course.id }} search={next ? { lesson: next.id } : {}}>
        <div className="cw-row">
          <Chip>{course.role[0]!.toUpperCase() + course.role.slice(1)}</Chip>
          <small>{course.memberCount} {course.memberCount === 1 ? "person" : "people"}{course.presentCount !== undefined && ` · ${course.presentCount} here`}</small>
        </div>
        <h2>{course.title}</h2>
        <p>{course.description || "A shared course in progress."}</p>
        <Meter
          label={`${course.title} progress`}
          value={course.completedLessons}
          max={course.lessonCount}
          valueText={`${course.completedLessons} of ${course.lessonCount} lessons`}
        />
        {complete && !next && <strong>All lessons complete</strong>}
        <div className="cw-course-next">
          <span>{next ? `Continue · Lesson ${next.position} · ${next.title}` : "Open course"}</span>
          <KeatingGlyph name="right" />
        </div>
      </Link>
      {isTeaching(course) && course.pendingSubmissions !== undefined && (
        <Link className="courses-card-review" to="/courses/$courseId" params={{ courseId: course.id }} search={{ tab: "review" }}>
          {course.pendingSubmissions} waiting on you <KeatingGlyph name="right" />
        </Link>
      )}
    </Card>
  );
}

function CourseLibrary({ account }: { account: CoursesAccount }) {
  const [filter, setFilter] = useState<LibraryFilter>("All");
  const [query, setQuery] = useState("");
  const motionAllowed = useMotionAllowed();
  const posthog = usePostHog();
  const navigate = useNavigate();
  const [courses, setCourses] = useState<CourseListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [assemblerOpen, setAssemblerOpen] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    listCourses()
      .then((items) => {
        if (!cancelled) {
          setCourses(items);
          posthog?.capture("course_library_loaded", {
            success: true,
            course_count: items.length,
            workspace_mode: account.mode,
          });
        }
      })
      .catch((cause) => {
        if (!cancelled) {
          posthog?.capture("course_library_loaded", {
            success: false,
            failure_type: cause instanceof Error ? cause.name : "unknown",
            workspace_mode: account.mode,
          });
          setError(cause instanceof Error ? cause.message : "Courses could not be loaded.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [account.mode, posthog]);

  const selectCreationMethod = (method: "chat" | "manual", source: "header" | "empty_state") => {
    posthog?.capture("course_creation_method_selected", {
      method,
      source,
      workspace_mode: account.mode,
    });
    if (method === "manual") setAssemblerOpen(true);
  };

  const { counts, visible } = courseLibraryView(courses, filter, query);
  const empty = !loading && !error && !courses.length && !assemblerOpen;
  const plan = (source: "header" | "empty_state") => (
    <Link
      to="/chat"
      search={{ courseMode: "create" }}
      className="k-button k-primary k-md k-lift"
      onClick={() => selectCreationMethod("chat", source)}
    >
      <KeatingGlyph name="spark" />
      Plan with Keating
    </Link>
  );
  return (
    <>
      <AppBar
        className="cw-bar"
        start={<img className="courses-wordmark" src="/brand/logo-lockup-compact.avif" alt="Keating" />}
        title="Courses"
        back={{ label: "Chat", to: "/chat" }}
        subtitle={
          account.mode === "hosted"
            ? "Account workspace"
            : account.mode === "development"
              ? "Development workspace"
              : "Local workspace"
        }
      >
        <SearchField data-glyph-host
          label="Find a course"
          placeholder="Find a course…"
          value={query}
          onChange={setQuery}
        />
        {!empty && (
          <>
            <Button
              variant="line"
              aria-expanded={assemblerOpen}
              onClick={() =>
                assemblerOpen ? setAssemblerOpen(false) : selectCreationMethod("manual", "header")
              }
            >
              {assemblerOpen ? "Close assembler" : "Assemble manually"}
            </Button>
            {plan("header")}
          </>
        )}
      </AppBar>
      <main className="cw-library">
        <header className="courses-welcome k-halftone k-green">
          <KeatingBot
            variant="body"
            size={52}
            label=""
            animated={!error}
            state={error ? "idle" : loading ? "loading" : assemblerOpen ? "thinking" : "books"}
          />
          <div>
            <h1>What’s next to learn?</h1>
            <p>Pick up where you left off, or build something new with Keating.</p>
          </div>
          <div className="cw-row cw-filters">
            {(["All", "Learning", "Teaching"] as const).map((item) => (
              <Chip
                as="button"
                key={item}
                selected={item === filter}
                count={counts[item]}
                onClick={() => setFilter(item)}
              >
                {item}
              </Chip>
            ))}
          </div>
        </header>
        {assemblerOpen && (
          <CourseAssembler
            account={account}
            onClose={() => setAssemblerOpen(false)}
            onCreated={(courseId) => {
              void navigate({ to: "/courses/$courseId", params: { courseId } });
            }}
          />
        )}

        {error && <p role="alert">{error}</p>}
        {loading ? (
          <Loading label="Opening your library…" className="cw-state" />
        ) : empty ? (
          <section className="cw-empty">
            <EmptyState heading={<span role="heading" aria-level={2}>Bring your first big question.</span>} actions={<>
              {plan("empty_state")}
              <Button variant="ghost" onClick={() => selectCreationMethod("manual", "empty_state")}>Or assemble manually</Button>
            </>}>
              What would you love to understand? Tell Keating what you want to learn and bring any
              notes or readings. You’ll shape the outline together before building your first course.
            </EmptyState>
            <div className="courses-blocks">
              <Eyebrow>Your building blocks</Eyebrow>
              <ul>
                <li>Blank modules and lessons</li>
                <li>StudyPlans from saved chats</li>
                <li>Selected plan sections</li>
                <li>Saved flashcard decks</li>
                <li>Quizzes, visuals, documents, and images</li>
                <li>Editable questions, assignments, and cards</li>
              </ul>
            </div>
          </section>
        ) : (
          courses.length > 0 && (
            <section aria-label="Your courses" className="cw-cards">
              {visible.map((course, index) => (
                <motion.div
                  key={course.id}
                  initial={motionAllowed ? { y: 6 } : false}
                  animate={{ y: 0 }}
                  transition={
                    motionAllowed ? { ...SOFT, delay: Math.min(index, 6) * 0.06 } : { duration: 0 }
                  }
                >
                  <CourseCard course={course} featured={index === 0} />
                </motion.div>
              ))}
              {!visible.length && <EmptyState role="status" glyph="search" heading="No courses match this filter." />}
            </section>
          )
        )}
        <footer data-glyph-host className="cw-row cw-library-footer">
          <KeatingGlyph name="book" /> Just one paper or topic?
          <ButtonLink variant="ghost" to="/learn">
            Study it at your own pace
          </ButtonLink>
          <small>Courses keep lessons, sources, notes, cards and teacher review together</small>
        </footer>
      </main>
    </>
  );
}

export function Courses() {
  useSeo({
    title: "Courses — Keating",
    description: "Durable, shareable lesson plans for peers, students, and teachers.",
  });
  const [access, retry] = useCoursesAccess();
  return (
    <div className="cw-page">
      {access.status === "ready" ? (
        <CourseLibrary account={access.account} />
      ) : (
        <>
          <AppBar title="Courses" back={{ label: "Chat", to: "/chat" }} />
          <CoursesAccessGate state={access} onRetry={retry} />
        </>
      )}
    </div>
  );
}
