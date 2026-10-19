/** Deliberate release preparation and publishing, keeping normal Git hooks enabled. */
import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { OpsError, type Options } from "./args.js";
import { must, run } from "./runner.js";

type ReleasePlan = {
  currentVersion: string;
  version: string;
  tag: string;
  title: string;
  push: boolean;
};

const allowedReleaseFiles = new Set([
  "package.json",
  "bun.lock",
  "package-lock.json",
  "CHANGELOG.md",
  "web/package.json",
  "mobile/package.json",
  "mobile/app.json",
  "desktop/package.json",
  "packages/design-contract/package.json",
  "packages/browser-agent-runtime/package.json",
  "src/core/version.ts",
  "bin/keating.js",
  "web/index.html",
  "web/src/components/ChatIntro.tsx",
  "web/src/og-image.tsx",
]);

export function nextVersion(current: string, requested: string): string {
  const parts = current.split(".").map(Number);
  if (parts.length !== 3 || parts.some(value => !Number.isSafeInteger(value) || value < 0)) {
    throw new OpsError(`Invalid current version: ${current}`);
  }

  let next = requested;
  if (requested === "major") {
    next = `${parts[0]! + 1}.0.0`;
  } else if (requested === "minor") {
    next = `${parts[0]}.${parts[1]! + 1}.0`;
  } else if (requested === "patch") {
    next = `${parts[0]}.${parts[1]}.${parts[2]! + 1}`;
  }
  if (!/^\d+\.\d+\.\d+$/.test(next)) {
    throw new OpsError(`Invalid release version: ${next}`);
  }

  const proposed = next.split(".").map(Number);
  const delta = proposed.map((value, index) => value - parts[index]!).find(value => value !== 0);
  if (!delta || delta < 0) {
    throw new OpsError(`Release must be newer than ${current}.`);
  }
  return next;
}

function printReleasePlan(plan: ReleasePlan): void {
  const { currentVersion, version, tag, title } = plan;
  if (plan.push) {
    console.log(
      `Publish plan: fetch origin; require clean tree, HEAD tag ${tag}, and fast-forward ancestry; `
      + `push HEAD:main then annotated ${tag}, retaining hooks.`,
    );
    return;
  }
  console.log(
    `Release plan: ${currentVersion} → ${version}; require clean tree + HEAD descended from origin/main; `
    + "prepare CHANGELOG; bun pm version --no-git-tag-version; sync versions + lock metadata; graph check; "
    + `commit "Release ${version}: ${title}"; annotate ${tag}.`,
  );
}

async function requireCleanTree(): Promise<void> {
  const dirty = await must(["git", "status", "--porcelain"], { quiet: true });
  if (dirty) {
    throw new OpsError(
      "Release requires a clean tree, including untracked files. Preserve/commit your work before retrying.",
    );
  }
}

async function refreshReleaseBase(): Promise<void> {
  await requireCleanTree();
  await must(["git", "fetch", "origin"]);
  const ancestry = await run(["git", "merge-base", "--is-ancestor", "origin/main", "HEAD"], {
    quiet: true,
  });
  if (ancestry.code) {
    throw new OpsError("HEAD must descend from origin/main. Rebase/merge before releasing.");
  }
}

async function publishRelease(tag: string): Promise<number> {
  const tagged = await must(["git", "rev-parse", `${tag}^{commit}`], { quiet: true });
  const head = await must(["git", "rev-parse", "HEAD"], { quiet: true });
  if (tagged !== head) {
    throw new OpsError(`${tag} must be an annotated tag on HEAD.`);
  }
  const type = await must(["git", "cat-file", "-t", `refs/tags/${tag}`], { quiet: true });
  if (type !== "tag") {
    throw new OpsError(`${tag} must be an annotated tag on HEAD.`);
  }

  await must(["git", "push", "origin", "HEAD:main"]);
  await must(["git", "push", "origin", `refs/tags/${tag}`]);
  console.log(`Published ${tag}. Monitor: bun scripts/ops.ts status --tag ${tag} --wait`);
  return 0;
}

async function requireNewTag(tag: string): Promise<void> {
  const existing = await run(["git", "rev-parse", "--verify", `refs/tags/${tag}`], { quiet: true });
  if (!existing.code) {
    throw new OpsError(`${tag} already exists.`);
  }
}

async function loadReleaseNotes(options: Options): Promise<string> {
  if (typeof options.flags.notes === "string") {
    const notes = (await readFile(options.flags.notes, "utf8")).trim();
    if (!notes || /TODO|REVIEW BEFORE RELEASE/.test(notes)) {
      throw new OpsError("Release notes must be reviewed, nonempty text without scaffold markers.");
    }
    return notes;
  }

  const previous = await run(["git", "describe", "--tags", "--abbrev=0"], { quiet: true });
  const range = previous.code ? "HEAD" : `${previous.stdout.trim()}..HEAD`;
  const subjects = await must(["git", "log", "--format=%s", range], { quiet: true });
  const bullets = subjects.split("\n").filter(Boolean).map(subject => `- ${subject}`).join("\n");
  return "<!-- REVIEW BEFORE RELEASE: edit these commit subjects into release notes. -->\n"
    + (bullets || "- TODO: describe this release.");
}

/**
 * Returns the changelog with `notes` as the `## version` section: replaced when
 * present, else inserted above the newest release. Notes are inserted literally.
 */
export function withChangelogSection(changelog: string, version: string, notes: string): string {
  const section = `## ${version}\n\n${notes}\n\n`;
  const escaped = version.replaceAll(".", "\\.");
  const sectionPattern = new RegExp(`^## ${escaped}[^\\n]*\\n[\\s\\S]*?(?=^## |$(?![\\s\\S]))`, "m");
  const hasSection = sectionPattern.test(changelog);
  // Replacer functions keep `$&`, `$$`, and `$'` in notes literal.
  const updated = hasSection
    ? changelog.replace(sectionPattern, () => section)
    : changelog.replace(/(?=^## )/m, () => section);
  if (updated === changelog && !hasSection) {
    throw new OpsError("CHANGELOG.md needs a level-two version heading to insert above.");
  }
  return updated;
}

async function prepareChangelog(version: string, options: Options): Promise<void> {
  const changelog = await readFile("CHANGELOG.md", "utf8");
  const notes = await loadReleaseNotes(options);
  await writeFile("CHANGELOG.md", withChangelogSection(changelog, version, notes));
}

function printScaffoldInstructions(version: string): void {
  console.log(
    `Scaffolded CHANGELOG.md for ${version}. Review/edit, save the reviewed section body to a notes file, `
    + "commit the reviewed changelog to restore a clean tree, "
    + `then rerun release ${version} --notes FILE --yes. No version bump, commit or tag was made.`,
  );
}

async function prepareVersions(version: string): Promise<void> {
  await must(["bun", "pm", "version", version, "--no-git-tag-version"]);
  await must(["bun", "scripts/sync-version.ts"]);
  await must(["bun", "install", "--lockfile-only", "--ignore-scripts"]);
  await must(["bun", "scripts/sync-version.ts", "--check"]);
}

async function checkGraphChanges(): Promise<void> {
  const graph = existsSync(".gitnexus/run.cjs")
    ? ["node", ".gitnexus/run.cjs"]
    : ["bun", "x", "--no-install", "gitnexus"];
  const checked = await must([...graph, "detect-changes", "--scope", "all", "--repo", "."]);
  const partial = /"(?:partial|truncated)"\s*:\s*true/.test(checked);
  const missing = /no (?:index|indexed)|not indexed/i.test(checked);
  if (partial || missing) {
    throw new OpsError(
      "Graph change analysis is incomplete. Finish analysis before committing the prepared release.",
    );
  }
}

async function commitRelease(plan: ReleasePlan): Promise<void> {
  const changed = await must(["git", "diff", "--name-only"], { quiet: true });
  const files = changed.split("\n").filter(Boolean);
  if (files.some(file => !allowedReleaseFiles.has(file))) {
    throw new OpsError("Unexpected files changed during release. Inspect the tree; nothing was staged.");
  }
  const untracked = await must(["git", "ls-files", "--others", "--exclude-standard"], { quiet: true });
  if (untracked) {
    throw new OpsError("New untracked files appeared during release; inspect before committing.");
  }

  const message = `Release ${plan.version}: ${plan.title}`;
  await must(["git", "add", "--", ...files]);
  await must(["git", "commit", "-m", message]);
  await must(["git", "tag", "-a", plan.tag, "-m", message]);
}

/**
 * Plan a release, or with --yes write notes/versions and commit/tag; --push publishes a prepared release.
 * Returns 0 for a plan/completion, 3 for a notes scaffold; throws failures/preconditions/timeouts (1/2/3).
 */
export async function release(options: Options): Promise<number> {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  const push = Boolean(options.flags.push);
  const version = push ? pkg.version as string : nextVersion(pkg.version, options.positional[0]!);
  const plan: ReleasePlan = {
    currentVersion: pkg.version,
    version,
    tag: `v${version}`,
    title: String(options.flags.title ?? `Keating ${version}`),
    push,
  };
  printReleasePlan(plan);
  if (!options.flags.yes || options.flags["dry-run"]) {
    console.log("Plan only. Add --yes to apply.");
    return 0;
  }

  await refreshReleaseBase();
  if (push) return publishRelease(plan.tag);

  await requireNewTag(plan.tag);
  await prepareChangelog(version, options);
  if (!options.flags.notes) {
    printScaffoldInstructions(version);
    return 3;
  }
  await prepareVersions(version);
  await checkGraphChanges();
  await commitRelease(plan);
  console.log(`Prepared annotated ${plan.tag}. Publish: bun scripts/ops.ts release --push --yes`);
  return 0;
}
