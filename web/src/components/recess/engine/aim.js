/**
 * Half-angle of the pilot's automatic sight in radians. The short side of the
 * arena is the unit so the same approach works in portrait and landscape.
 */
export function autoAimSpread(distance, width, height, tune = 0.75, focused = false) {
  const arenaSpan = Math.max(1, Math.min(width, height));
  const range = Math.max(0, Math.min(1, (distance / arenaSpan - 0.2) / 0.6));
  const eased = range * range * (3 - 2 * range);
  const condition = Math.max(0, Math.min(1, tune / 0.75));
  const spread = (0.01 + 0.15 * eased) * (1 + 0.35 * (1 - condition));
  return focused ? spread * 0.35 : spread;
}
