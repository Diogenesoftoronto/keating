// Distances are CSS pixels. Pointer timestamps and the focus check use the same
// monotonic clock, so a gesture never schedules work beyond its flight.
const SLOP = 10;
const HOLD_MS = 330;
const SECOND_FINGER_MS = 140;
const TAP_MS = 260;

export function flightTouchGestures() {
  const fingers = new Map();
  let started = 0, eligible = false, paired = false, focused = false;

  function cancel() {
    eligible = paired = focused = false;
  }

  function reset() {
    fingers.clear();
    cancel();
  }

  function down(id, x, y, now, playing) {
    if (fingers.has(id)) return;
    if (fingers.size === 0) {
      started = now;
      eligible = playing;
    } else if (fingers.size === 1 && eligible && !paired && playing && now - started <= SECOND_FINGER_MS) {
      paired = true;
    } else {
      cancel();
    }
    fingers.set(id, { x, y });
  }

  function move(id, x, y, now) {
    const origin = fingers.get(id);
    if (eligible && origin && !isFocused(now) && Math.hypot(x - origin.x, y - origin.y) > SLOP) cancel();
  }

  function up(id, x, y, now, completed) {
    if (!fingers.has(id)) return false;
    if (completed) move(id, x, y, now);
    else cancel();
    fingers.delete(id);
    if (fingers.size) return false;
    const bomb = eligible && paired && now - started <= TAP_MS;
    reset();
    return bomb;
  }

  function isFocused(now) {
    if (eligible && !paired && fingers.size === 1 && now - started >= HOLD_MS) focused = true;
    return focused;
  }

  return { down, move, up, isFocused, cancel, reset };
}
