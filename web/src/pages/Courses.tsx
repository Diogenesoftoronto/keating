import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  ArrowRight,
  BookOpen,
  Clock3,
  MessageSquareText,
  Plus,
  Users,
  X,
} from "lucide-react";
import { css } from "../../styled-system/css";
import { Nav } from "../components/Nav";
import { CoursesAccessGate } from "../components/courses/CoursesAccessGate";
import { CourseAssembler } from "../components/courses/CourseAssembler";
import { listCourses } from "../courses/client";
import type { CourseListItem } from "../courses/contracts";
import {
  type CoursesAccount,
  useCoursesAccess,
} from "../courses/useCoursesAccess";
import { useSeo } from "../hooks/useSeo";

function CourseLibrary({ account }: { account: CoursesAccount }) {
  const navigate = useNavigate();
  const [courses, setCourses] = useState<CourseListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [assemblerOpen, setAssemblerOpen] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    listCourses()
      .then((items) => {
        if (!cancelled) setCourses(items);
      })
      .catch((cause) => {
        if (!cancelled)
          setError(
            cause instanceof Error
              ? cause.message
              : "Courses could not be loaded.",
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main
      className={css({
        mx: "auto",
        maxW: "72rem",
        px: "1rem",
        py: { base: "2rem", md: "3rem" },
      })}
    >
      <header
        className={css({
          display: "flex",
          flexDir: { base: "column", sm: "row" },
          alignItems: { sm: "end" },
          justifyContent: "space-between",
          gap: "1.5rem",
          borderBottom: "2px solid var(--ink)",
          pb: "1.5rem",
        })}
      >
        <div>
          <p
            className={css({
              fontFamily: "var(--mono-display)",
              fontSize: "0.7rem",
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--course-green-dark, #14743c)",
            })}
          >
            Course library ·{" "}
            {account.mode === "hosted"
              ? "Account workspace"
              : account.mode === "development"
                ? "Development workspace"
                : "Local workspace"}
          </p>
          <h1
            className={css({
              mt: "0.35rem",
              fontFamily: "Georgia, serif",
              fontSize: { base: "2.4rem", md: "3.5rem" },
              lineHeight: 1,
            })}
          >
            Learning with a spine.
          </h1>
          <p
            className={css({
              mt: "0.8rem",
              maxW: "54ch",
              color: "var(--ink-soft)",
              lineHeight: 1.6,
            })}
          >
            Lesson plans that carry their readings, practice, peers, and
            progress with them.
          </p>
        </div>
        <div
          className={css({
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: "0.65rem",
          })}
        >
          <Link
            to="/chat"
            search={{ courseMode: "create" }}
            className={css({
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.5rem",
              border: "2px solid var(--ink)",
              bg: "var(--course-green, #1e9b50)",
              px: "1rem",
              py: "0.75rem",
              fontWeight: 800,
              color: "white",
              textDecoration: "none",
              _hover: { bg: "var(--course-green-dark, #14743c)" },
            })}
          >
            <MessageSquareText size={17} /> Plan with Keating
          </Link>
          <button
            type="button"
            onClick={() => setAssemblerOpen((open) => !open)}
            aria-expanded={assemblerOpen}
            className={css({
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.5rem",
              border: "1px solid var(--ink)",
              bg: "var(--paper)",
              px: "1rem",
              py: "0.75rem",
              fontWeight: 750,
              color: "var(--ink)",
              _hover: { bg: "var(--card)" },
            })}
          >
            {assemblerOpen ? <X size={17} /> : <Plus size={17} />}
            {assemblerOpen ? "Close assembler" : "Assemble manually"}
          </button>
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

      {error && (
        <p
          role="alert"
          className={css({
            mt: "1rem",
            borderLeft: "4px solid var(--destructive)",
            bg: "color-mix(in srgb, var(--destructive) 7%, var(--card))",
            p: "0.75rem",
            color: "var(--destructive)",
          })}
        >
          {error}
        </p>
      )}
      {loading ? (
        <p
          className={css({
            py: "5rem",
            textAlign: "center",
            color: "var(--ink-soft)",
          })}
        >
          Opening your library…
        </p>
      ) : courses.length === 0 && !assemblerOpen ? (
        <section
          className={css({
            mt: "2rem",
            display: "grid",
            border: "2px solid var(--ink)",
            bg: "var(--card)",
            md: { gridTemplateColumns: "1fr 1fr" },
          })}
        >
          <div className={css({ p: { base: "1.5rem", md: "2.5rem" } })}>
            <BookOpen size={30} />
            <h2
              className={css({
                mt: "1.25rem",
                fontFamily: "Georgia, serif",
                fontSize: "2rem",
              })}
            >
              Begin with an empty spine.
            </h2>
            <p
              className={css({
                mt: "0.75rem",
                color: "var(--ink-soft)",
                lineHeight: 1.65,
              })}
            >
              Talk through the learners, outcomes, pace, and material you
              already have. Keating will propose an outline, wait for your
              changes, then build the durable course with you.
            </p>
            <div
              className={css({
                mt: "1.5rem",
                display: "flex",
                flexWrap: "wrap",
                alignItems: "center",
                gap: "0.65rem",
              })}
            >
              <Link
                to="/chat"
                search={{ courseMode: "create" }}
                className={css({
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  bg: "var(--ink)",
                  px: "1rem",
                  py: "0.75rem",
                  fontWeight: 700,
                  color: "var(--paper)",
                  textDecoration: "none",
                })}
              >
                Plan with Keating <ArrowRight size={16} />
              </Link>
              <button
                type="button"
                onClick={() => setAssemblerOpen(true)}
                className={css({
                  borderBottom: "1px solid currentColor",
                  py: "0.25rem",
                  fontSize: "0.82rem",
                  fontWeight: 650,
                })}
              >
                Or assemble manually
              </button>
            </div>
          </div>
          <div
            className={css({
              borderTop: "2px solid var(--ink)",
              bg: "var(--course-wash, #ddebdd)",
              p: { base: "1.5rem", md: "2.5rem" },
              md: { borderTop: 0, borderLeft: "2px solid var(--ink)" },
            })}
          >
            <p
              className={css({
                fontFamily: "var(--mono-display)",
                fontSize: "0.72rem",
                fontWeight: 700,
                letterSpacing: "0.08em",
              })}
            >
              YOUR BUILDING BLOCKS
            </p>
            <ul
              className={css({
                mt: "1.25rem",
                display: "grid",
                gap: "1rem",
                color: "var(--ink-soft)",
              })}
            >
              <li>Blank modules and lessons</li>
              <li>StudyPlans from saved chats</li>
              <li>Selected plan sections</li>
              <li>Saved flashcard decks</li>
              <li>Quizzes, visuals, documents, and images</li>
              <li>Editable questions, assignments, and cards</li>
            </ul>
          </div>
        </section>
      ) : courses.length > 0 ? (
        <section
          aria-label="Your courses"
          className={css({
            mt: "2rem",
            display: "grid",
            gap: "1rem",
            md: { gridTemplateColumns: "repeat(2, minmax(0, 1fr))" },
            xl: { gridTemplateColumns: "repeat(3, minmax(0, 1fr))" },
          })}
        >
          {courses.map((course) => (
            <Link
              key={course.id}
              to="/courses/$courseId"
              params={{ courseId: course.id }}
              className={css({
                display: "flex",
                minH: "15rem",
                flexDir: "column",
                border: "2px solid var(--ink)",
                bg: "var(--card)",
                p: "1.25rem",
                color: "inherit",
                textDecoration: "none",
                boxShadow:
                  "4px 4px 0 color-mix(in srgb, var(--ink) 25%, transparent)",
                _hover: {
                  borderColor: "var(--course-green-dark, #14743c)",
                  transform: "translateY(-2px)",
                },
              })}
            >
              <div
                className={css({
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: "0.75rem",
                })}
              >
                <span
                  className={css({
                    bg: "var(--course-wash, #ddebdd)",
                    px: "0.5rem",
                    py: "0.25rem",
                    fontFamily: "var(--mono-display)",
                    fontSize: "0.65rem",
                    fontWeight: 700,
                    textTransform: "uppercase",
                    color: "var(--course-green-dark, #14743c)",
                  })}
                >
                  {course.role}
                </span>
                <ArrowRight size={17} />
              </div>
              <h2
                className={css({
                  mt: "1.25rem",
                  fontFamily: "Georgia, serif",
                  fontSize: "1.6rem",
                  lineHeight: 1.15,
                })}
              >
                {course.title}
              </h2>
              <p
                className={css({
                  mt: "0.65rem",
                  color: "var(--ink-soft)",
                  lineHeight: 1.5,
                  lineClamp: 3,
                })}
              >
                {course.description || "A shared course in progress."}
              </p>
              <div
                className={css({
                  mt: "auto",
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "0.9rem",
                  pt: "1.5rem",
                  fontSize: "0.75rem",
                  color: "var(--ink-soft)",
                })}
              >
                <span
                  className={css({
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.3rem",
                  })}
                >
                  <BookOpen size={14} /> {course.lessonCount} lessons
                </span>
                <span
                  className={css({
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.3rem",
                  })}
                >
                  <Users size={14} /> {course.memberCount}
                </span>
                <span
                  className={css({
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "0.3rem",
                  })}
                >
                  <Clock3 size={14} /> {course.completedLessons} done
                </span>
              </div>
            </Link>
          ))}
        </section>
      ) : null}
    </main>
  );
}

export function Courses() {
  useSeo({
    title: "Courses — Keating",
    description:
      "Durable, shareable lesson plans for peers, students, and teachers.",
  });
  const [access, retry] = useCoursesAccess();
  return (
    <div
      className={css({
        minH: "100vh",
        bg: "var(--paper)",
        color: "var(--ink)",
      })}
    >
      <Nav />
      {access.status === "ready" ? (
        <CourseLibrary account={access.account} />
      ) : (
        <CoursesAccessGate state={access} onRetry={retry} />
      )}
    </div>
  );
}
