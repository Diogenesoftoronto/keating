import { expect, test } from "bun:test";
import { mkdtemp, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDecisionPolicyDataset, decisionPolicySha256, readDecisionPolicySource, validateDecisionPolicyManifest } from "../src/judgement/decision-policy-dataset.js";
import { exportDecisionPolicyDataset } from "../scripts/training/build-decision-policy-dataset.js";

const empty = { generatedAt: "2026-01-10T00:00:00.000Z", sessions: [], artifacts: [], goals: [], questionChecks: [], quizResults: [], decks: [], cardReviews: [],
  studyPriorities: [], feedbackEvents: [], usageEvents: [], topicEvidence: [], benchmarks: [], evolutions: [],
  learnerProfile: { topicsExplored: [], strengths: [], weaknesses: [], sessionsCount: 0 } };

test("dataset export pins original source bytes and reports insufficient evidence for all targets", async () => {
  const directory = await mkdtemp(join(tmpdir(), "decision-policy-")), text = `${JSON.stringify(empty)}\n`, path = join(directory, "learner.json");
  await writeFile(path, text);
  const manifest = { schemaVersion: 1, sources: [{ path, sha256: decisionPolicySha256(text), learnerId: "one", groupId: "one", split: "fit" }] };
  const built = await buildDecisionPolicyDataset(directory, manifest);
  expect(built.binding.sources[0]!.text).toBe(text);
  expect(Object.values(built.datasets).every(dataset => dataset.audit.status === "insufficient" && dataset.rows.length === 0)).toBe(true);
  const output = join(directory, "export"); await exportDecisionPolicyDataset(directory, manifest, output);
  expect((await stat(output)).mode & 0o777).toBe(0o700);
  expect((await stat(join(output, "sources.json"))).mode & 0o777).toBe(0o600);
  expect(JSON.parse(await readFile(join(output, "audit.json"), "utf8")).datasetSha256).toBe(built.datasetSha256);
  await expect(exportDecisionPolicyDataset(directory, manifest, output)).rejects.toThrow();
  await writeFile(path, `${text} `);
  await expect(buildDecisionPolicyDataset(directory, manifest)).rejects.toThrow("decision_policy_source_invalid");
});

test("source reads reject symlinks, oversized files and malformed UTF-8; split leakage fails closed", async () => {
  const directory = await mkdtemp(join(tmpdir(), "decision-policy-files-")), path = join(directory, "source.json"), link = join(directory, "link.json");
  await writeFile(path, "12345"); await symlink(path, link);
  await expect(readDecisionPolicySource(link)).rejects.toThrow();
  await expect(readDecisionPolicySource(path, 4)).rejects.toThrow();
  await writeFile(path, Uint8Array.from([0xff])); await expect(readDecisionPolicySource(path)).rejects.toThrow();
  expect(() => validateDecisionPolicyManifest({ schemaVersion: 1, sources: [
    { path: "a", sha256: "a".repeat(64), learnerId: "a", groupId: "shared", split: "fit" },
    { path: "b", sha256: "b".repeat(64), learnerId: "b", groupId: "shared", split: "validation" },
  ] })).toThrow("decision_policy_source_invalid");
});
