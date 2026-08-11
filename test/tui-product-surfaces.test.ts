import { afterEach, describe, expect, test } from "bun:test";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { recordTopicCoverage, loadLearnerState, saveLearnerState } from "../src/core/learner-state.js";
import { flashcardsTopicArtifact } from "../src/core/project.js";
import { learnerStatePath, plansDir, stateDir } from "../src/core/paths.js";
import { resolveTopic } from "../src/core/topics.js";
import {
  exportTuiArtifact,
  listTuiLibraryArtifacts,
  previewTuiArtifact,
  trashTuiArtifact,
} from "../src/tui/library.js";
import { loadTuiReviewDashboard, rateTuiReviewCard } from "../src/tui/review.js";
import { tuiRuntimeSettings, tuiSettingsMarkdown } from "../src/tui/settings.js";
import { OPEN_TUI_TOOL_POLICY } from "../src/runtime/tool-policy.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function temporaryProject(label: string): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), `keating-${label}-`));
  temporaryDirectories.push(cwd);
  return cwd;
}

describe("OpenTUI Library", () => {
  test("previews text, exports a copy, and moves deletion to recoverable project trash", async () => {
    const cwd = await temporaryProject("tui-library");
    await mkdir(plansDir(cwd), { recursive: true });
    const source = join(plansDir(cwd), "limits.md");
    await writeFile(source, "# Limits\n\nA semantic artifact.\n", "utf8");

    const artifacts = await listTuiLibraryArtifacts(cwd);
    const artifact = artifacts.find((candidate) => candidate.path.endsWith("limits.md"));
    expect(artifact).toMatchObject({ kind: "text" });
    const preview = await previewTuiArtifact(cwd, artifact!.path);
    expect(preview).toMatchObject({ kind: "text", sourceOnly: false });
    if (preview.kind === "text") expect(preview.content).toContain("A semantic artifact");

    const exported = await exportTuiArtifact(cwd, artifact!.path);
    expect(await readFile(join(cwd, exported), "utf8")).toContain("A semantic artifact");
    const trashed = await trashTuiArtifact(cwd, artifact!.path);
    expect(await readFile(join(cwd, trashed), "utf8")).toContain("A semantic artifact");
    await expect(access(source)).rejects.toThrow();
    await expect(previewTuiArtifact(cwd, "../outside.md")).rejects.toThrow("outside Keating's output library");
  });
});

describe("OpenTUI Review", () => {
  test("discovers generated cards, labels estimated topic urgency, and persists canonical SRS ratings", async () => {
    const cwd = await temporaryProject("tui-review");
    await flashcardsTopicArtifact(cwd, "derivative");
    const learner = await loadLearnerState(learnerStatePath(cwd));
    recordTopicCoverage(learner, resolveTopic("derivative"), 0.45);
    learner.coveredTopics[0]!.lastSeen = "2026-07-01T00:00:00.000Z";
    await saveLearnerState(learnerStatePath(cwd), learner);

    const now = "2026-08-11T12:00:00.000Z";
    const dashboard = await loadTuiReviewDashboard(cwd, now);
    expect(dashboard.cards.length).toBeGreaterThan(3);
    expect(dashboard.dueCards).toHaveLength(dashboard.cards.length);
    expect(dashboard.dueTopics[0]).toMatchObject({ slug: "derivative", isDue: true });
    expect(dashboard.provenance).toContain("estimate derived from local learner history");

    const reviewed = dashboard.dueCards[0]!;
    const outcome = await rateTuiReviewCard(cwd, reviewed, 2, now);
    expect(outcome.next).toMatchObject({ repetitions: 1, intervalDays: 1, lastRating: 2 });
    expect(outcome.next.dueAt).toBe("2026-08-12T12:00:00.000Z");
    const reloaded = await loadTuiReviewDashboard(cwd, now);
    expect(reloaded.dueCards.some((card) => card.key === reviewed.key)).toBe(false);
  });

  test("surfaces a corrupt schedule without overwriting it", async () => {
    const cwd = await temporaryProject("tui-review-corrupt");
    await mkdir(stateDir(cwd), { recursive: true });
    const path = join(stateDir(cwd), "tui-review.json");
    await writeFile(path, "{not-json", "utf8");

    await expect(loadTuiReviewDashboard(cwd, "2026-08-11T12:00:00.000Z")).rejects.toThrow("contains invalid JSON");
    expect(await readFile(path, "utf8")).toBe("{not-json");
  });
});

describe("OpenTUI Settings", () => {
  test("maps real RPC settings while keeping code augmentation capability truthful", () => {
    const settings = tuiRuntimeSettings({
      model: { provider: "anthropic", id: "claude-sonnet-4-6" },
      thinkingLevel: "medium",
      autoRetryEnabled: true,
      autoCompactionEnabled: false,
      steeringMode: "one-at-a-time",
      followUpMode: "all",
    }, 7, ["keating-ui-action-v1"]);

    expect(settings).toEqual({
      model: "anthropic/claude-sonnet-4-6",
      thinking: "medium",
      autoRetry: true,
      autoCompaction: false,
      steeringMode: "one-at-a-time",
      followUpMode: "all",
      availableModels: 7,
      openUiReceiver: true,
      toolPolicy: OPEN_TUI_TOOL_POLICY,
      codeAugmentation: "handoff-required",
    });
    const markdown = tuiSettingsMarkdown(settings);
    expect(markdown).toContain("Agent tools: **read, grep, find, ls**");
    expect(markdown).toContain("command execution: **unavailable**");
    expect(markdown).toContain("source mutation: **unavailable**");
    expect(markdown).toContain("proposed-diff, confirmation, validation, and rollback");
    expect(markdown).toContain("`.keating/`");
  });
});
