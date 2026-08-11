export type OpenTuiExitResult =
  | { action: "exit" }
  | { action: "shell"; sessionPath?: string };

/** Preserve the selected Pi session when OpenTUI hands control to classic Pi. */
export function shellHandoffArgs(result: OpenTuiExitResult): string[] {
  if (result.action !== "shell" || !result.sessionPath?.trim()) return [];
  return ["--session", result.sessionPath];
}
