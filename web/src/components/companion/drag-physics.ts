export type Point = { x: number; y: number };
export type LedgeBounds = { top: number; left: number; right: number };

export const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));

export function dragVelocity(previous: Point, delta: Point, elapsedMs: number): Point {
	const elapsed = Math.max(elapsedMs, 4) / 1000;
	const weight = 1 - Math.exp(-elapsed / 0.035);
	return {
		x: previous.x + (clamp(delta.x / elapsed, -2400, 2400) - previous.x) * weight,
		y: previous.y + (clamp(delta.y / elapsed, -2400, 2400) - previous.y) * weight,
	};
}

export function releaseVelocity(sample: Point, ageMs: number): Point {
	const decay = Math.exp(-Math.max(0, ageMs - 24) / 46);
	return { x: sample.x * decay, y: sample.y * decay };
}

export function heldMotion(previousAngle: number, phase: number, velocity: Point, dt: number) {
	const speed = Math.hypot(velocity.x, velocity.y);
	const effort = clamp((speed - 30) / 900, 0, 1);
	const targetAngle = clamp(velocity.x * 0.026, -27, 27);
	const angle = previousAngle + (targetAngle - previousAngle) * (1 - Math.exp(-dt * (9 + 9 * effort)));
	const nextPhase = (phase + dt * (4 + 15 * effort)) % 8;
	return {
		angle,
		phase: nextPhase,
		frame: speed < 30 ? 0 : Math.floor(nextPhase),
		stretch: 1 + clamp(-velocity.y / 9500, -0.11, 0.11),
		settled: speed < 30 && Math.abs(angle) < 0.2,
	};
}

export function crossesLedge<T extends LedgeBounds>(
	edges: readonly T[],
	from: Point,
	to: Point,
	size: number,
): { edge: T; x: number } | undefined {
	const fall = to.y - from.y;
	if (fall < 0) return;
	let contact: { edge: T; x: number } | undefined;
	for (const edge of edges) {
		const gap = edge.top - (from.y + size);
		if (gap < -0.1 || gap > fall) continue;
		const x = from.x + (to.x - from.x) * (fall ? Math.max(0, gap) / fall : 0);
		// The empty padding on either side of the sprite doesn't support its feet.
		if (x + size * 0.74 <= edge.left || x + size * 0.26 >= edge.right) continue;
		if (!contact || edge.top < contact.edge.top) contact = { edge, x };
	}
	return contact;
}
