import { useMemo } from "react";
import { Box, Image as ImageIcon } from "lucide-react";
import { css } from "../../../styled-system/css";
import type { CourseArtifact } from "../../courses/contracts";
import { parseCourseQuiz } from "../../courses/course-artifacts";
import { AnimationPlayer } from "../AnimationPlayer";
import { MarkdownBlock } from "../MarkdownBlock";
import { MermaidRenderer } from "../MermaidRenderer";
import { QuizRenderer } from "../QuizRenderer";
import { KeatingOpenUIRenderer } from "../../keating/openui/renderer";

interface StoredAnimation {
  storyboard: string;
  scene: string;
  manifest: string;
  renderer?: "hyperframes";
}

function parseAnimation(content: string): StoredAnimation | null {
  try {
    const value = JSON.parse(content) as Partial<StoredAnimation>;
    return typeof value.storyboard === "string" &&
      typeof value.scene === "string" &&
      typeof value.manifest === "string"
      ? (value as StoredAnimation)
      : null;
  } catch {
    return null;
  }
}

function safeImageSource(content: string): string | null {
  if (
    /^data:image\/(?:png|jpeg|webp|gif|avif|svg\+xml)(?:;|,)/i.test(content)
  ) {
    return content;
  }
  try {
    const url = new URL(content);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function ArtifactBody({ artifact }: { artifact: CourseArtifact }) {
  const quiz = useMemo(
    () =>
      artifact.format === "quiz" ? parseCourseQuiz(artifact.content) : null,
    [artifact.content, artifact.format],
  );
  const animation = useMemo(
    () =>
      artifact.format === "animation" ? parseAnimation(artifact.content) : null,
    [artifact.content, artifact.format],
  );
  const imageSource = useMemo(
    () =>
      artifact.format === "image" ? safeImageSource(artifact.content) : null,
    [artifact.content, artifact.format],
  );
  if (artifact.format === "markdown")
    return <MarkdownBlock content={artifact.content} />;
  if (artifact.format === "mermaid")
    return <MermaidRenderer content={artifact.content} />;
  if (artifact.format === "quiz" && quiz) return <QuizRenderer quiz={quiz} />;
  if (artifact.format === "openui")
    return (
      <KeatingOpenUIRenderer
        program={artifact.content}
        metadata={{
          id: `course-${artifact.id}`,
          lifecycle: "workspace",
          revision: Math.max(
            0,
            Math.floor(Date.parse(artifact.updatedAt) / 1_000),
          ),
        }}
      />
    );
  if (artifact.format === "animation" && animation)
    return <AnimationPlayer {...animation} />;
  if (artifact.format === "image" && imageSource)
    return (
      <figure>
        <a href={imageSource} target="_blank" rel="noreferrer">
          <img
            src={imageSource}
            alt={artifact.description ?? artifact.title}
            loading="lazy"
            className={css({
              display: "block",
              maxH: "42rem",
              w: "100%",
              objectFit: "contain",
            })}
          />
        </a>
      </figure>
    );
  return (
    <div
      role="alert"
      className={css({
        borderLeft: "3px solid var(--amber, #e8a33d)",
        bg: "#fff0d4",
        p: "0.75rem",
        fontSize: "0.78rem",
      })}
    >
      <p>
        This artifact cannot be rendered interactively, but its saved source is
        intact.
      </p>
      <details className={css({ mt: "0.5rem" })}>
        <summary className={css({ cursor: "pointer", fontWeight: 700 })}>
          View source
        </summary>
        <pre
          className={css({
            mt: "0.5rem",
            maxH: "24rem",
            overflow: "auto",
            whiteSpace: "pre-wrap",
            fontFamily: "var(--mono-body)",
            fontSize: "0.68rem",
          })}
        >
          {artifact.content}
        </pre>
      </details>
    </div>
  );
}

export function CourseArtifactCard({
  artifact,
  courseWide = false,
}: {
  artifact: CourseArtifact;
  courseWide?: boolean;
}) {
  const Icon = artifact.format === "image" ? ImageIcon : Box;
  return (
    <section
      id={`artifact-${artifact.id}`}
      className={css({
        mt: "1.5rem",
        border: "1px solid var(--ink)",
        bg: "var(--paper)",
        boxShadow: "4px 4px 0 color-mix(in srgb, var(--ink) 16%, transparent)",
      })}
    >
      <header
        className={css({
          display: "flex",
          alignItems: "start",
          gap: "0.65rem",
          borderBottom: "1px solid var(--ink)",
          bg: courseWide
            ? "var(--paper-deep, #e9e2d2)"
            : "var(--course-wash, #ddebdd)",
          px: "0.85rem",
          py: "0.7rem",
        })}
      >
        <Icon size={16} className={css({ mt: "0.15rem", flexShrink: 0 })} />
        <div>
          <p
            className={css({
              fontFamily: "var(--mono-display)",
              fontSize: "0.62rem",
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "var(--ink-soft)",
            })}
          >
            {courseWide
              ? "Course artifact"
              : artifact.kind.replaceAll("-", " ")}
          </p>
          <h3
            className={css({
              mt: "0.1rem",
              fontFamily: "Georgia, serif",
              fontSize: "1.25rem",
            })}
          >
            {artifact.title}
          </h3>
          {artifact.description ? (
            <p
              className={css({
                mt: "0.2rem",
                fontSize: "0.75rem",
                color: "var(--ink-soft)",
              })}
            >
              {artifact.description}
            </p>
          ) : null}
        </div>
      </header>
      <div
        className={css({
          overflow: "hidden",
          p: { base: "0.8rem", md: "1rem" },
        })}
      >
        <ArtifactBody artifact={artifact} />
      </div>
    </section>
  );
}
