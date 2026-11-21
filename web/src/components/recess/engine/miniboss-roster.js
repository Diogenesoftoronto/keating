export const minibossRoster = {
  clip: { id: "clip", name: "Margin Clip", cue: "Leave the dashed lane before the jaws snap." },
  pinwheel: { id: "pinwheel", name: "Pinwheel", cue: "Fly between the spokes as the pellets spread." },
  magnet: { id: "magnet", name: "Pocket Magnet", cue: "Move between the tracks as the washers return." },
};

const order = ["clip", "pinwheel", "magnet"];
const opening = {
  biology: "magnet", chemistry: "magnet", coding: "magnet", physics: "magnet",
  maths: "pinwheel", music: "pinwheel", spanish: "pinwheel", french: "pinwheel", japanese: "pinwheel",
};
const visits = new WeakMap();

export function chooseMiniboss(pack, owner, override) {
  if (override && Object.hasOwn(minibossRoster, override)) return override;
  const subject = pack.cast || pack.id || "general";
  let bySubject = visits.get(owner);
  if (!bySubject) { bySubject = new Map(); visits.set(owner, bySubject); }
  const visit = bySubject.get(subject) ?? 0;
  bySubject.set(subject, (visit + 1) % order.length);
  const first = Object.hasOwn(opening, subject) ? opening[subject] : "clip";
  return order[(order.indexOf(first) + visit) % order.length];
}
