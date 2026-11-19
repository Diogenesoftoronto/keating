import { useEffect, useRef, useState, type RefObject } from "react";
import type { KeatingBotState } from "../KeatingBot";
import { preloadCompanionDragSprites } from "../KeatingBot";
import { ledgeSelector, resolveDropTarget, targetLabels, type DropTarget } from "./drop-targets";
type Point = { x: number; y: number };
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(n, max));
type Ledge = { el: HTMLElement | null; top: number; left: number; right: number };

export function useCompanionDrag(
	trigger: RefObject<HTMLButtonElement | null>,
	enabled: boolean,
	motion: boolean,
	onDrop: (target: DropTarget) => void,
	onGrab: () => void,
) {
	const [pose, setPose] = useState<KeatingBotState | null>(null);
	const suppressClick = useRef(false),
		home = useRef<() => void>(() => {}),
		clear = useRef<() => void>(() => {});
	const callbacks = useRef({ onDrop, onGrab });
	callbacks.current = { onDrop, onGrab };
	useEffect(() => {
		const bot = trigger.current,
			anchor = bot?.parentElement,
			chat = anchor?.parentElement?.parentElement;
		if (!bot || !anchor || !chat || !enabled) {
			setPose(null);
			return;
		}
		const node = bot;
		const rect = node.getBoundingClientRect(),
			size = rect.width;
		let drag: {
			id: number;
			start: Point;
			last: Point;
			offset: Point;
			time: number;
			vx: number;
			vy: number;
			flips: number;
			dir: number;
			moved: boolean;
		} | null = null;
		let hot: DropTarget | null = null,
			flight: Animation | undefined,
			timer = 0;
		let perched: Ledge | null = null,
			position: Point | null = null,
			preloaded = false;
		const controller = new AbortController(),
			options = { signal: controller.signal };
		const homePoint = () => {
			const r = anchor.getBoundingClientRect();
			return { x: r.right, y: r.bottom - size };
		};
		const place = (p: Point, rotation = 0) => {
			position = p;
			Object.assign(node.style, {
				position: "fixed",
				left: p.x + "px",
				top: p.y + "px",
				right: "auto",
				bottom: "auto",
				transform: `rotate(${rotation}deg)`,
				zIndex: "95",
			});
		};
		function mark(target: DropTarget | null) {
			if (hot?.el === target?.el) return;
			hot?.el.removeAttribute("data-companion-drop");
			hot = target;
			if (target) target.el.setAttribute("data-companion-drop", targetLabels[target.kind]);
		}
		function cancel() {
			flight?.cancel();
			flight = undefined;
			window.clearTimeout(timer);
			mark(null);
		}
		function reset() {
			cancel();
			if (drag && node.hasPointerCapture(drag.id)) node.releasePointerCapture(drag.id);
			drag = null;
			perched = null;
			position = null;
			for (const key of ["position", "left", "top", "right", "bottom", "transform", "z-index"])
				node.style.removeProperty(key);
			setPose(null);
		}
		function travel(points: Point[], duration: number, finish: () => void) {
			const end = points[points.length - 1];
			place(end);
			if (!motion || !node.animate || document.hidden) {
				finish();
				return;
			}
			flight = node.animate(
				points.map((p) => ({ transform: `translate(${p.x - end.x}px,${p.y - end.y}px)` })),
				{ duration, easing: "linear" },
			);
			flight.onfinish = () => {
				flight = undefined;
				finish();
			};
		}
		function hop(finish: () => void) {
			const end = homePoint(),
				start = position ?? end;
			setPose("falling");
			const points = Array.from({ length: 21 }, (_, i) => {
				const t = i / 20;
				return {
					x: start.x + (end.x - start.x) * t,
					y: start.y + (end.y - start.y) * t - 4 * 110 * t * (1 - t),
				};
			});
			travel(points, 550, finish);
		}
		clear.current = reset;
		home.current = () => {
			if (!drag && (perched || position)) {
				cancel();
				hop(reset);
			}
		};
		const ledges = (): Ledge[] =>
			[...chat.querySelectorAll<HTMLElement>(ledgeSelector)]
				.map<Ledge>((el) => ({ el, ...bounds(el) }))
				.filter((l) => l.top > size && l.top < innerHeight)
				.concat([{ el: null, top: innerHeight - 2, left: 0, right: innerWidth } as Ledge]);
		function bounds(el: HTMLElement) {
			const { top, left, right } = el.getBoundingClientRect();
			return { top, left, right };
		}
		function settle(target: DropTarget | null, dizzy: boolean) {
			setPose("landing");
			function done() {
				if (target) {
					reset();
					if (target.el.isConnected) callbacks.current.onDrop(target);
				} else {
					setPose("ledge-sitting");
					// A ledge in the conversation is a place to stay. The page floor is not:
					// it can sit over the session list, so he rests there briefly and hops home.
					if (!perched?.el) timer = window.setTimeout(() => home.current(), 8000);
				}
			}
			const landed = () => {
				if (dizzy) {
					setPose("dizzy");
					timer = window.setTimeout(done, 1143);
				} else done();
			};
			timer = window.setTimeout(landed, motion ? 728 : 0);
		}
		function unobstructedX(x: number, y: number) {
			// A block edge may sit immediately below the previous paragraph. Keep
			// the same ledge height and move into the gutter if its text intersects.
			for (const message of chat!.querySelectorAll(".keating-bubble, [data-learning-message-ids]")) {
				const r = message.getBoundingClientRect();
				if (x < r.right && x + size > r.left && y < r.bottom && y + size > r.top) return homePoint().x;
			}
			return x;
		}
		function fall(vx: number, vy: number, dizzy: boolean) {
			const edges = ledges(),
				points = [position!];
			let { x, y } = position!;
			if (!motion) {
				perched =
					edges
						.filter(
							(edge) => x + size / 2 >= edge.left && x + size / 2 <= edge.right && edge.top >= y + size - 2,
						)
						.sort((a, b) => a.top - b.top)[0] ?? edges[edges.length - 1];
				y = perched.top - size;
				place({ x: unobstructedX(x, y), y });
				settle(null, dizzy);
				return;
			}
			// Sample the same gravity and damped wall bounce as the playground.
			// WAAPI plays the resulting flight without a second JS frame loop.
			for (let i = 0; i < 240; i++) {
				const old = y;
				vy += 2600 / 60;
				x += vx / 60;
				y += vy / 60;
				if (x < 0 || x > innerWidth - size) {
					x = clamp(x, 0, innerWidth - size);
					vx *= -0.5;
				}
				if (y < 0) {
					y = 0;
					vy = Math.abs(vy) * 0.3;
				}
				const edge = edges
					.filter(
						(l) =>
							x + size / 2 >= l.left &&
							x + size / 2 <= l.right &&
							l.top >= old + size - 2 &&
							l.top <= y + size,
					)
					.sort((a, b) => a.top - b.top)[0];
				if (edge || y >= innerHeight - size - 2) {
					perched = edge ?? edges[edges.length - 1];
					y = perched.top - size;
					x = unobstructedX(x, y);
					points.push({ x, y });
					break;
				}
				points.push({ x, y });
			}
			setPose("falling");
			travel(points, ((points.length - 1) * 1000) / 60, () => settle(null, dizzy));
		}
		function over(e: PointerEvent) {
			return resolveDropTarget(document.elementsFromPoint(e.clientX, e.clientY), chat!);
		}
		function down(e: PointerEvent) {
			if (e.button !== 0 || !e.isPrimary) return;
			const r = node.getBoundingClientRect(),
				pt = { x: e.clientX, y: e.clientY };
			drag = {
				id: e.pointerId,
				start: pt,
				last: pt,
				offset: { x: pt.x - r.left, y: pt.y - r.top },
				time: e.timeStamp,
				vx: 0,
				vy: 0,
				flips: 0,
				dir: 0,
				moved: false,
			};
			node.setPointerCapture(e.pointerId);
			suppressClick.current = false;
		}
		let rubX = 0,
			rubDir = 0,
			rubs = 0,
			rubTime = 0;
		function move(e: PointerEvent) {
			if (!drag) {
				if (position || e.buttons || node.dataset.resting !== "true") return;
				if (e.timeStamp - rubTime > 800) {
					rubs = 0;
					rubDir = 0;
				}
				const dx = e.clientX - rubX;
				if (Math.abs(dx) > 6 && e.clientY < node.getBoundingClientRect().top + size * 0.6) {
					if (Math.sign(dx) !== rubDir) {
						rubs++;
						rubDir = Math.sign(dx);
					}
					rubTime = e.timeStamp;
					rubX = e.clientX;
					if (rubs >= 5) {
						rubs = 0;
						setPose("petted");
						window.clearTimeout(timer);
						timer = window.setTimeout(() => setPose(null), 2000);
					}
				}
				return;
			}
			if (e.pointerId !== drag.id) return;
			if (!drag.moved && Math.hypot(e.clientX - drag.start.x, e.clientY - drag.start.y) <= 5) return;
			if (!drag.moved) {
				cancel();
				callbacks.current.onGrab();
				setPose("held");
				perched = null;
				drag.moved = true;
			}
			const dt = Math.max(0.004, (e.timeStamp - drag.time) / 1000),
				dx = e.clientX - drag.last.x;
			drag.vx = drag.vx * 0.6 + (dx / dt) * 0.4;
			drag.vy = drag.vy * 0.6 + ((e.clientY - drag.last.y) / dt) * 0.4;
			if (Math.abs(dx) > 3 && Math.sign(dx) !== drag.dir) {
				if (drag.dir) drag.flips++;
				drag.dir = Math.sign(dx);
			}
			place(
				{
					x: clamp(e.clientX - drag.offset.x, 0, innerWidth - size),
					y: clamp(e.clientY - drag.offset.y, 0, innerHeight - size),
				},
				motion ? clamp(drag.vx * 0.035, -30, 30) : 0,
			);
			mark(over(e));
			drag.last = { x: e.clientX, y: e.clientY };
			drag.time = e.timeStamp;
		}
		function up(e: PointerEvent) {
			if (!drag || drag.id !== e.pointerId) return;
			const d = drag;
			drag = null;
			if (node.hasPointerCapture(e.pointerId)) node.releasePointerCapture(e.pointerId);
			if (!d.moved) return;
			suppressClick.current = true;
			const target = over(e),
				dizzy = d.flips >= 6;
			mark(null);
			if (target) hop(() => settle(target, dizzy));
			else fall(motion ? clamp(d.vx, -1100, 1100) : 0, motion ? clamp(d.vy, -1100, 900) : 0, dizzy);
		}
		function reanchor() {
			if (!perched || !position || flight) return;
			if (perched.el && !perched.el.isConnected) {
				reset();
				return;
			}
			const top = perched.el?.getBoundingClientRect().top ?? innerHeight - 2;
			if (top < size || top > innerHeight) {
				reset();
				return;
			}
			place({ x: unobstructedX(clamp(position.x, 0, innerWidth - size), top - size), y: top - size });
		}
		node.addEventListener(
			"pointerover",
			() => {
				if (!preloaded) {
					preloaded = true;
					preloadCompanionDragSprites();
				}
			},
			options,
		);
		node.addEventListener("pointerdown", down, options);
		node.addEventListener("pointermove", move, options);
		node.addEventListener("pointerup", up, options);
		node.addEventListener("pointercancel", reset, options);
		node.addEventListener(
			"lostpointercapture",
			() => {
				if (drag) reset();
			},
			options,
		);
		window.addEventListener("resize", reanchor, options);
		window.addEventListener("scroll", reanchor, { ...options, capture: true });
		return () => {
			controller.abort();
			reset();
			home.current = () => {};
			clear.current = () => {};
		};
	}, [trigger, enabled, motion]);
	return { pose, suppressClick, home, clear };
}
