/** Plans wrap existing snapshot/checksum and promotion safeguards. */
import { OpsError, type Options } from "./args.js";
import { must } from "./runner.js";
import { readJson, candidateSummary } from "./status.js";
import { STAGING_PROJECT, STAGING_SERVICE, STAGING_ENVIRONMENT, STAGING_URL, WAIT_MS } from "./config.js";

/**
 * Show staging identity and target IDs; --yes uploads and verifies the bounded source snapshot.
 * Returns 0 for a plan/completion; throws failures, preconditions or timeouts (1/2/3).
 */
export async function deploy(options: Options): Promise<number> {
  const sha = await must(["git", "rev-parse", "HEAD"], { quiet: true });
  const dirty = Boolean(await must(["git", "status", "--porcelain"], { quiet: true }));
  console.log(
    `Deploy staging: ${sha}; dirty=${dirty}\n`
    + `Project ${STAGING_PROJECT}; environment ${STAGING_ENVIRONMENT}; service ${STAGING_SERVICE}\n`
    + `${STAGING_URL}\nCreate bounded source snapshot, upload, wait for matching fingerprint + health, `
    + "publish scheduler candidate. Explicit IDs; no railway link needed.",
  );
  if (!options.flags.yes || options.flags["dry-run"]) {
    console.log("Plan only. Add --yes to deploy.");
    return 0;
  }
  console.log(await must(["bun", "scripts/staging.ts", "deploy"]));
  return 0;
}

/**
 * Show local eligibility and cached production identity; --yes invokes the existing promotion flow.
 * Returns the flow's completion code (0); throws failures, preconditions or timeouts (1/2/3).
 */
export async function promote(options: Options): Promise<number> {
  const candidate = await readJson(".keating/promotion-candidate/candidate.json");
  const cached = await readJson(".keating/ops/status.json");
  const wait = options.flags.now ? "Skip age wait only." : "Require eight-hour wait.";
  console.log(
    `Promote: ${candidateSummary(candidate)}\nProduction: ${cached?.productionVersion ?? "unknown"} `
    + `(last status observation: ${cached?.observedAt ?? "none"}).\n${wait} `
    + "Existing archive, clean commit, fingerprint, health, deployment and lease safeguards apply.",
  );
  if (!options.flags.yes || options.flags["dry-run"]) {
    console.log("Plan only. Add --yes to promote.");
    return 0;
  }
  if (!candidate) {
    throw new OpsError("No local promotion candidate. Deploy a clean staging snapshot first.");
  }
  if (candidate.dirty !== false || candidate.promotionEligible !== true) {
    throw new OpsError("This candidate is not a clean, promotion-eligible snapshot.");
  }
  const age = Date.now() - Date.parse(candidate.verifiedAt ?? "");
  if (!Number.isFinite(age) || age < 0 || (!options.flags.now && age < WAIT_MS)) {
    throw new OpsError(
      "Candidate verification age is invalid or has not reached the eight-hour wait. --now bypasses age only.",
    );
  }
  const { main } = await import("../promote-staging.js");
  return main(["promote", ...(options.flags.now ? ["--now"] : [])]);
}
