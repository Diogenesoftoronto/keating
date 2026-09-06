import type { Meta, StoryObj } from "@storybook/react-vite";
import { CodingChallenge } from "./CodingChallenge";
import { MusicLab } from "./MusicLab";
import { TWO_SUM_CHALLENGE, MUSIC_LAB_EXAMPLES } from "./labs/examples";

const meta = { title: "Learning/Labs", parameters: { layout: "centered" } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
const frame = { width: "min(640px, calc(100vw - 40px))", padding: "16px" };

export const Coding: Story = { render: () => <div style={frame}><CodingChallenge node={TWO_SUM_CHALLENGE} /></div> };
export const TypeScript: Story = { render: () => <div style={frame}><CodingChallenge node={{ ...TWO_SUM_CHALLENGE, language: "typescript", starterCode: "function twoSum(nums: number[], target: number): number[] {\n  return [];\n}" }} /></div> };
export const MobileCoding: Story = { render: () => <div style={{ width: "min(350px, calc(100vw - 32px))" }}><CodingChallenge node={TWO_SUM_CHALLENGE} /></div> };
export const Polyrhythm: Story = { render: () => <div style={frame}><MusicLab node={MUSIC_LAB_EXAMPLES.polyrhythm} /></div> };
export const Intervals: Story = { render: () => <div style={frame}><MusicLab node={MUSIC_LAB_EXAMPLES.intervals} /></div> };
export const Timbre: Story = { render: () => <div style={frame}><MusicLab node={MUSIC_LAB_EXAMPLES.timbre} /></div> };
export const MobileMusic: Story = { render: () => <div style={{ width: "min(350px, calc(100vw - 32px))" }}><MusicLab node={MUSIC_LAB_EXAMPLES.polyrhythm} /></div> };
