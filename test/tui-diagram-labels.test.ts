import { describe, expect, test } from "bun:test";
import type { UiTaskNode } from "@keating/learner-contracts";
import { uiNodePresentation } from "../src/tui/ui/index.js";

const task: UiTaskNode = {
  type: "task", kind: "assignment", id: "cycle", title: "Water cycle", brief: "Connect the cycle.",
  criteria: ["Explain what drives evaporation."], submission: { format: "text" },
  diagram: { components: [{ id: "lake", label: "Lake", kind: "resource" }], connections: [], kinds: ["resource", "process"],
    checks: [{ id: "process", label: "Include a process", type: "component", kind: "process" }] },
};

describe("terminal diagram labels", () => {
  test("uses the shared structural-check and review-criteria terminology", () => {
    const body = uiNodePresentation(task).body.join("\n");
    expect(body).toContain("**Structural checks**");
    expect(body).toContain("- Include a process");
    expect(body).toContain("**Review criteria**");
    expect(body).not.toContain("Judged on");
  });

  test("tasks without a diagram keep their existing criteria heading", () => {
    const { diagram: _diagram, ...plain } = task;
    expect(uiNodePresentation(plain).body.join("\n")).toContain("**Judged on**");
  });
});
