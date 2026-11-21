export type MinibossId = "clip" | "pinwheel" | "magnet";
export const minibossRoster: Record<MinibossId, { id: MinibossId; name: string; cue: string }>;
export function chooseMiniboss(pack: { id: string; cast?: string }, owner: object, override?: MinibossId): MinibossId;
