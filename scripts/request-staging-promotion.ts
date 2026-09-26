#!/usr/bin/env bun
/** Request a production action from Railway's authoritative, persistent worker. */
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const PROJECT = "314d5558-957b-4e19-9ae0-bc08c8b5cf78";
const SERVICE = "a1fef6d6-698e-4e0b-8647-452ac4399614";
const ENVIRONMENT = "343e403a-fac6-4a18-a413-d3bfd5f758f1";
const TARGET = ["--project", PROJECT, "--service", SERVICE, "--environment", ENVIRONMENT];
type Dependencies = { run: (args: string[]) => Promise<string>; sleep: (ms: number) => Promise<unknown>; now: () => number };
type Deployment = { id: string; status: string; createdAt: string };

async function run(args: string[]): Promise<string> {
  // Snapshot responses include server variables: capture them in memory and
  // never echo raw API output (including on failure) to terminal or logs.
  const child = Bun.spawn(args, { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [stdout, , exit] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (exit !== 0) throw new Error(`Railway ${args[1]} failed; no deployment restart was assumed.`);
  return stdout;
}

export function promotionRequest(input: { now?: unknown; sha?: unknown }, candidate?: { sha?: unknown; dirty?: unknown; promotionEligible?: unknown }, id: string = randomUUID()): string {
  const now = input.now === true || input.now === "true";
  const sha = typeof input.sha === "string" ? input.sha : "";
  if (sha && (!now || !/^[0-9a-f]{40}$/.test(sha))) throw new Error("Rollback requires now=true and a full previously promoted commit SHA.");
  if (!now) return "";
  if (!sha && (candidate?.dirty !== false || candidate?.promotionEligible !== true || typeof candidate.sha !== "string" || !/^[0-9a-f]{40}$/.test(candidate.sha))) throw new Error("The current staging preview is not a clean, valid commit. Publish a clean snapshot before requesting production promotion.");
  return JSON.stringify({ id, action: sha ? "rollback" : "promote", sha: sha || candidate!.sha });
}

export async function requestWorkerRun(request: string, dependencies: Dependencies = { run, sleep: Bun.sleep, now: Date.now }): Promise<{ deploymentId: string; restarted: boolean }> {
  const list = async () => JSON.parse(await dependencies.run(["railway", "deployment", "list", ...TARGET, "--limit", "20", "--json"])) as Deployment[];
  const before = new Set((await list()).map(item => item.id));
  // Normal variable deployment captures current configuration and request in a
  // new snapshot. Redeploying the old image can reuse stale variables/settings.
  let changedVariables = false;
  if (request) {
    await dependencies.run(["railway", "variable", "set", ...TARGET, "--json", `KEATING_PROMOTION_REQUEST=${request}`]);
    changedVariables = true;
  } else {
    // CLI 5.30.4 rejects KEY=. Deleting an existing request creates a fresh
    // configuration snapshot; if absent, only a verified empty snapshot is safe.
    const variables = JSON.parse(await dependencies.run(["railway", "variable", "list", ...TARGET, "--json"]));
    if (!variables || typeof variables !== "object" || Array.isArray(variables)) throw new Error("Unexpected Railway variable listing; no worker was restarted.");
    if (Object.hasOwn(variables, "KEATING_PROMOTION_REQUEST")) {
      await dependencies.run(["railway", "variable", "delete", ...TARGET, "--json", "KEATING_PROMOTION_REQUEST"]);
      changedVariables = true;
    }
  }
  const deadline = dependencies.now() + 5 * 60_000;
  while (dependencies.now() < deadline) {
    const latest = (await list()).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
    // Setting an already-empty request may be a no-op. A normal gated check
    // may reuse that exact empty snapshot; an immediate request must be new.
    if (latest && (!before.has(latest.id) || request === "")) {
      const result = JSON.parse(await dependencies.run(["railway", "api", "query($id: String!) { deployment(id: $id) { id status deploymentStopped instances { id status } projectId serviceId environmentId } deploymentSnapshot(deploymentId: $id) { variables } }", "--variables", JSON.stringify({ id: latest.id }), "--compact"]));
      if (result.errors?.length) throw new Error("Could not verify the new worker deployment snapshot.");
      const deployed = result.data?.deployment;
      const variables = result.data?.deploymentSnapshot?.variables;
      if (!deployed || deployed.id !== latest.id || deployed.projectId !== PROJECT || deployed.serviceId !== SERVICE || deployed.environmentId !== ENVIRONMENT) throw new Error("Worker deployment identity did not match the intended scheduler.");
      if (before.has(latest.id) && request === "" && ((variables?.KEATING_PROMOTION_REQUEST ?? "") !== "" || deployed.status !== "SUCCESS")) {
        if (!changedVariables && variables && (variables.KEATING_PROMOTION_REQUEST ?? "") !== "") throw new Error("Current variables have no request, but the worker snapshot still contains an old request. Publish current scheduler configuration before running a check; the old request was not restarted.");
        await dependencies.sleep(2_000);
        continue;
      }
      if (["FAILED", "CRASHED", "REMOVED", "REMOVING", "SKIPPED", "NEEDS_APPROVAL"].includes(deployed.status)) throw new Error(`New worker deployment ${latest.id} is ${deployed.status}; inspect Railway before retrying.`);
      if (variables) {
        if ((variables.KEATING_PROMOTION_REQUEST ?? "") !== request) throw new Error("A different worker request superseded this one; no deployment was restarted.");
        if (deployed.status === "SUCCESS") {
          const states: unknown[] | undefined = Array.isArray(deployed.instances) ? deployed.instances.map((instance: { status?: unknown }) => instance.status) : undefined;
          if (states?.includes("RUNNING")) return { deploymentId: latest.id, restarted: false };
          // Railway cron can report SUCCESS and deploymentStopped=false while
          // every instance is merely CREATED and has never run. Transitional
          // or unknown states must settle before we can safely start anything.
          const settled = states && states.every(state => ["CREATED", "EXITED", "STOPPED"].includes(String(state)));
          const created = states && states.length > 0 && states.every(state => state === "CREATED");
          if (settled && (deployed.deploymentStopped === true || created)) {
            // Recheck latest ID just before mutation to avoid starting an older
            // snapshot after another operator has submitted a replacement.
            const current = (await list()).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
            if (current?.id !== latest.id) throw new Error("Worker deployment changed before restart; no older deployment was started.");
            const restart = JSON.parse(await dependencies.run(["railway", "api", "mutation($id: String!) { deploymentRestart(id: $id) }", "--variables", JSON.stringify({ id: latest.id }), "--compact"]));
            if (restart.errors?.length || restart.data?.deploymentRestart !== true) throw new Error(`Railway did not confirm restart of worker ${latest.id}.`);
            return { deploymentId: latest.id, restarted: true };
          }
        }
      }
    }
    await dependencies.sleep(2_000);
  }
  throw new Error("Timed out waiting for a new worker deployment containing this request. Inspect Railway; the old deployment was not restarted.");
}

async function main() {
  const input = JSON.parse(process.env.DEVENV_TASK_INPUT ?? "{}");
  const candidate = (input.now === true || input.now === "true") && !input.sha ? JSON.parse(await readFile(".keating/promotion-candidate/candidate.json", "utf8")) : undefined;
  const result = await requestWorkerRun(promotionRequest(input, candidate));
  console.log(`Worker ${result.deploymentId} ${result.restarted ? "restart accepted" : "is already running"}. Check keating-promotion logs for the result; submission does not mean production has changed.`);
}

if (import.meta.main) main().catch(error => { console.error(error.message); process.exitCode = 1; });
