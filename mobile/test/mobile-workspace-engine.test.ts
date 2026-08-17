import { CryptoHasher } from "bun";
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import type { AsyncSqlDatabase, AsyncSqlExecutor, SqlBindValue } from "../src/lib/learner-repository/database";
import { MobileWorkspaceEngine } from "../src/lib/mobile-workspace/engine";
import { MOBILE_PROGRAM_ENTRYPOINT } from "../src/lib/mobile-workspace/program";
import { SqliteMobileWorkspaceRepository } from "../src/lib/mobile-workspace/repository";

class BunSqlDatabase implements AsyncSqlDatabase {
  constructor(readonly database = new Database(":memory:")) {}
  async execAsync(source: string): Promise<void> { this.database.exec(source); }
  async runAsync(source: string, ...params: SqlBindValue[]) {
    const result = this.database.query(source).run(...params as Array<string | number | boolean | null | Uint8Array>);
    return { changes: result.changes, lastInsertRowId: Number(result.lastInsertRowid) };
  }
  async getFirstAsync<T>(source: string, ...params: SqlBindValue[]): Promise<T | null> {
    return (this.database.query(source).get(...params as Array<string | number | boolean | null | Uint8Array>) as T | null) ?? null;
  }
  async getAllAsync<T>(source: string, ...params: SqlBindValue[]): Promise<T[]> {
    return this.database.query(source).all(...params as Array<string | number | boolean | null | Uint8Array>) as T[];
  }
  async withExclusiveTransactionAsync(task: (transaction: AsyncSqlExecutor) => Promise<void>): Promise<void> {
    this.database.exec("BEGIN IMMEDIATE");
    try { await task(this); this.database.exec("COMMIT"); }
    catch (error) { this.database.exec("ROLLBACK"); throw error; }
  }
  async closeAsync(): Promise<void> { this.database.close(); }
}

const sha256 = async (value: string) => new CryptoHasher("sha256").update(value).digest("hex");

async function fixture() {
  const repository = new SqliteMobileWorkspaceRepository(new BunSqlDatabase());
  await repository.initialize();
  let id = 0;
  const engine = new MobileWorkspaceEngine(repository, {
    sha256,
    now: () => "2026-08-16T12:00:00.000Z",
    createId: (prefix) => `${prefix}-${++id}`,
  });
  return { repository, engine };
}

describe("mobile workspace engine", () => {
  test("persists visible source and activates a hash-checked overlay", async () => {
    const { repository, engine } = await fixture();
    const initial = await engine.initialize();
    const changed = JSON.stringify({
      schemaVersion: 1,
      screen: { type: "stack", gap: "sm", children: [{ type: "heading", text: "Focus mode" }, { type: "action", label: "Review", action: "review.start" }] },
    }, null, 2) + "\n";
    const overlay = await engine.propose({
      intent: "Make review the primary mobile action",
      requiredCapabilities: ["review.start", "ui.render"],
      changes: [{ path: MOBILE_PROGRAM_ENTRYPOINT, source: changed }],
    });

    expect((await engine.read())?.files).toEqual(initial.files);
    const receipt = await engine.activate(overlay.id);
    expect(receipt.status).toBe("active");
    expect(receipt.checks.every((check) => check.status === "passed")).toBe(true);
    expect((await repository.read())?.files[0]?.source).toBe(changed);
  });

  test("rejects an invalid program without replacing the active tree", async () => {
    const { engine } = await fixture();
    const initial = await engine.initialize();
    const overlay = await engine.propose({
      intent: "Attempt an unsafe component",
      requiredCapabilities: ["ui.render"],
      changes: [{ path: MOBILE_PROGRAM_ENTRYPOINT, source: '{"schemaVersion":1,"screen":{"type":"webview"}}' }],
    });
    const receipt = await engine.activate(overlay.id);
    expect(receipt.status).toBe("rejected");
    expect(receipt.checks.find((check) => check.id === "program-schema")?.status).toBe("failed");
    expect((await engine.read())?.files).toEqual(initial.files);
  });

  test("rolls back to the exact prior source and keeps history", async () => {
    const { engine } = await fixture();
    const initial = await engine.initialize();
    const changed = JSON.stringify({ schemaVersion: 1, screen: { type: "stack", gap: "lg", children: [{ type: "paragraph", text: "A calmer workspace" }] } }, null, 2) + "\n";
    const overlay = await engine.propose({ intent: "Use a calmer layout", requiredCapabilities: ["ui.render"], changes: [{ path: MOBILE_PROGRAM_ENTRYPOINT, source: changed }] });
    await engine.activate(overlay.id);

    const receipt = await engine.rollback();
    const restored = await engine.read();
    expect(receipt.status).toBe("rolled-back");
    expect(restored?.activeOverlayId).toBeUndefined();
    expect(restored?.files).toEqual(initial.files);
    expect(restored?.overlays).toHaveLength(1);
    expect(restored?.receipts).toHaveLength(2);
  });

  test("refuses a stale proposal after the workspace head advances", async () => {
    const { engine } = await fixture();
    await engine.initialize();
    const source = (label: string) => JSON.stringify({ schemaVersion: 1, screen: { type: "stack", gap: "md", children: [{ type: "heading", text: label }] } });
    const first = await engine.propose({ intent: "First", requiredCapabilities: ["ui.render"], changes: [{ path: MOBILE_PROGRAM_ENTRYPOINT, source: source("First") }] });
    const stale = await engine.propose({ intent: "Stale", requiredCapabilities: ["ui.render"], changes: [{ path: MOBILE_PROGRAM_ENTRYPOINT, source: source("Stale") }] });
    await engine.activate(first.id);
    const receipt = await engine.activate(stale.id);
    expect(receipt.status).toBe("rejected");
    expect(receipt.checks.find((check) => check.id === "parent-match")?.status).toBe("failed");
    expect((await engine.read())?.files[0]?.source).toContain("First");
  });

  test("fails closed when persisted visible source no longer matches its digest", async () => {
    const { repository, engine } = await fixture();
    const state = await engine.initialize();
    await repository.replace({
      ...state,
      files: [{ ...state.files[0]!, source: state.files[0]!.source.replace("Your learning", "Tampered") }],
    });
    await expect(engine.initialize()).rejects.toThrow("Stored active source hash mismatch");
  });

  test("reuses an exact semantic proposal id and rejects divergent reuse", async () => {
    const { engine } = await fixture();
    const proposal = { intent: "Same retry", requiredCapabilities: ["ui.render"] as const, changes: [{ path: MOBILE_PROGRAM_ENTRYPOINT, source: JSON.stringify({ schemaVersion: 1, screen: { type: "stack", gap: "sm", children: [{ type: "heading", text: "Retry" }] } }) }] };
    const first = await engine.propose(proposal, "overlay-semantic-key");
    const retry = await engine.propose(proposal, "overlay-semantic-key");
    expect(retry).toEqual(first);
    expect((await engine.read())?.overlays).toHaveLength(1);
    await expect(engine.propose({ ...proposal, intent: "Different" }, "overlay-semantic-key")).rejects.toThrow("different content");
  });
});
