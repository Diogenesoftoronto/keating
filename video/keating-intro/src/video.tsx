import React, { useEffect, useState } from "react";
import {
  AbsoluteFill,
  Audio,
  cancelRender,
  continueRender,
  delayRender,
  Easing,
  Img,
  interpolate,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export interface IntroScene {
  shotSrc: string;
  width: number;
  height: number;
  title: string;
  kicker: string;
  body: string;
  weight: number;
}

export type KeatingIntroProps = {
  /** Header label; spotlights reuse this composition with their own. */
  label?: string;
  audioSrc: string | null;
  durationSeconds: number;
  scenes: IntroScene[];
};

const palette = {
  paper: "#f1ece0",
  ink: "#1c211b",
  green: "#1e9b50",
  deepGreen: "#14743c",
  mint: "#b7f1ce",
  paperDeep: "#e5dfd1",
  inkSoft: "#4a5147",
};
const labelFont = '"JetBrains Mono"';
const stageWidth = 1120;
const stageHeight = 860;

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

const SceneCard: React.FC<{ scene: IntroScene; duration: number; index: number }> = ({ scene, duration, index }) => {
  const frame = useCurrentFrame();
  const enter = (delay: number) => interpolate(frame, [delay, delay + 12], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.exp),
  });
  // Fade out over the last few frames so a cut dips to paper instead of popping.
  const exit = interpolate(frame, [duration - 8, duration - 1], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.in(Easing.quad),
  });
  const textStyle = (delay: number): React.CSSProperties => ({
    opacity: enter(delay) * exit,
    transform: `translateY(${(1 - enter(delay)) * 18}px)`,
  });
  const progress = interpolate(frame, [0, Math.max(1, duration - 1)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.inOut(Easing.sin),
  });
  // Compare height/width in the same orientation as the stage. Cover + objectPosition
  // traverses exactly the vertical overflow, exposing the top and bottom at the ends.
  const tall = scene.height / scene.width > 0.9 * (stageHeight / stageWidth);
  const direction = index % 2 === 0 ? 1 : -1;
  const scale = tall ? 1 : 1.02 + progress * 0.06;
  const drift = tall ? 0 : direction * (progress * 2 - 1) * 8;

  return (
    <AbsoluteFill>
      <div style={{ position: "absolute", left: 96, top: 110, height: stageHeight, width: 560, display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <div style={{ ...textStyle(0), color: palette.green, fontFamily: labelFont, fontWeight: 700, fontSize: 22, letterSpacing: 2, marginBottom: 28 }}>
          [{scene.kicker}]
        </div>
        <div style={{ ...textStyle(4), fontFamily: '"Space Mono"', fontSize: 64, fontWeight: 700, lineHeight: 1.08, letterSpacing: -2.5, marginBottom: 30 }}>
          {scene.title}
        </div>
        <div style={{ ...textStyle(8), fontFamily: '"Roboto"', fontWeight: 500, fontSize: 26, lineHeight: 1.45, color: palette.inkSoft, maxWidth: 510 }}>
          {scene.body}
        </div>
        <div style={{ width: 120, height: 12, background: palette.green, marginTop: 36, opacity: exit, transform: `scaleX(${enter(12)})`, transformOrigin: "left" }} />
      </div>
      <div style={{ position: "absolute", right: 96, top: 110, width: stageWidth, height: stageHeight, boxSizing: "border-box", border: `4px solid ${palette.ink}`, background: palette.paper, boxShadow: `16px 16px 0 ${palette.green}`, opacity: enter(0) * exit, transform: `translateX(${40 * (1 - enter(0))}px)` }}>
        <AbsoluteFill style={{ overflow: "hidden" }}>
          <Img src={staticFile(scene.shotSrc)} style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            // Landscape captures have a paper safety margin so the push never
            // crops the left-aligned product instructions or answer controls.
            width: tall ? "100%" : stageWidth - 96,
            height: tall ? "100%" : (stageWidth - 96) * scene.height / scene.width,
            objectFit: "cover",
            objectPosition: tall ? `50% ${progress * 100}%` : "50% 50%",
            transform: `translate(-50%, -50%) translateX(${drift}px) scale(${scale})`,
          }} />
        </AbsoluteFill>
        <div style={{ position: "absolute", right: -4, bottom: -4, border: `3px solid ${palette.ink}`, background: palette.mint, padding: "10px 16px", fontFamily: labelFont, fontSize: 15, fontWeight: 700, letterSpacing: 1.4 }}>
          REAL PRODUCT CAPTURE
        </div>
      </div>
    </AbsoluteFill>
  );
};

export const KeatingIntro: React.FC<KeatingIntroProps> = ({ label = "KEATING // 4.0", audioSrc, durationSeconds, scenes }) => {
  const { fps } = useVideoConfig();
  const frame = useCurrentFrame();
  const [fontHandle] = useState(() => delayRender("Load local Keating fonts"));
  useEffect(() => {
    const stylesheet = document.createElement("link");
    stylesheet.rel = "stylesheet";
    stylesheet.href = staticFile("fonts/fonts.css");
    stylesheet.onload = () => {
      void Promise.all([
        document.fonts.load('400 24px "Space Mono"'),
        document.fonts.load('700 64px "Space Mono"'),
        document.fonts.load('700 22px "JetBrains Mono"'),
        document.fonts.load('500 26px "Roboto"'),
      ]).then((fonts) => {
        if (fonts.some((faces) => faces.length === 0)) throw new Error("A required Keating font is missing");
        continueRender(fontHandle);
      }).catch((error: Error) => cancelRender(error));
    };
    stylesheet.onerror = () => cancelRender(new Error("Could not load local fonts/fonts.css"));
    document.head.appendChild(stylesheet);
    return () => { stylesheet.remove(); };
  }, [fontHandle]);

  const totalFrames = Math.round(durationSeconds * fps);
  const durations = sceneDurations(scenes, totalFrames);
  let from = 0;
  const starts = durations.map((duration) => {
    const start = from;
    from += duration;
    return start;
  });
  const activeIndex = starts.findIndex((start, index) => frame >= start && frame < start + durations[index]);

  return (
    <AbsoluteFill style={{ backgroundColor: palette.paper, color: palette.ink }}>
      {audioSrc ? <Audio src={staticFile(audioSrc)} /> : null}
      {scenes.map((scene, index) => (
        <Sequence key={scene.shotSrc} from={starts[index]} durationInFrames={durations[index]}>
          <SceneCard scene={scene} duration={durations[index]} index={index} />
        </Sequence>
      ))}
      <div style={{ position: "absolute", left: 96, right: 96, top: 36, paddingBottom: 16, borderBottom: `2px solid ${palette.ink}`, fontFamily: labelFont, fontWeight: 700, fontSize: 22, letterSpacing: 2 }}>
        {label}
      </div>
      <div style={{ position: "absolute", left: 96, right: 96, bottom: 30, height: 42, display: "flex", border: `3px solid ${palette.ink}`, background: palette.paperDeep }}>
        {scenes.map((scene, index) => (
          <div key={scene.shotSrc} style={{ flex: 1, minWidth: 0, display: "flex", justifyContent: "center", alignItems: "center", borderRight: index < scenes.length - 1 ? `3px solid ${palette.ink}` : undefined, background: index === activeIndex ? palette.green : index < activeIndex ? palette.mint : palette.paperDeep, color: index === activeIndex ? palette.paper : index < activeIndex ? palette.deepGreen : palette.inkSoft, fontFamily: labelFont, fontWeight: 700, fontSize: 14, letterSpacing: 0.3 }}>
            {scene.kicker}
          </div>
        ))}
      </div>
    </AbsoluteFill>
  );
};
