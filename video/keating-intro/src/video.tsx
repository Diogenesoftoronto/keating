import React from "react";
import {
  AbsoluteFill,
  Audio,
  Easing,
  interpolate,
  Loop,
  OffthreadVideo,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export interface IntroScene {
  clipSrc: string;
  clipDurationSeconds: number;
  title: string;
  kicker: string;
  body: string;
  weight: number;
}

export interface KeatingIntroProps {
  audioSrc: string | null;
  durationSeconds: number;
  scenes: IntroScene[];
}

const palette = {
  ink: "#171512",
  parchment: "#f2ead6",
  cream: "#fff7df",
  terracotta: "#c45f38",
  sage: "#7f9864",
  slate: "#2f4050",
};

function sceneDurations(scenes: IntroScene[], totalFrames: number): number[] {
  const weightTotal = scenes.reduce((sum, scene) => sum + scene.weight, 0);
  let used = 0;
  return scenes.map((scene, index) => {
    if (index === scenes.length - 1) {
      return Math.max(1, totalFrames - used);
    }
    const frames = Math.max(1, Math.round((scene.weight / weightTotal) * totalFrames));
    used += frames;
    return frames;
  });
}

const SceneCard: React.FC<{ scene: IntroScene; duration: number }> = ({ scene, duration }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const fade = interpolate(frame, [0, 18, duration - 18, duration], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.2, 0.8, 0.2, 1),
  });
  const lift = interpolate(frame, [0, duration], [24, -18], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const clipFrames = Math.max(1, Math.round(scene.clipDurationSeconds * fps));

  return (
    <AbsoluteFill style={{ backgroundColor: palette.ink, overflow: "hidden" }}>
      <Loop durationInFrames={clipFrames}>
        <OffthreadVideo
          src={staticFile(scene.clipSrc)}
          muted
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            filter: "saturate(0.95) contrast(1.12) brightness(0.72)",
            transform: `scale(1.05) translateY(${lift}px)`,
          }}
        />
      </Loop>
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(90deg, rgba(23,21,18,0.96) 0%, rgba(23,21,18,0.76) 38%, rgba(23,21,18,0.22) 70%, rgba(23,21,18,0.08) 100%)",
        }}
      />
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(circle at 72% 20%, rgba(196,95,56,0.26), transparent 30%), linear-gradient(0deg, rgba(23,21,18,0.4), transparent 42%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 120,
          top: 128,
          width: 780,
          opacity: fade,
          transform: `translateY(${interpolate(frame, [0, 24], [18, 0], {
            extrapolateRight: "clamp",
          })}px)`,
          color: palette.cream,
          fontFamily: "Georgia, 'Times New Roman', serif",
        }}
      >
        <div
          style={{
            color: palette.sage,
            fontSize: 31,
            textTransform: "uppercase",
            letterSpacing: 0,
            fontWeight: 700,
            marginBottom: 22,
          }}
        >
          {scene.kicker}
        </div>
        <div
          style={{
            fontSize: 104,
            lineHeight: 0.92,
            fontWeight: 800,
            marginBottom: 32,
            textShadow: "0 7px 26px rgba(0,0,0,0.36)",
          }}
        >
          {scene.title}
        </div>
        <div
          style={{
            width: 118,
            height: 8,
            background: palette.terracotta,
            marginBottom: 34,
          }}
        />
        <div
          style={{
            color: palette.parchment,
            fontSize: 39,
            lineHeight: 1.22,
            maxWidth: 710,
            textShadow: "0 5px 20px rgba(0,0,0,0.42)",
          }}
        >
          {scene.body}
        </div>
      </div>
      <div
        style={{
          position: "absolute",
          left: 120,
          bottom: 78,
          color: "rgba(255,247,223,0.72)",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
          fontSize: 24,
          opacity: fade,
        }}
      >
        keating.help / cognitive empowerment through Socratic AI
      </div>
      <div
        style={{
          position: "absolute",
          right: 76,
          bottom: 68,
          width: 320,
          height: 6,
          background: "rgba(255,247,223,0.18)",
        }}
      >
        <div
          style={{
            width: `${interpolate(frame, [0, duration], [0, 100], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            })}%`,
            height: "100%",
            background: palette.terracotta,
          }}
        />
      </div>
    </AbsoluteFill>
  );
};

export const KeatingIntro: React.FC<KeatingIntroProps> = ({ audioSrc, durationSeconds, scenes }) => {
  const { fps } = useVideoConfig();
  const totalFrames = Math.round(durationSeconds * fps);
  const durations = sceneDurations(scenes, totalFrames);
  let from = 0;

  return (
    <AbsoluteFill style={{ backgroundColor: palette.ink }}>
      {audioSrc ? <Audio src={staticFile(audioSrc)} /> : null}
      {scenes.map((scene, index) => {
        const duration = durations[index];
        const sequence = (
          <Sequence key={scene.clipSrc} from={from} durationInFrames={duration}>
            <SceneCard scene={scene} duration={duration} />
          </Sequence>
        );
        from += duration;
        return sequence;
      })}
    </AbsoluteFill>
  );
};
