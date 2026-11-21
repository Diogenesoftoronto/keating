export const bossRoster = {
  wall: { id: "wall", name: "Wall of Text", variants: ["Classic"] },
  compass: { id: "compass", name: "The Anglewright", variants: ["Concentric", "Walking pivot"] },
  cell: { id: "cell", name: "Doublet", variants: ["Budding", "Fission"] },
  metronome: { id: "metronome", name: "Offbeat", variants: ["Downbeat", "Backbeat"] },
  carbon: { id: "carbon", name: "Carbon Copy", variants: ["Forward proof", "Reverse proof"] },
  projector: { id: "projector", name: "Limelight", variants: ["Still light", "Crosslight"] },
};

const lineups = {
  measure: ["compass", "metronome", "cell", "projector", "carbon"],
  living: ["cell", "compass", "metronome", "carbon", "projector"],
  rhythm: ["metronome", "cell", "compass", "carbon", "projector"],
  print: ["carbon", "compass", "projector", "metronome", "cell"],
  light: ["projector", "cell", "carbon", "compass", "metronome"],
};
const casts = {
  maths: "measure", business: "measure", history: "print", law: "print", finance: "light",
  biology: "living", chemistry: "light", politics: "living", coding: "light",
  music: "rhythm", literature: "print", spanish: "rhythm", french: "rhythm", japanese: "rhythm",
};
const visits = new WeakMap();

// Only called by a real spawn. Inspecting a roster or choosing a practice opponent cannot use up a rematch.
export function chooseBossEncounter(pack, owner, override) {
  if (override && Object.hasOwn(bossRoster, override.id)) {
    return { id: override.id, variant: override.id !== "wall" && override.variant === 1 ? 1 : 0 };
  }
  const cast = Object.hasOwn(casts, pack.cast) ? pack.cast : pack.id;
  const lineup = lineups[casts[cast]] ?? lineups.measure;
  // A lesson director can write a personal boss name and taunts. Let that authored Wall open its tour.
  const sequence = pack.boss?.name ? ["wall", ...lineup] : [...lineup.slice(0, 2), "wall", ...lineup.slice(2)];
  let bySubject = visits.get(owner);
  if (!bySubject) { bySubject = new Map(); visits.set(owner, bySubject); }
  const key = JSON.stringify([cast || "general", pack.boss?.name || null]);
  const count = bySubject.get(key) ?? 0;
  bySubject.set(key, count + 1);
  const id = sequence[count % sequence.length];
  return { id, variant: id === "wall" ? 0 : Math.floor(count / sequence.length) % 2 };
}
