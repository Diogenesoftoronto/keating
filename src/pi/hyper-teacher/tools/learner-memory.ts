import { forgetLearnerMemory, LEARNER_MEMORY_CATEGORIES, rememberLearnerMemory, type LearnerMemoryInput } from "../../../core/learner-memory.js";
import { getCwd, keatingToolMaker } from "./shared.js";

export const learnerMemoryTools = [
  keatingToolMaker("remember_learner_profile", "remember_learner_profile",
    "Selectively preserve useful learner context from ordinary conversation; the learner need not say 'remember'. Record stated interests, motivations or communication preferences, or tentative observations supported by their actual words. A normal question may show current study context, never permanent ability or mastery. Do not save every turn, temporary requests, sensitive facts or inferred demographic/medical/psychological traits. Explicit means the learner stated the fact, not verified truth. Observations stay tentative. Use supersedes_id from saved context to correct a fact; do not add a contradictory duplicate.",
    { category: { type: "string", enum: [...LEARNER_MEMORY_CATEGORIES] }, value: { type: "string", minLength: 1, maxLength: 240 },
      source: { type: "string", enum: ["explicit", "observed"] },
      evidence: { type: "string", minLength: 1, maxLength: 500, description: "Exact supporting quote from a learner message in this session. Do not quote assistant text or invent evidence." },
      confidence: { type: "number", minimum: 0, maximum: 1, description: "Optional for observed facts; capped at 0.65, default 0.45." },
      supersedes_id: { type: "string", description: "Exact saved fact ID being corrected; replaced in active memory." } },
    async (params, ctx) => {
      const fact = await rememberLearnerMemory(ctx?.cwd ?? getCwd(), params as unknown as LearnerMemoryInput, ctx?.sessionManager);
      return { content: [{ type: "text", text: JSON.stringify({ status: "remembered", fact }) }], details: { fact } };
    }),
  keatingToolMaker("forget_learner_profile", "forget_learner_profile",
    "Remove one saved learner fact by its exact ID when the learner asks to forget it. Removes that fact and evidence from active profile memory; does not erase historical conversation transcripts or separately stated biography text.",
    { belief_id: { type: "string", description: "Exact active fact ID from learner context or learner_state." } },
    async (params, ctx) => {
      const result = await forgetLearnerMemory(ctx?.cwd ?? getCwd(), String(params.belief_id ?? ""));
      return { content: [{ type: "text", text: JSON.stringify({ status: "forgotten", ...result,
        scope: "Active profile fact and evidence removed; historical conversations and separate biography unchanged." }) }] };
    }),
].map((tool) => ({ ...tool, parameters: { ...tool.parameters,
  required: tool.name === "remember_learner_profile" ? ["category", "value", "source", "evidence"] : ["belief_id"] } }));
