import { useCallback, useRef, useState } from "react";
import type { SrsRating } from "../../keating/srs";

/** Distance (px) a card must travel before release commits a grade. */
export const SWIPE_DISTANCE_THRESHOLD = 100;
/** Flick velocity (px/ms) that commits a grade even under the distance threshold. */
export const SWIPE_VELOCITY_THRESHOLD = 0.65;
/** Minimum travel before a flick velocity is trusted (filters twitchy taps). */
const FLICK_MIN_DISTANCE = 24;

/**
 * Map a swipe vector to an SM-2 rating. Dominant axis wins:
 * left = Again (0), down = Hard (1), right = Good (2), up = Easy (3).
 * Returns null when the gesture doesn't commit (snap back).
 */
export function resolveSwipeGrade(
	dx: number,
	dy: number,
	vx: number,
	vy: number,
): SrsRating | null {
	const absX = Math.abs(dx);
	const absY = Math.abs(dy);
	const distance = Math.max(absX, absY);
	const velocity = Math.max(Math.abs(vx), Math.abs(vy));
	const committed =
		distance >= SWIPE_DISTANCE_THRESHOLD ||
		(distance >= FLICK_MIN_DISTANCE && velocity >= SWIPE_VELOCITY_THRESHOLD);
	if (!committed) return null;
	if (absX >= absY) return dx < 0 ? 0 : 2;
	return dy < 0 ? 3 : 1;
}

/** The grade a drag is currently heading toward (for the preview badge). */
export function previewSwipeGrade(dx: number, dy: number): SrsRating | null {
	const absX = Math.abs(dx);
	const absY = Math.abs(dy);
	if (Math.max(absX, absY) < FLICK_MIN_DISTANCE) return null;
	if (absX >= absY) return dx < 0 ? 0 : 2;
	return dy < 0 ? 3 : 1;
}

export interface CardDragState {
	dragging: boolean;
	dx: number;
	dy: number;
	/** 0..1 progress toward the commit threshold. */
	progress: number;
	/** Grade the drag is heading toward, for the preview badge. */
	previewGrade: SrsRating | null;
}

const IDLE_DRAG: CardDragState = {
	dragging: false,
	dx: 0,
	dy: 0,
	progress: 0,
	previewGrade: null,
};

export interface UseCardGesturesOptions {
	/** Swiping only grades once the card is revealed. */
	enabled: boolean;
	onGrade: (rating: SrsRating) => void;
	/** Fired for drags that end below the commit threshold with ~no movement (treat as tap). */
	onTap?: () => void;
}

/**
 * Pointer-event drag hook for swipe-to-grade. Attach the returned handlers to
 * the card element. Keeps a live drag transform in state; on release either
 * commits a grade (dominant-axis mapping) or snaps back.
 */
export function useCardGestures({ enabled, onGrade, onTap }: UseCardGesturesOptions) {
	const [drag, setDrag] = useState<CardDragState>(IDLE_DRAG);
	const originRef = useRef<{ x: number; y: number; t: number; id: number } | null>(null);
	const lastRef = useRef<{ x: number; y: number; t: number }>({ x: 0, y: 0, t: 0 });
	const movedRef = useRef(false);

	const reset = useCallback(() => {
		originRef.current = null;
		setDrag(IDLE_DRAG);
	}, []);

	const onPointerDown = useCallback(
		(e: React.PointerEvent<HTMLElement>) => {
			// Ignore secondary buttons and multi-touch.
			if (e.button !== 0 || originRef.current) return;
			originRef.current = { x: e.clientX, y: e.clientY, t: e.timeStamp, id: e.pointerId };
			lastRef.current = { x: e.clientX, y: e.clientY, t: e.timeStamp };
			movedRef.current = false;
			e.currentTarget.setPointerCapture(e.pointerId);
		},
		[],
	);

	const onPointerMove = useCallback(
		(e: React.PointerEvent<HTMLElement>) => {
			const origin = originRef.current;
			if (!origin || origin.id !== e.pointerId) return;
			const dx = e.clientX - origin.x;
			const dy = e.clientY - origin.y;
			lastRef.current = { x: e.clientX, y: e.clientY, t: e.timeStamp };
			if (Math.max(Math.abs(dx), Math.abs(dy)) > 6) movedRef.current = true;
			if (!enabled) return;
			setDrag({
				dragging: true,
				dx,
				dy,
				progress: Math.min(1, Math.max(Math.abs(dx), Math.abs(dy)) / SWIPE_DISTANCE_THRESHOLD),
				previewGrade: previewSwipeGrade(dx, dy),
			});
		},
		[enabled],
	);

	const onPointerUp = useCallback(
		(e: React.PointerEvent<HTMLElement>) => {
			const origin = originRef.current;
			if (!origin || origin.id !== e.pointerId) return;
			const dx = e.clientX - origin.x;
			const dy = e.clientY - origin.y;
			const dt = Math.max(1, e.timeStamp - origin.t);
			const vx = dx / dt;
			const vy = dy / dt;
			const wasTap = !movedRef.current;
			reset();
			if (wasTap) {
				onTap?.();
				return;
			}
			if (!enabled) return;
			const grade = resolveSwipeGrade(dx, dy, vx, vy);
			if (grade !== null) onGrade(grade);
		},
		[enabled, onGrade, onTap, reset],
	);

	const onPointerCancel = useCallback(() => reset(), [reset]);

	return {
		drag,
		handlers: {
			onPointerDown,
			onPointerMove,
			onPointerUp,
			onPointerCancel,
		},
	};
}
