/** Interpret test and release observations without turning missing evidence into success. */
export type KnownFailure = {
  suite: string;
  name: string;
  reason: string;
  added: string;
};

export function parseTestOutput(raw: string) {
  const text = raw.replace(/\x1b\[[0-9;]*m/g, "");
  const bunPass = [...text.matchAll(/^\s*(\d+) pass\s*$/gm)].at(-1);
  const bunFail = [...text.matchAll(/^\s*(\d+) fail\s*$/gm)].at(-1);
  const errors = Number([...text.matchAll(/^\s*(\d+) errors?(?:\(s\))?\s*$/gm)].at(-1)?.[1] ?? 0);
  const bunFailures = /^\s*\(fail\) (.+?)(?:\s+\[\d+(?:\.\d+)?m?s\])?\s*$/gm;
  const failures = [...text.matchAll(bunFailures)].map(match => match[1]!.trim());

  // Flue uses node:test. Exclude aggregate suite failures, which repeat leaf failures.
  const tapFailures = /^\s*not ok \d+ - (.+)\n([\s\S]*?)(?=^[ \t]*(?:not )?ok \d+ - |(?![\s\S]))/gm;
  for (const match of text.matchAll(tapFailures)) {
    if (!match[2]!.includes("subtestsFailed")) failures.push(match[1]!.trim());
  }
  const passes = bunPass ? Number(bunPass[1]) : Number([...text.matchAll(/^# pass (\d+)/gm)].at(-1)?.[1] ?? 0);
  const failed = bunFail
    ? Number(bunFail[1])
    : Number([...text.matchAll(/^# fail (\d+)/gm)].at(-1)?.[1] ?? failures.length);
  return {
    passes,
    failed,
    errors,
    failures: [...new Set(failures)],
    hasSummary: Boolean(bunPass || /^# pass \d+/m.test(text)),
  };
}

export function matchFailures(suite: string, names: string[], known: KnownFailure[]) {
  return names.map(name => ({
    name,
    known: known.find(entry => entry.suite === suite && entry.name === name),
  }));
}

export type WorkflowRun = {
  databaseId?: number;
  headSha: string;
  headBranch?: string;
  status: string;
  conclusion: string | null;
  url?: string;
  displayTitle?: string;
};

export function classifyStatus(
  run: WorkflowRun | undefined,
  stagingSha: string | undefined,
  expectedSha: string | undefined,
): 0 | 1 | 3 {
  if (!run || !expectedSha || run.headSha !== expectedSha) return 3;
  if (run.status !== "completed") return 3;
  if (run.conclusion !== "success") return 1;
  return stagingSha === expectedSha ? 0 : 3;
}
