export type TuiLeaderAction =
  | "palette"
  | "sessions"
  | "library"
  | "courses"
  | "model"
  | "thinking"
  | "new-session"
  | "abort"
  | "retry"
  | "actions"
  | "search";

const LEADER_ACTIONS: Readonly<Record<string, TuiLeaderAction>> = {
  p: "palette",
  s: "sessions",
  l: "library",
  o: "courses",
  m: "model",
  t: "thinking",
  n: "new-session",
  x: "abort",
  r: "retry",
  u: "actions",
  f: "search",
};

export const TUI_LEADER_HINT = ":m models  :p commands  :s sessions  :l library  :o courses  :t thinking  :n new  :x stop";

export function tuiLeaderAction(keyName: string): TuiLeaderAction | undefined {
  return LEADER_ACTIONS[keyName.toLowerCase()];
}

export function isTuiLeaderKey(keyName: string): boolean {
  return keyName === ":" || keyName.toLowerCase() === "colon";
}
