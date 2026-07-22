import { describe, expect, it } from "bun:test";
import { generateLearningArtifact } from "../src/lib/learning-artifacts";

describe("generateLearningArtifact", () => {
  it("reuses the portable Keating engine for domain-aware lesson plans", () => {
    const artifact = generateLearningArtifact("recursion", "study-plan");

    expect(artifact.title).toBe("Study plan: Recursion");
    expect(artifact.content).toContain("## Live Code");
    expect(artifact.content).toContain("## Transfer and Reflection");
  });

  it("produces a Mermaid concept map without a provider call", () => {
    const artifact = generateLearningArtifact("entropy", "concept-map");

    expect(artifact.content).toContain("```mermaid");
    expect(artifact.content).toContain("A[Entropy]");
  });

  it("produces a deterministic quiz and answer key", () => {
    const first = generateLearningArtifact("Bayes' rule", "quiz", 17);
    const second = generateLearningArtifact("Bayes' rule", "quiz", 17);

    const withoutGeneratedAt = (content: string) => content.replace(/^> Generated: .*$/m, "> Generated: <timestamp>");
    expect(withoutGeneratedAt(first.content)).toBe(withoutGeneratedAt(second.content));
    expect(first.content).toContain("# Check your answers");
    expect(first.content).toContain("||");
  });
});
