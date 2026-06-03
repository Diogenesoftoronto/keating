import { unsupportedCapability } from "./errors";
import type { AgentSandbox, SandboxSnapshot } from "./types";

export interface TransactionResult<TValidation> {
  committed: boolean;
  snapshot: SandboxSnapshot;
  validation: TValidation;
}

export interface SandboxTransactionOptions<TValidation> {
  name?: string;
  mutate(): Promise<void>;
  validate(): Promise<TValidation>;
  accept(validation: TValidation): boolean;
}

export async function withSandboxTransaction<TValidation>(
  sandbox: AgentSandbox,
  options: SandboxTransactionOptions<TValidation>
): Promise<TransactionResult<TValidation>> {
  if (!sandbox.snapshots) {
    throw unsupportedCapability(sandbox.kind, ["snapshots"], "Use a record-level checkpoint or a remote sandbox.");
  }

  const snapshot = await sandbox.snapshots.create(options.name);
  try {
    await options.mutate();
    const validation = await options.validate();
    if (options.accept(validation)) {
      return { committed: true, snapshot, validation };
    }
    await sandbox.snapshots.restore(snapshot);
    return { committed: false, snapshot, validation };
  } catch (error) {
    await sandbox.snapshots.restore(snapshot);
    throw error;
  }
}

