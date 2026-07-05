import { learnerStatePath } from "../../../core/paths.js";
import { loadLearnerState, recordFeedback, saveLearnerState } from "../../../core/learner-state.js";
import { keatingToolMaker, getCwd, pick, up, down, confused } from "./shared.js";

export const feedbackTools = [
  keatingToolMaker(
    "feedback",
    "feedback",
    "Record a learner feedback signal for a topic. Call this after teaching to track session outcomes. signal must be 'up', 'down', or 'confused'.",
    {
      signal: { type: "string", enum: ["up", "down", "confused"], description: "Feedback signal: up, down, or confused" },
      topic: { type: "string", description: "The topic the feedback is about (defaults to 'general')" }
    },
    async (params) => {
      const signalMap: Record<string, typeof up | typeof down | typeof confused> = { up, down, confused };
      const s = signalMap[pick(params.signal as string)];
      if (!s) return { content: [{ type: "text", text: "signal must be 'up', 'down', or 'confused'." }] };
      const topic = (params.topic as string) || "general";
      const statePath = learnerStatePath(getCwd());
      const state = await loadLearnerState(statePath);
      recordFeedback(state, topic, s);
      await saveLearnerState(statePath, state);
      return {
        content: [{ type: "text", text: `Recorded ${s} feedback for "${topic}".` }],
        details: { signal: s, topic }
      };
    }
  ),
];
