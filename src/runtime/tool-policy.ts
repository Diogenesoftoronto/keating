export interface RuntimeToolPolicy {
  tools: readonly string[];
  read: boolean;
  execute: boolean;
  sourceMutation: boolean;
  recovery?: "shell-handoff";
}

export const CLASSIC_PI_TOOL_POLICY: RuntimeToolPolicy = {
  tools: ["read", "bash", "edit", "write", "grep", "find", "ls"],
  read: true,
  execute: true,
  sourceMutation: true,
};

/**
 * OpenTUI has no diff/confirmation/validation/rollback host protocol yet, so
 * mutation-capable tools must not be advertised to the model on this surface.
 */
export const OPEN_TUI_TOOL_POLICY: RuntimeToolPolicy = {
  tools: ["read", "grep", "find", "ls"],
  read: true,
  execute: false,
  sourceMutation: false,
  recovery: "shell-handoff",
};

export function runtimeToolList(policy: RuntimeToolPolicy): string {
  return policy.tools.join(",");
}
