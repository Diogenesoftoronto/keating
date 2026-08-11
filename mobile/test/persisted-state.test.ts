import { describe, expect, test } from "bun:test";
import { migratePersistedState } from "../src/lib/persisted-state";

function legacyState() {
  return {
    schemaVersion: 1,
    sessions: [{
      id: "session-1",
      title: "Existing lesson",
      createdAt: 1,
      updatedAt: 2,
      messages: [{ id: "message-1", role: "user", content: "hello", createdAt: 2 }],
    }],
    activeSessionId: "session-1",
    artifacts: [],
    providerSettings: {
      provider: "openai",
      model: "gpt-5.4",
      baseUrl: "https://api.openai.com/v1",
      temperature: 0.6,
    },
    learnerFeedback: { helpful: 0, missed: 0 },
  };
}

describe("mobile persisted-state migration", () => {
  test("validates and upgrades the legacy AsyncStorage envelope without changing learner data", () => {
    const migrated = migratePersistedState(legacyState());
    expect(migrated?.schemaVersion).toBe(4);
    expect(migrated?.sessions[0]?.title).toBe("Existing lesson");
    expect(migrated?.sessions[0]?.messages[0]?.content).toBe("hello");
  });

  test("migrates prior versions and distinguishes local from imported attachment metadata in v4", () => {
    expect(migratePersistedState({ ...legacyState(), schemaVersion: 2 })?.schemaVersion).toBe(4);
    const candidate = {
      ...legacyState(),
      schemaVersion: 4,
      sessions: [{
        ...legacyState().sessions[0],
        messages: [{
          ...legacyState().sessions[0].messages[0],
          attachments: [{
            id: "attachment-1",
            kind: "image",
            name: "diagram.png",
            mimeType: "image/png",
            size: 42,
            uri: "file:///documents/composer-attachments/diagram.png",
          }],
        }],
      }],
    };
    expect(migratePersistedState(candidate)?.sessions[0]?.messages[0]?.attachments?.[0]?.name).toBe("diagram.png");

    const imported = structuredClone(candidate);
    imported.sessions[0]!.messages[0]!.attachments![0] = {
      id: "attachment-1",
      kind: "image",
      name: "diagram.png",
      mimeType: "image/png",
      size: 42,
      localState: "missing",
    };
    expect(migratePersistedState(imported)?.sessions[0]?.messages[0]?.attachments?.[0]).toEqual({
      id: "attachment-1",
      kind: "image",
      name: "diagram.png",
      mimeType: "image/png",
      size: 42,
      localState: "missing",
    });

    imported.sessions[0]!.messages[0]!.attachments![0]!.uri = "file:///documents/diagram.png";
    expect(migratePersistedState(imported)).toBeNull();
  });

  test("rejects transient payload data and non-app file references", () => {
    const message = {
      ...legacyState().sessions[0].messages[0],
      attachments: [{
        id: "attachment-1",
        kind: "document",
        name: "notes.md",
        mimeType: "text/markdown",
        size: 42,
        uri: "content://temporary-picker/notes.md",
        data: "must not persist",
        encoding: "text",
      }],
    };
    expect(migratePersistedState({
      ...legacyState(),
      schemaVersion: 4,
      sessions: [{ ...legacyState().sessions[0], messages: [message] }],
    })).toBeNull();
  });

  test("fails closed for malformed, unsupported, or secret-shaped state", () => {
    expect(migratePersistedState({ ...legacyState(), sessions: "not-an-array" })).toBeNull();
    expect(migratePersistedState({ ...legacyState(), schemaVersion: 99 })).toBeNull();
    expect(migratePersistedState({ ...legacyState(), providerSettings: { provider: "unknown" } })).toBeNull();
  });
});
