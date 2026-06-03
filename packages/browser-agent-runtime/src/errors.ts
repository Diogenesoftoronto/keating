import type { SandboxKind, SandboxRequirement } from "./types";

export class SandboxCapabilityError extends Error {
  readonly name = "SandboxCapabilityError";
  readonly sandboxKind?: SandboxKind;
  readonly missing: Array<keyof SandboxRequirement>;

  constructor(message: string, missing: Array<keyof SandboxRequirement>, sandboxKind?: SandboxKind) {
    super(message);
    this.missing = missing;
    this.sandboxKind = sandboxKind;
  }
}

export class SandboxExecutionError extends Error {
  readonly name = "SandboxExecutionError";
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;

  constructor(message: string, exitCode: number, stdout = "", stderr = "") {
    super(message);
    this.exitCode = exitCode;
    this.stdout = stdout;
    this.stderr = stderr;
  }
}

export function unsupportedCapability(
  sandboxKind: SandboxKind | undefined,
  missing: Array<keyof SandboxRequirement>,
  fallbackHint?: string
): SandboxCapabilityError {
  const subject = sandboxKind ? `Sandbox "${sandboxKind}"` : "No sandbox";
  const hint = fallbackHint ? ` ${fallbackHint}` : "";
  return new SandboxCapabilityError(
    `${subject} does not support required capability: ${missing.join(", ")}.${hint}`,
    missing,
    sandboxKind
  );
}

