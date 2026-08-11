import { describe, expect, test } from "bun:test";
import type { PortableLearnerData } from "@keating/learner-contracts";
import {
  convertLegacyPersistedState,
  migrateLegacyPersistedStateToRepository,
  type LearnerRepository,
  type MigrationEntry,
  type MigrationPhase,
} from "../src/lib/learner-repository";
import type { PersistedAppState } from "../src/lib/types";

function legacyState(): PersistedAppState {
  return {
    schemaVersion: 4,
    sessions: [{
      id: "session-source",
      title: "Probability",
      createdAt: 1_786_310_000_000,
      updatedAt: 1_786_310_010_000,
      messages: [{ id: "message-source", role: "user", content: "Teach probability", createdAt: 1_786_310_000_000 }],
    }, {
      id: "session-branch",
      title: "Branch · Probability",
      createdAt: 1_786_310_020_000,
      updatedAt: 1_786_310_030_000,
      parentSessionId: "session-source",
      messages: [{
        id: "message-branch-user",
        role: "user",
        content: "Use this diagram",
        createdAt: 1_786_310_020_000,
        attachments: [{
          id: "attachment-1",
          kind: "image",
          name: "diagram.png",
          mimeType: "image/png",
          size: 512,
          uri: "file:///documents/composer-attachments/diagram.png",
        }],
      }, {
        id: "message-branch-assistant",
        role: "assistant",
        content: "What changes when the prior changes?",
        createdAt: 1_786_310_030_000,
        provider: "openai",
        model: "gpt-5",
        usage: { inputTokens: 40, outputTokens: 20, totalTokens: 60, costUsd: 0.001 },
        feedback: "helpful",
      }],
    }],
    activeSessionId: "session-branch",
    artifacts: [{
      id: "artifact-1",
      sessionId: "session-branch",
      messageId: "message-branch-assistant",
      kind: "concept-map",
      source: "keating-core",
      topic: "Probability",
      title: "Probability map",
      content: "graph TD; A-->B",
      createdAt: 1_786_310_040_000,
    }],
    providerSettings: { provider: "openai", model: "gpt-5", baseUrl: "https://api.openai.com/v1", temperature: 0.6 },
    learnerFeedback: { helpful: 7, missed: 2 },
  };
}

class MemoryMigrationJournal {
  phase: MigrationPhase = "prepared";
  advances: MigrationPhase[] = [];

  private entry(): MigrationEntry {
    return {
      id: "async-storage-v1-to-sqlite-v2",
      sourceVersion: 1,
      targetVersion: 2,
      digest: "a".repeat(64),
      phase: this.phase,
      createdAt: "2026-08-10T00:00:00.000Z",
      updatedAt: "2026-08-10T00:00:00.000Z",
      ...(this.phase === "completed" ? { completedAt: "2026-08-10T00:00:00.000Z" } : {}),
    };
  }

  async start(): Promise<MigrationEntry> {
    return this.entry();
  }

  async advance(_id: string, phase: MigrationPhase): Promise<MigrationEntry> {
    this.phase = phase;
    this.advances.push(phase);
    return this.entry();
  }
}

function migrationRepository(options: { failFirstReplace?: boolean } = {}) {
  const journal = new MemoryMigrationJournal();
  let stored: PortableLearnerData | null = null;
  let replaceCalls = 0;
  const repository = {
    migrations: journal,
    records: {
      replace: async (data: PortableLearnerData) => {
        replaceCalls += 1;
        if (options.failFirstReplace && replaceCalls === 1) throw new Error("injected copy interruption");
        stored = structuredClone(data);
      },
      replaceWithLocalAttachments: async (data: PortableLearnerData) => {
        replaceCalls += 1;
        if (options.failFirstReplace && replaceCalls === 1) throw new Error("injected copy interruption");
        stored = structuredClone(data);
      },
      snapshot: async () => structuredClone(stored!),
    },
  } as unknown as LearnerRepository;
  return { repository, journal, getStored: () => stored, getReplaceCalls: () => replaceCalls };
}

describe("legacy mobile learner migration", () => {
  test("converts sessions, attachments, usage, and topic provenance without inventing mastery", () => {
    const converted = convertLegacyPersistedState(legacyState());
    expect(converted.data.sessions[1]).toMatchObject({
      id: "session-branch",
      parentSessionId: "session-source",
    });
    expect(converted.data.sessions[1]?.forkedFromMessageId).toBeUndefined();
    expect(converted.data.sessions[1]?.messages[0]?.attachments?.[0]).toEqual({
      id: "attachment-1",
      kind: "image",
      name: "diagram.png",
      mimeType: "image/png",
      sizeBytes: 512,
    });
    expect(JSON.stringify(converted.data)).not.toContain("file:///documents");
    expect(converted.localAttachments).toEqual([{
      messageId: "message-branch-user",
      attachmentId: "attachment-1",
      uri: "file:///documents/composer-attachments/diagram.png",
    }]);
    expect(converted.data.usageEvents[0]).toMatchObject({
      provider: "openai",
      model: "gpt-5",
      providerReported: { totalTokens: 60, costUsd: 0.001 },
    });
    expect(converted.data.feedbackEvents[0]).toMatchObject({
      sessionId: "session-branch",
      messageId: "message-branch-assistant",
      rating: "helpful",
    });
    expect(converted.data.topicEvidence.map((evidence) => evidence.provenance)).toEqual(["session", "session", "artifact"]);
    expect(converted.data.learnerProfile).toEqual({
      topicsExplored: ["Branch · Probability", "Probability"],
      strengths: [],
      weaknesses: [],
      sessionsCount: 2,
      lastSessionAt: new Date(1_786_310_030_000).toISOString(),
    });
    expect(converted.legacyFeedback).toEqual({ helpful: 7, missed: 2 });
  });

  test("resumes an interrupted copy and completes only after read-back verification", async () => {
    const harness = migrationRepository({ failFirstReplace: true });
    const source = { state: legacyState(), digest: "a".repeat(64) };
    await expect(migrateLegacyPersistedStateToRepository(harness.repository, source)).rejects.toThrow("copy interruption");
    expect(harness.journal.phase).toBe("prepared");

    const completed = await migrateLegacyPersistedStateToRepository(harness.repository, source);
    expect(completed.data.usageEvents).toHaveLength(1);
    expect(harness.journal.advances).toEqual(["copied", "verified", "completed"]);
    expect(harness.getReplaceCalls()).toBe(2);
    expect(harness.getStored()).toEqual(completed.data);
  });

  test("preserves a dangling branch transcript and reports the lost relation", () => {
    const state = legacyState();
    state.sessions[1] = { ...state.sessions[1]!, parentSessionId: "deleted-session" };
    const converted = convertLegacyPersistedState(state);
    expect(converted.data.sessions[1]?.parentSessionId).toBeUndefined();
    expect(converted.data.sessions[1]?.messages).toHaveLength(2);
    expect(converted.warnings[0]).toContain("deleted parent");
  });
});
