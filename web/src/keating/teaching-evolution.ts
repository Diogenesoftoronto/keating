import { TEACHING_CASES } from "../../../shared/evolution/cases";
import { runTeachingEvolution, teachingExperimentMarkdown } from "../../../shared/evolution/loop";
import { createEpisodeJudge, createSkillProposer } from "../../../shared/evolution/model-adapters";
import { createBrowserEpisodeAdapters } from "./teaching-episode-runner";
import { browserEvolutionStore } from "./teaching-evolution-store";
import { KEATING_SYSTEM_PROMPT } from "./browser-tools/prompt";

export async function runBrowserTeachingExperiment(
  adapters: Parameters<typeof createBrowserEpisodeAdapters>[0],
  options: { force?: boolean; signal?: AbortSignal; basePrompt?: string } = {},
): Promise<string> {
  const { runner, complete } = createBrowserEpisodeAdapters(adapters);
  const report = await runTeachingEvolution({
    store: browserEvolutionStore, cases: TEACHING_CASES, basePrompt: options.basePrompt ?? KEATING_SYSTEM_PROMPT,
    runner, judge: createEpisodeJudge(complete), proposer: createSkillProposer(complete),
    force: options.force, signal: options.signal,
  });
  return teachingExperimentMarkdown(report);
}
