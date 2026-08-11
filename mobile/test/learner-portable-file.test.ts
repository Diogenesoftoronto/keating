import { describe, expect, test } from "bun:test";
import { createPortableLearnerEnvelope, type PortableLearnerData } from "@keating/learner-contracts";
import {
  PORTABLE_LEARNER_JSON_MIME_TYPE,
  PortableLearnerFileError,
  exportPortableLearnerFile,
  pickPortableLearnerImport,
  portableLearnerExportFileName,
  preparePortableLearnerImport,
  type PortableLearnerFileIo,
  type PortableLearnerPickedFile,
} from "../src/lib/learner-portable-file";
import { PortableLearnerJsonError, serializePortableLearnerJson } from "../src/lib/learner-portable-json";

const AT = "2026-08-10T00:00:00.000Z";

function data(): PortableLearnerData {
  return {
    generatedAt: AT,
    sessions: [], artifacts: [], goals: [], questionChecks: [], quizResults: [], decks: [], cardReviews: [], studyPriorities: [],
    feedbackEvents: [], usageEvents: [], topicEvidence: [], benchmarks: [], evolutions: [],
    learnerProfile: { topicsExplored: [], strengths: [], weaknesses: [], sessionsCount: 0 },
  };
}

function file(text: string, sizeBytes = new TextEncoder().encode(text).byteLength): PortableLearnerPickedFile {
  return { name: "keating-learner.json", sizeBytes, readText: async () => text };
}

function io(overrides: Partial<PortableLearnerFileIo> = {}) {
  const calls = { wrote: "", deleted: 0, shared: [] as Array<{ uri: string; options: { mimeType: string; dialogTitle: string } }> };
  const base: PortableLearnerFileIo = {
    pickJsonFile: async () => null,
    createTemporaryJsonFile: async () => ({
      uri: "file:///cache/keating.json",
      writeText: async (text) => { calls.wrote = text; },
      delete: async () => { calls.deleted += 1; },
    }),
    isSharingAvailable: async () => true,
    share: async (uri, options) => { calls.shared.push({ uri, options }); },
  };
  return { io: { ...base, ...overrides }, calls };
}

describe("portable learner files", () => {
  test("exports JSON with a date-stamped cache name and always cleans up after sharing", async () => {
    const { io: fake, calls } = io();
    const name = portableLearnerExportFileName(new Date(AT));
    const result = await exportPortableLearnerFile(fake, createPortableLearnerEnvelope(data()), { now: () => new Date(AT) });

    expect(result).toEqual({ name });
    expect(name).toBe("keating-learner-export-2026-08-10T000000000Z.json");
    expect(calls.wrote).toBe(serializePortableLearnerJson(createPortableLearnerEnvelope(data())));
    expect(calls.shared).toEqual([{
      uri: "file:///cache/keating.json",
      options: { mimeType: PORTABLE_LEARNER_JSON_MIME_TYPE, dialogTitle: "Export Keating learner data" },
    }]);
    expect(calls.deleted).toBe(1);
  });

  test("cleans up when sharing is unavailable or fails", async () => {
    const unavailable = io({ isSharingAvailable: async () => false });
    await expect(exportPortableLearnerFile(unavailable.io, createPortableLearnerEnvelope(data())))
      .rejects.toMatchObject({ code: "share-unavailable" });
    expect(unavailable.calls.deleted).toBe(1);

    const failed = io({ share: async () => { throw new Error("platform failure"); } });
    await expect(exportPortableLearnerFile(failed.io, createPortableLearnerEnvelope(data())))
      .rejects.toMatchObject({ code: "share-failed" });
    expect(failed.calls.deleted).toBe(1);
  });

  test("treats a picker cancel as a no-op without reading", async () => {
    let reads = 0;
    const preview = await pickPortableLearnerImport({
      pickJsonFile: async () => {
        reads += 1;
        return null;
      },
    });
    expect(preview).toBeNull();
    expect(reads).toBe(1);
  });

  test("rejects oversized picker metadata before reading text", async () => {
    let read = false;
    const tooLarge: PortableLearnerPickedFile = {
      name: "large.json",
      sizeBytes: 9,
      readText: async () => { read = true; return "{}"; },
    };
    await expect(preparePortableLearnerImport(tooLarge, { maximumBytes: 8 }))
      .rejects.toMatchObject({ code: "file-too-large" });
    expect(read).toBe(false);
  });

  test("surfaces malformed JSON without leaking selected payload text", async () => {
    const payload = '{"sensitive":"do-not-show-me"';
    await expect(preparePortableLearnerImport(file(payload))).rejects.toBeInstanceOf(PortableLearnerJsonError);
    try {
      await preparePortableLearnerImport(file(payload));
    } catch (error) {
      expect((error as Error).message).not.toContain("do-not-show-me");
    }
  });

  test("prepares a valid preview without mutating learner data", async () => {
    const envelope = createPortableLearnerEnvelope(data());
    const preview = await preparePortableLearnerImport(file(JSON.stringify(envelope)));
    expect(preview.name).toBe("keating-learner.json");
    expect(preview.envelope).toEqual(envelope);
    expect(preview.summary).toBe("0 sessions · 0 messages · 0 artifacts · 0 goals · 0 assessments · 0 decks · 0 reviews · 0 study priorities · 0 feedback · 0 usage records · 0 topic evidence records · 0 benchmarks · 0 evolutions");
  });

  test("uses user-corrective file errors", () => {
    const error = new PortableLearnerFileError("file-unavailable", "Choose a readable JSON learner export and try again.");
    expect(error.message).toContain("try again");
  });
});
