import React from "react";
import { Composition } from "remotion";
import { KeatingIntro, type KeatingIntroProps } from "./video";

const fps = 30;

const defaultProps: KeatingIntroProps = {
  audioSrc: null,
  durationSeconds: 96,
  scenes: [
    {
      clipSrc: "docs/assets/intro.mp4",
      clipDurationSeconds: 12,
      title: "Keating",
      kicker: "The hyperteacher",
      body: "A Socratic AI scaffold for people who still want to own their understanding.",
      weight: 1.05,
    },
    {
      clipSrc: "docs/assets/learning-flow.mp4",
      clipDurationSeconds: 15,
      title: "Artifacts you can inspect",
      kicker: "Plans, maps, animations",
      body: "Keating turns a topic into visible learning material instead of a disposable answer.",
      weight: 1.1,
    },
    {
      clipSrc: "docs/assets/teacher-flow.mp4",
      clipDurationSeconds: 13,
      title: "Teach, then verify",
      kicker: "Grounded pedagogy",
      body: "Lesson plans and verification checklists keep the teaching loop accountable.",
      weight: 0.95,
    },
    {
      clipSrc: "docs/assets/session-flow.mp4",
      clipDurationSeconds: 13,
      title: "A live shell",
      kicker: "Policy, outputs, feedback",
      body: "The learner can inspect the teacher, browse artifacts, and record signals as the session unfolds.",
      weight: 1,
    },
    {
      clipSrc: "docs/assets/improve-flow.mp4",
      clipDurationSeconds: 16,
      title: "It studies itself",
      kicker: "Benchmarks and evolution",
      body: "Policy search and prompt evolution make improvement visible instead of mysterious.",
      weight: 1.15,
    },
    {
      clipSrc: "docs/assets/tests.mp4",
      clipDurationSeconds: 11,
      title: "Grounded by tests",
      kicker: "Diagnostics and checks",
      body: "Keating keeps its teaching machinery tied to reproducible local workflows.",
      weight: 0.85,
    },
    {
      clipSrc: "docs/assets/feedback-flow.mp4",
      clipDurationSeconds: 12,
      title: "Own the voice",
      kicker: "Why it exists",
      body: "The goal is not passive agreement. The goal is a learner who can reconstruct, transfer, and speak.",
      weight: 1.05,
    },
  ],
};

export const RemotionRoot: React.FC = () => (
  <Composition
    id="KeatingIntro"
    component={KeatingIntro}
    durationInFrames={Math.round(defaultProps.durationSeconds * fps)}
    fps={fps}
    width={1920}
    height={1080}
    defaultProps={defaultProps}
    calculateMetadata={({ props }) => ({
      durationInFrames: Math.round((props.durationSeconds ?? defaultProps.durationSeconds) * fps),
    })}
  />
);
