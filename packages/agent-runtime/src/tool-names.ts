/** Browser-owned portable tools must not shadow Flue's framework tools. */
export const PORTABLE_TOOL_NAMES = {
  activateSkill: "keating_activate_skill",
  readSkillResource: "keating_read_skill_resource",
  task: "keating_task",
} as const;
