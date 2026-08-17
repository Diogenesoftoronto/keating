import {
  validateMobileWorkspaceActivationReceipt,
  validateMobileWorkspaceBase,
  validateMobileWorkspaceFile,
  validateMobileWorkspaceOverlay,
  type MobileWorkspaceActivationReceipt,
  type MobileWorkspaceBase,
  type MobileWorkspaceFile,
  type MobileWorkspaceOverlayCommit,
} from "@keating/learner-contracts";
import type { AsyncSqlDatabase, AsyncSqlExecutor } from "../learner-repository/database";
import { withExclusiveTransaction } from "../learner-repository/database";

export interface MobileWorkspaceState {
  base: MobileWorkspaceBase;
  activeOverlayId?: string;
  files: MobileWorkspaceFile[];
  overlays: MobileWorkspaceOverlayCommit[];
  receipts: MobileWorkspaceActivationReceipt[];
}

export interface MobileWorkspaceRepository {
  read(): Promise<MobileWorkspaceState | null>;
  replace(state: MobileWorkspaceState): Promise<void>;
  close(): Promise<void>;
}

function validateState(value: unknown): value is MobileWorkspaceState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const state = value as Partial<MobileWorkspaceState>;
  const keys = Object.keys(value);
  if (keys.some((key) => !["base", "activeOverlayId", "files", "overlays", "receipts"].includes(key))
    || !validateMobileWorkspaceBase(state.base)
    || (state.activeOverlayId !== undefined && typeof state.activeOverlayId !== "string")
    || !Array.isArray(state.files) || !state.files.every(validateMobileWorkspaceFile)
    || !Array.isArray(state.overlays) || !state.overlays.every(validateMobileWorkspaceOverlay)
    || !Array.isArray(state.receipts) || !state.receipts.every(validateMobileWorkspaceActivationReceipt)) return false;
  return state.activeOverlayId === undefined
    || state.overlays.some((overlay) => overlay.id === state.activeOverlayId);
}

export class SqliteMobileWorkspaceRepository implements MobileWorkspaceRepository {
  constructor(private readonly database: AsyncSqlDatabase) {}

  async initialize(): Promise<void> {
    await this.database.execAsync(`
      CREATE TABLE IF NOT EXISTS mobile_workspace_state (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        state_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  async read(): Promise<MobileWorkspaceState | null> {
    const row = await this.database.getFirstAsync<{ state_json: string }>(
      "SELECT state_json FROM mobile_workspace_state WHERE singleton = 1",
    );
    if (!row) return null;
    let value: unknown;
    try { value = JSON.parse(row.state_json); } catch { throw new Error("Stored mobile workspace is not valid JSON."); }
    if (!validateState(value)) throw new Error("Stored mobile workspace failed contract validation.");
    return value;
  }

  async replace(state: MobileWorkspaceState): Promise<void> {
    if (!validateState(state)) throw new Error("Refusing to persist an invalid mobile workspace state.");
    await withExclusiveTransaction(this.database, async (transaction: AsyncSqlExecutor) => {
      await transaction.runAsync(
        `INSERT INTO mobile_workspace_state (singleton, state_json, updated_at) VALUES (1, ?, ?)
         ON CONFLICT(singleton) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at`,
        JSON.stringify(state), new Date().toISOString(),
      );
    });
  }

  close(): Promise<void> { return this.database.closeAsync(); }
}
