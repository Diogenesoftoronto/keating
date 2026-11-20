import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup as render } from "react-dom/server";
import { JsonCrackBlock } from "./JsonCrackBlock";
import { MermaidRenderer } from "./MermaidRenderer";
import { PlaybackPosition } from "./PlaybackPosition";
import { SceneRenderer } from "./SceneRenderer";
import { AnimationPlayer } from "./AnimationPlayer";
import { AnimatedScene } from "./AnimatedScene";
import { HyperframesPlayer } from "./HyperframesPlayer";
import { FrustrationClip } from "./FrustrationClip";

describe("specialist lesson controls", () => {
  test("the graph keeps its raw representation alongside keyboard zoom and pan", () => {
    const html=render(<JsonCrackBlock value={{topic:"Intervals"}}/>);
    for (const label of ["Pan left","Pan right","Zoom in","Zoom out","Intervals","Copy"]) expect(html).toContain(label);
    expect(render(<MermaidRenderer content="flowchart LR\nA-->B"/>)).toContain("Rendering diagram");
  });
  test("seeking has a written position, units, and native keyboard input", () => {
    const html=render(<PlaybackPosition value={65} max={120} label="Scene position" onSeek={()=>{}}/>);
    expect(html).toContain("1:05 / 2:00");
    expect(html).toContain('type="range"');
    expect(render(<HyperframesPlayer html="<main></main>" title="Animation" />)).toContain("Animation progress");
  });
  test("storyboard navigation reflects the actual scene count", () => {
    const html=render(<SceneRenderer storyboard={"# Storyboard\n## Scene 1: Opening (3s)\n- **Visual**: A note\n## Scene 2: Ending (2s)"} />);
    expect(html).toContain("Scene position");
    expect(html).toContain('aria-valuemax="2"');
  });
  test("media hosts preserve fallback content and controls", () => {
    expect(render(<AnimationPlayer scene="A source fragment"/>)).toContain("A source fragment");
    expect(render(<AnimatedScene payload={{topic:"Timing",kind:"hyperframes"}}/>)).toContain("Missing hyperframes HTML body");
    const reaction = render(<FrustrationClip/>);
    expect(reaction).toContain('src="/landing/clips/office-rage.webp"');
    expect(reaction).toContain('src="/landing/clips/office-rage.webm"');
    expect(reaction).not.toMatch(/<button\b|<input\b|\scontrols[\s=>]/);
  });
});
