export type BossId = "wall" | "compass" | "cell" | "metronome" | "carbon" | "projector";
export type BossVariant = 0 | 1;
export interface BossEncounter { id: BossId; variant?: BossVariant }
export const bossRoster: Record<BossId, { id: BossId; name: string; variants: readonly string[] }>;
export function chooseBossEncounter(
  pack: { id: string; cast?: string; boss?: { name: string } },
  owner: object,
  override?: BossEncounter,
): { id: BossId; variant: BossVariant };
