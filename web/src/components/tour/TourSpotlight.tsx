import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
	INTERFACE_TOUR_STEPS,
	type InterfaceTourStep,
	type TourRect,
	markInterfaceTour,
	readInterfaceTourStep,
	tourCardPlacement,
	visibleTourSteps,
} from "../../keating/interface-tour";
import { useOnboardingAnalytics } from "../../lib/onboarding-analytics";
import "./tour-spotlight.css";

export interface TourSpotlightProps {
	steps?: readonly InterfaceTourStep[];
	onFinish: () => void;
	onSkip: () => void;
	initialStep?: number;
	/** Test and story seam; defaults to a document query. */
	resolveAnchor?: (selector: string) => Element | null;
}

const FALLBACK_CARD = { width: 320, height: 190 };

function defaultResolveAnchor(selector: string): Element | null {
	if (typeof document === "undefined") return null;
	try {
		return document.querySelector(selector);
	} catch {
		return null;
	}
}

function prefersReducedMotion(): boolean {
	if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
	try {
		return window.matchMedia("(prefers-reduced-motion: reduce)").matches
			|| document.documentElement.getAttribute("data-reduce-motion") === "true";
	} catch {
		return false;
	}
}

/**
 * Points at the real interface rather than describing it. Steps whose anchor is
 * missing are dropped, and if nothing at all can be pointed at the card simply
 * centres itself so the guidance still reaches the learner.
 */
export function TourSpotlight({
	steps = INTERFACE_TOUR_STEPS,
	onFinish,
	onSkip,
	initialStep,
	resolveAnchor = defaultResolveAnchor,
}: TourSpotlightProps) {
	const present = useMemo(
		() => visibleTourSteps(steps, (anchor) => resolveAnchor(anchor) !== null),
		[steps, resolveAnchor],
	);
	const total = present.length;
	const [index, setIndex] = useState(() => {
		const start = initialStep ?? readInterfaceTourStep(undefined, Math.max(total, 1));
		return total === 0 ? 0 : Math.min(Math.max(start, 0), total - 1);
	});
	const [rect, setRect] = useState<TourRect | null>(null);
	const [cardSize, setCardSize] = useState(FALLBACK_CARD);
	const card = useRef<HTMLDivElement>(null);
	const heading = useRef<HTMLHeadingElement>(null);
	const finished = useRef(false);
	const step = present[index];
	const track = useOnboardingAnalytics();
	const started = useRef(false);

	useEffect(() => {
		if (started.current || total === 0) return;
		started.current = true;
		track("interface_tour_started", { steps_visible: total });
	}, [total, track]);

	const measure = useCallback(() => {
		if (!step) {
			setRect(null);
			return;
		}
		const element = resolveAnchor(step.anchor);
		if (!element) {
			setRect(null);
			return;
		}
		const box = element.getBoundingClientRect();
		setRect({ top: box.top, left: box.left, width: box.width, height: box.height });
	}, [resolveAnchor, step]);

	// Bring the anchor into view, then measure where it landed.
	useEffect(() => {
		if (!step) return;
		const element = resolveAnchor(step.anchor);
		if (element && typeof element.scrollIntoView === "function") {
			element.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
		}
		measure();
		heading.current?.focus({ preventScroll: true });
	}, [measure, resolveAnchor, step]);

	// The anchor moves with layout, scrolling and window size.
	useEffect(() => {
		if (typeof window === "undefined") return;
		const update = () => measure();
		window.addEventListener("resize", update, { passive: true });
		window.addEventListener("scroll", update, { passive: true, capture: true });
		return () => {
			window.removeEventListener("resize", update);
			window.removeEventListener("scroll", update, { capture: true } as EventListenerOptions);
		};
	}, [measure]);

	useLayoutEffect(() => {
		const box = card.current?.getBoundingClientRect();
		if (!box) return;
		// Guard the feedback loop: only react to a real size change.
		if (Math.abs(box.width - cardSize.width) < 2 && Math.abs(box.height - cardSize.height) < 2) return;
		setCardSize({ width: box.width, height: box.height });
	}, [cardSize.height, cardSize.width, index, step]);

	const settle = useCallback((outcome: "completed" | "skipped") => {
		if (finished.current) return;
		finished.current = true;
		markInterfaceTour(outcome, undefined, outcome === "completed" ? Math.max(total - 1, 0) : index);
		track(outcome === "completed" ? "interface_tour_completed" : "interface_tour_skipped", {
			step_index: index,
			steps_visible: total,
		});
		(outcome === "completed" ? onFinish : onSkip)();
	}, [index, onFinish, onSkip, total, track]);

	const goTo = useCallback((next: number) => {
		if (finished.current) return;
		if (next >= total) {
			settle("completed");
			return;
		}
		const clamped = Math.min(Math.max(next, 0), Math.max(total - 1, 0));
		markInterfaceTour("in-progress", undefined, clamped);
		setIndex(clamped);
	}, [settle, total]);

	// Nothing on screen to point at and nothing to say: leave rather than trap.
	useEffect(() => {
		if (total === 0 && !finished.current) {
			finished.current = true;
			markInterfaceTour("completed", undefined, 0);
			onFinish();
		}
	}, [onFinish, total]);

	if (!step) return null;

	const viewport = {
		width: typeof window === "undefined" ? 1024 : window.innerWidth,
		height: typeof window === "undefined" ? 768 : window.innerHeight,
	};
	const placement = rect
		? tourCardPlacement({ anchor: rect, viewport, card: cardSize })
		: {
			top: Math.max(12, viewport.height / 2 - cardSize.height / 2),
			left: Math.max(12, viewport.width / 2 - cardSize.width / 2),
			placement: "below" as const,
		};

	return (
		<div className="tour-spotlight">
			{rect && (
				<div
					className="tour-spotlight__ring"
					aria-hidden="true"
					style={{ top: rect.top - 4, left: rect.left - 4, width: rect.width + 8, height: rect.height + 8 }}
				/>
			)}
			<div
				ref={card}
				className="tour-spotlight__card"
				role="dialog"
				aria-modal="false"
				aria-labelledby="tour-spotlight-title"
				aria-describedby="tour-spotlight-body"
				data-placement={placement.placement}
				style={{ top: placement.top, left: placement.left }}
				onKeyDown={(event) => {
					if (event.key === "Escape") { event.preventDefault(); settle("skipped"); }
					if (event.key === "ArrowRight") { event.preventDefault(); goTo(index + 1); }
					if (event.key === "ArrowLeft") { event.preventDefault(); goTo(index - 1); }
				}}
			>
				<p className="tour-spotlight__progress">{index + 1} of {total}</p>
				<h2 id="tour-spotlight-title" ref={heading} tabIndex={-1}>{step.title}</h2>
				<p id="tour-spotlight-body">{step.body}</p>
				<div className="tour-spotlight__actions">
					<button type="button" className="tour-spotlight__skip" onClick={() => settle("skipped")}>Skip tour</button>
					<div className="tour-spotlight__advance">
						{index > 0 && <button type="button" className="tour-spotlight__secondary" onClick={() => goTo(index - 1)}>Back</button>}
						<button type="button" className="tour-spotlight__primary" onClick={() => goTo(index + 1)}>
							{index === total - 1 ? "Done" : "Next"}
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
