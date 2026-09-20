import { createJudgementOperationCaller } from "./judgement/operation";
import type { EpisodeRunner, SkillProposer, TeachingCase } from "../../../shared/evolution/contracts";
import type { ExperimentCompletion } from "../../../shared/evolution/model-adapters";
import type { WikiMaintainer } from "../../../shared/evolution/wiki";
import { createWebJudgementRuntime, type WebJudgementRuntime } from "./judgement/runtime";
import { createWebEvolutionJudge } from "./judgement/evolution";
import { TEACHING_CASES } from "../../../shared/evolution/cases";
import { runTeachingEvolution, teachingExperimentMarkdown, type EvolutionStore } from "../../../shared/evolution/loop";
import { createSkillProposer, createWikiMaintainer } from "../../../shared/evolution/model-adapters";
import { createBrowserEpisodeAdapters } from "./teaching-episode-runner";
import { browserEvolutionStore } from "./teaching-evolution-store";
import { KEATING_SYSTEM_PROMPT } from "./browser-tools/prompt";

export async function runBrowserTeachingExperiment(
  adapters: Parameters<typeof createBrowserEpisodeAdapters>[0],
  options: { force?: boolean; signal?: AbortSignal; basePrompt?: string;
    /** Explicit dependencies keep production-caller tests independent from hosted inference. */
    cases?: readonly TeachingCase[]; store?: EvolutionStore; judgementRuntime?: WebJudgementRuntime;
    episodeAdapters?: { runner: EpisodeRunner; complete: ExperimentCompletion };
    proposer?: SkillProposer; maintainer?: WikiMaintainer;
  } = {},
): Promise<string> {
  const { runner, complete } = options.episodeAdapters ?? createBrowserEpisodeAdapters(adapters);
  const store = options.store ?? browserEvolutionStore;
  const cases = options.cases ?? TEACHING_CASES;
  const runtime = options.judgementRuntime ?? createWebJudgementRuntime();
  const typed = await createWebEvolutionJudge({ runtime, runner, cases });
  const report = await runTeachingEvolution({
    store, cases, basePrompt: options.basePrompt ?? KEATING_SYSTEM_PROMPT,
    runner: typed.runner, judge: typed.judge, proposer: options.proposer ?? createSkillProposer(complete),
    maintainer: options.maintainer ?? (options.proposer ? undefined : createWikiMaintainer(complete)),
    frontierReviewer: { call: typed.frontierCall },
    spendReviewer: runtime.settings.backend === "off" ? undefined : {
      call: createJudgementOperationCaller({ runtime, accept: () => true }), calibration: runtime.policy.calibration,
    },
    force: options.force, signal: options.signal,
  });
  await store.put(`raw/${report.id}-judgement`, typed.receipt);
  return teachingExperimentMarkdown(report) + `\nJudge: ${typed.receipt.backend?.model ?? "unavailable"}; uncalibrated proxy estimates. Both independent behaviour gates remain required. Human learning remains unmeasured.\n`;
}
