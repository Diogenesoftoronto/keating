import React from "react";
import { Composition } from "remotion";
import { KeatingIntro, type KeatingIntroProps } from "./video";

const fps = 30;

const defaultProps: KeatingIntroProps = {
  audioSrc: null,
  durationSeconds: 70,
  scenes: [
    {
      shotSrc: "shots/landing.png",
      width: 2560,
      height: 1720,
      kicker: "KEATING 4.0",
      title: "Seen this before?",
      body: "An open-source teacher that asks before it tells.",
      weight: 22.5,
    },
    {
      shotSrc: "shots/profile.png",
      width: 2063,
      height: 1848,
      kicker: "LEARNER PROFILE",
      title: "It remembers who you are",
      body: "Languages, level, and goals shape every lesson.",
      weight: 15.5,
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
