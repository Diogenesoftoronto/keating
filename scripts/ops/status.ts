/** One background monitor for workflow completion and staging identity. */
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { liveReceipt } from "../staging.js";
import { duration, type Options } from "./args.js";
import { run } from "./runner.js";
import { classifyStatus, type WorkflowRun } from "./results.js";
import {
  CI_WORKFLOW,
  RELEASE_WORKFLOW,
  GITHUB_REPO,
  PRODUCTION_URL,
  STAGING_URL,
  WAIT_MS,
} from "./config.js";

type Observation = {
  lines: Record<string, string>;
  observationFailed: boolean;
  release?: WorkflowRun;
  ci?: WorkflowRun;
  receipt?: any;
  stagingVersion?: string;
  productionVersion?: string;
};

export async function readJson(path: string): Promise<any | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export function candidateSummary(candidate: any, now = Date.now()): string {
  if (!candidate) return "none";
  const age = now - Date.parse(candidate.verifiedAt ?? "");
  const validAge = Number.isFinite(age) && age >= 0;
  const eligible = candidate.dirty === false && candidate.promotionEligible === true && validAge && age >= WAIT_MS;
  const ageLabel = validAge ? `${(age / 3_600_000).toFixed(2)}h / ${WAIT_MS / 3_600_000}h` : "unknown";
  const eligibility = eligible
    ? "locally eligible (live/archive/lease checks still required)"
    : "not locally eligible";
  return `${candidate.sha ?? "unknown"}; age ${ageLabel}; ${eligibility}`;
}

export function softwareVersion(html: string): string | undefined {
  return /"softwareVersion"\s*:\s*"([^"]+)"/.exec(html)?.[1];
}

async function htmlVersion(url: string): Promise<string | undefined> {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000), cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return softwareVersion(await response.text());
}

async function workflowRuns(workflow: string, branch?: string): Promise<WorkflowRun[]> {
  const args = ["gh", "run", "list", "--repo", GITHUB_REPO, "--workflow", workflow];
  if (branch) args.push("--branch", branch);
  args.push(
    "--limit", "10",
    "--json", "databaseId,headSha,headBranch,status,conclusion,url,displayTitle",
  );
  const result = await run(args, { quiet: true, timeout: 30_000 });
  if (result.code) {
    throw new Error("gh run list failed (check GitHub authentication/access)");
  }
  return JSON.parse(result.stdout);
}

function workflowSummary(workflow: WorkflowRun, branch: string): string {
  const completion = `${workflow.status}/${workflow.conclusion || "pending"}`;
  return `${completion} ${branch} ${workflow.headSha.slice(0, 8)} ${workflow.url ?? ""}`;
}

async function observeRelease(state: Observation, tag?: string, localSha?: string): Promise<void> {
  try {
    const releases = await workflowRuns(RELEASE_WORKFLOW, tag);
    state.release = localSha ? releases.find(item => item.headSha === localSha) : releases[0];
    state.lines.Release = state.release
      ? workflowSummary(state.release, state.release.headBranch ?? "")
      : "pending (no matching run)";
  } catch (error) {
    state.lines.Release = `unknown: ${(error as Error).message}`;
    state.observationFailed = true;
  }
}

async function observeMainCi(state: Observation): Promise<void> {
  try {
    state.ci = (await workflowRuns(CI_WORKFLOW, "main"))[0];
    state.lines.CI = state.ci ? workflowSummary(state.ci, "main") : "pending (no main run)";
  } catch (error) {
    state.lines.CI = `unknown: ${(error as Error).message}`;
    state.observationFailed = true;
  }
}

async function observeStaging(state: Observation): Promise<void> {
  try {
    state.receipt = await liveReceipt(STAGING_URL);
    state.stagingVersion = await htmlVersion(STAGING_URL);
    state.lines.Staging = `version ${state.stagingVersion ?? "unknown"}; `
      + `sha ${state.receipt?.sha ?? "unknown"}; ${STAGING_URL}`;
    if (!state.receipt?.sha || !state.stagingVersion) state.observationFailed = true;
  } catch (error) {
    state.lines.Staging = `unknown: ${(error as Error).message}`;
    state.observationFailed = true;
  }
}

async function observeProduction(state: Observation): Promise<void> {
  try {
    state.productionVersion = await htmlVersion(PRODUCTION_URL);
    state.lines.Production = `softwareVersion ${state.productionVersion ?? "unknown"}; ${PRODUCTION_URL}`;
    if (!state.productionVersion) state.observationFailed = true;
  } catch (error) {
    state.lines.Production = `unknown: ${(error as Error).message}`;
    state.observationFailed = true;
  }
}

async function collectObservations(tag?: string, localSha?: string): Promise<Observation> {
  const state: Observation = { lines: {}, observationFailed: false };
  await observeRelease(state, tag, localSha);
  await observeMainCi(state);
  await observeStaging(state);
  await observeProduction(state);
  state.lines.Candidate = candidateSummary(await readJson(".keating/promotion-candidate/candidate.json"));
  return state;
}

function printChanges(lines: Record<string, string>, previous: Map<string, string>): void {
  for (const [key, value] of Object.entries(lines)) {
    if (previous.get(key) === value) continue;
    console.log(`${key}: ${value}`);
    previous.set(key, value);
  }
}

async function saveStatus(state: Observation): Promise<void> {
  await mkdir(".keating/ops", { recursive: true });
  const cache = {
    observedAt: new Date().toISOString(),
    productionVersion: state.productionVersion,
    stagingVersion: state.stagingVersion,
    stagingSha: state.receipt?.sha,
    lines: state.lines,
  };
  await writeFile(join(".keating/ops", "status.json"), JSON.stringify(cache, null, 2));
}

function workflowFailed(workflow?: WorkflowRun): boolean {
  return workflow?.status === "completed" && workflow.conclusion !== "success";
}

function observationCode(state: Observation, tag?: string, localSha?: string): 0 | 1 | 3 {
  if (tag) {
    const expectedSha = localSha ?? state.release?.headSha;
    const matchesTag = state.stagingVersion === tag.slice(1) && state.receipt?.dirty === false;
    const stagingSha = matchesTag ? state.receipt.sha : undefined;
    return classifyStatus(state.release, stagingSha, expectedSha);
  }
  if (workflowFailed(state.release) || workflowFailed(state.ci)) return 1;
  if (state.release?.status !== "completed" || state.ci?.status !== "completed") return 3;
  return state.observationFailed ? 1 : 0;
}

function printStatusPlan(tag: string | undefined, wait: boolean): void {
  const waiting = wait ? " Poll changes until Release success + staging tag version/SHA, or timeout." : "";
  console.log(
    `Status plan: gh run list (${GITHUB_REPO}, ${RELEASE_WORKFLOW}, ${tag ?? "latest tag"}; `
    + `${CI_WORKFLOW}, main); staging HTML + build receipt ${STAGING_URL}; `
    + `production softwareVersion ${PRODUCTION_URL}; local promotion candidate.${waiting}`,
  );
}

async function localTagSha(tag?: string): Promise<string | undefined> {
  if (!tag) return undefined;
  const local = await run(["git", "rev-parse", "--verify", `refs/tags/${tag}^{commit}`], { quiet: true });
  return local.code ? undefined : local.stdout.trim();
}

/**
 * Read workflow/live identities and cache observations; --wait polls and prints only changes.
 * Returns 0 for a plan/completion, 1 for failure, 3 for pending/timeout; argument errors use 2.
 */
export async function status(options: Options): Promise<number> {
  const tag = typeof options.flags.tag === "string" ? options.flags.tag : undefined;
  if (options.flags["dry-run"]) {
    printStatusPlan(tag, Boolean(options.flags.wait));
    return 0;
  }
  const deadline = Date.now() + duration(String(options.flags.timeout ?? "30m"));
  const interval = duration(String(options.flags.interval ?? "30s"));
  const previous = new Map<string, string>();
  const localSha = await localTagSha(tag);

  do {
    const observation = await collectObservations(tag, localSha);
    printChanges(observation.lines, previous);
    await saveStatus(observation);
    const code = observationCode(observation, tag, localSha);
    if (!options.flags.wait) return observation.observationFailed ? 1 : code;
    if (code === 0 || code === 1) return code;
    if (Date.now() >= deadline) return 3;
    await Bun.sleep(Math.min(interval, deadline - Date.now()));
  } while (Date.now() < deadline);
  return 3;
}
