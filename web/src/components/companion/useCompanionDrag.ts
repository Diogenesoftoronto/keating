import { useEffect, useRef, useState, type RefObject } from "react";
import type { KeatingBotState } from "../KeatingBot";
import { keatingBotFramePosition, preloadCompanionDragSprites } from "../KeatingBot";
import { activityTarget, activityTargetSelector, isActivityDrop, ledgeSelector, resolveDropTarget, targetLabels, type DropTarget } from "./drop-targets";
import { clamp, crossesLedge, dragVelocity, heldMotion, releaseVelocity, type LedgeBounds, type Point } from "./drag-physics";

import { crossesSide, findSurfaceContact, releasingAway, surfacePose, type SurfaceContact } from "./surface-contact";

type Ledge = LedgeBounds & { el: HTMLElement | null };
const snackDistance = 2000;

export function useCompanionDrag(
	trigger: RefObject<HTMLButtonElement | null>,
	enabled: boolean,
	motion: boolean,
	onDrop: (target: DropTarget) => void,
	onGrab: () => void,
) {
	const [pose, setPose] = useState<KeatingBotState | null>(null);
	const [hungry, setHungry] = useState(false);
	const suppressClick = useRef(false),
		home = useRef<() => void>(() => {}),
		clear = useRef<() => void>(() => {}),
		perch = useRef<(target: DropTarget) => void>(() => {});
	const callbacks = useRef({ onDrop, onGrab });
	callbacks.current = { onDrop, onGrab };
	useEffect(() => {
		const bot = trigger.current,
			anchor = bot?.parentElement,
			chat = anchor?.parentElement?.parentElement;
		if (!bot || !anchor || !chat || !enabled) {
			setPose(null);
			setHungry(false);
			return;
		}
		const node = bot, viewport = chat, footer = anchor.parentElement;
		const rect = node.getBoundingClientRect(),
			size = rect.width;
		let drag: {
			id: number;
			start: Point;
			last: Point;
			offset: Point;
			time: number;
			velocity: Point;
			distance: number;
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
		let distanceSinceSnack = 0;
		let reactingSurface: HTMLElement | undefined;
		let gripFrame = 0;
		let refreshGrip: (() => void) | undefined;
		let attached: SurfaceContact | undefined;
		let heldFrame = 0, lastFrameTime = 0, spriteFrame = -1, angle = 0, phase = 0;
		const controller = new AbortController(),
			options = { signal: controller.signal };
		const homePoint = () => {
			const r = anchor.getBoundingClientRect();
			return { x: r.right, y: r.bottom - size };
		};
		const place = (p: Point) => {
			position = p;
			Object.assign(node.style, {
				position: "fixed",
				left: p.x + "px",
				top: p.y + "px",
				right: "auto",
				bottom: "auto",
				zIndex: "95",
			});
		};
		function renderHeld(time: number) {
			heldFrame = 0;
			if (!drag) return;
			const dt = clamp((time - lastFrameTime) / 1000, 0, 0.05);
			const next = heldMotion(angle, phase, releaseVelocity(drag.velocity, time - drag.time), dt);
			angle = next.angle;
			phase = next.phase;
			lastFrameTime = time;
			node.style.setProperty("--companion-held-angle", `${next.settled ? 0 : angle}deg`);
			node.style.setProperty("--companion-held-stretch", String(next.settled ? 1 : next.stretch));
			if (next.frame !== spriteFrame) {
				const frame = keatingBotFramePosition(next.frame);
				node.style.setProperty("--companion-held-x", frame.x);
				node.style.setProperty("--companion-held-y", frame.y);
				spriteFrame = next.frame;
			}
			if (!next.settled) heldFrame = window.requestAnimationFrame(renderHeld);
		}
		function stopHeld() {
			window.cancelAnimationFrame(heldFrame);
			heldFrame = lastFrameTime = angle = phase = 0;
			spriteFrame = -1;
			delete node.dataset.companionHeld;
			for (const property of ["angle", "stretch", "x", "y"]) node.style.removeProperty(`--companion-held-${property}`);
		}
		function mark(target: DropTarget | null, label = target && targetLabels[target.kind]) {
			if (hot?.el === target?.el && hot?.kind === target?.kind && (!target || target.el.dataset.companionDrop === label)) return;
			hot?.el.removeAttribute("data-companion-drop");
			hot = target;
			if (target && label) target.el.setAttribute("data-companion-drop", label);
		}
		function detach() {
			window.cancelAnimationFrame(gripFrame);
			gripFrame = 0;
			attached = undefined;
			refreshGrip = undefined;
			delete node.dataset.gripRest;
			delete node.dataset.grip;
		}
		function clearSurfaceReaction() {
			reactingSurface?.removeAttribute("data-companion-reaction");
			reactingSurface = undefined;
		}
		function cancel() {
			detach();
			clearSurfaceReaction();
			flight?.cancel();
			flight = undefined;
			window.clearTimeout(timer);
			mark(null);
		}
		function reset() {
			cancel();
			stopHeld();
			const held = drag;
			drag = null;
			if (held && node.hasPointerCapture(held.id)) node.releasePointerCapture(held.id);
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
		const playground = () => {
			const r = viewport.getBoundingClientRect();
			return {
				left: Math.max(0, r.left),
				right: Math.min(innerWidth, r.right),
				top: Math.max(0, r.top),
				bottom: Math.min(innerHeight, r.bottom),
			};
		};
		const ledges = (): Ledge[] =>
			[...viewport.querySelectorAll<HTMLElement>(ledgeSelector)]
				.sort((a, b) => Number(b.matches(activityTargetSelector)) - Number(a.matches(activityTargetSelector)))
				.flatMap((el) => {
					const edge = bounds(el);
					return edge ? [edge] : [];
				});
		function bounds(el: HTMLElement): Ledge | null {
			if (!el.isConnected || el.closest("[aria-busy=true]")) return null;
			const { top, left, right, height } = el.getBoundingClientRect();
			const area = playground();
			const footerTop = footer?.getBoundingClientRect().top ?? area.bottom;
			if (!height || top < area.top + size || top >= area.bottom || right <= area.left || left >= area.right) return null;
			if (!footer?.contains(el) && top >= footerTop) return null;
			return { el, top, left: Math.max(left, area.left), right: Math.min(right, area.right) };
		}
		function landOn(edge: Ledge, x: number) {
			const area = playground();
			const left = Math.max(area.left, edge.left - size * 0.64);
			const right = Math.min(area.right - size, edge.right - size * 0.36);
			const supportedX = clamp(x, left, right);
			const y = edge.top - size;
			const gutter = unobstructedX(supportedX, y);
			return { x: gutter >= left && gutter <= right && Math.abs(gutter - supportedX) < 32 ? gutter : supportedX, y };
		}
		function perform(target: DropTarget) {
			const reaction = surfacePose(target, distanceSinceSnack >= snackDistance);
			setPose(reaction);
			if (motion && reaction !== "ledge-sitting") {
				clearSurfaceReaction();
				reactingSurface = target.el;
				reactingSurface.dataset.companionReaction = reaction;
			}
			if (reaction === "tea-break") {
				distanceSinceSnack = 0;
				setHungry(false);
			}
			if (reaction !== "ledge-sitting") timer = window.setTimeout(() => {
				clearSurfaceReaction();
				setPose("ledge-sitting");
			}, 1700);
		}
		function restAt(target: DropTarget) {
			// The menu is an explicit destination. Pointer releases use body contact.
			if (!isActivityDrop(target.kind) || !viewport.contains(target.el)) return;
			if (!bounds(target.el)) target.el.scrollIntoView({ block: "center", behavior: "instant" });
			const edge = bounds(target.el);
			if (!edge) return;
			cancel();
			const start = position ?? homePoint();
			const end = landOn(edge, (edge.left + edge.right - size) / 2);
			setPose("falling");
			travel([start, end], 320, () => {
				perched = edge;
				reanchor();
				if (perched) perform(target);
			});
		}
		perch.current = restAt;

		function gripSurface(contact: SurfaceContact) {
			const { target, grip } = contact;
			if (!position) return;
			const start = position;
			if (grip === "top") {
				const edge = bounds(target.el);
				if (!edge) { fall(0, 0, false); return; }
				perched = edge;
				travel([start, landOn(edge, start.x)], 100, () => settle(null, false));
				return;
			}
			attached = contact;
			node.dataset.grip = grip;
			let box = target.el.getBoundingClientRect();
			const sideX = () => grip === "left" ? box.left - size * 0.83 : box.right - size * 0.17;
			const initialOffset = start.y - box.top;
			const handHeight = size * 0.4;
			const climbDistance = Math.max(0, initialOffset + handHeight);
			const started = performance.now();
			const undersideX = start.x - box.left;
			function follow(time: number) {
				if (attached !== contact) return;
				box = target.el.getBoundingClientRect();
				const area = playground();
				const visibleBottom = footer?.contains(target.el) ? area.bottom : footer?.getBoundingClientRect().top ?? area.bottom;
				if (!viewport.contains(target.el) || !box.height || box.bottom <= area.top ||
					box.top >= visibleBottom || box.right <= area.left || box.left >= area.right) {
					detach();
					fall(0, 0, false);
					return;
				}
				if (grip === "underside") {
					if (box.bottom > visibleBottom) { detach(); fall(0, 0, false); return; }
					place({ x: clamp(box.left + undersideX, area.left, area.right - size), y: clamp(box.bottom - size * 0.15, area.top, area.bottom - size) });
					if (time - started >= 950) { detach(); fall(0, 0, false); return; }
				} else {
					const elapsed = (time - started) / 1000;
					const climbed = motion ? Math.min(climbDistance, elapsed * 95) : 0;
					const y = box.top + initialOffset - climbed;
					place({ x: clamp(sideX(), area.left, area.right - size), y: clamp(y, area.top, area.bottom - size) });
					const support = box.top >= area.top + size && box.top < visibleBottom
						? { el: target.el, top: box.top, left: Math.max(box.left, area.left), right: Math.min(box.right, area.right) }
						: null;
					if (motion && !support && (y <= area.top || climbed >= climbDistance)) {
						node.dataset.gripRest = "true";
						return;
					}
					delete node.dataset.gripRest;
					if (motion && support && climbed >= climbDistance) {
						const x = grip === "left" ? box.left - size * 0.36 : box.right - size * 0.64;
						const end = landOn(support, x);
						const startLip = position!;
						detach();
						setPose("climbing");
						travel([startLip, { x: startLip.x, y: end.y + size * 0.16 }, end], 660, () => {
							perched = support;
							reanchor();
							if (perched) perform(target);
						});
						return;
					}
				}
				if (motion || grip === "underside") gripFrame = window.requestAnimationFrame(follow);
			}
			refreshGrip = () => {
				window.cancelAnimationFrame(gripFrame);
				follow(performance.now());
			};
			setPose(grip === "underside" ? "held" : "wall-climb");
			follow(started);
		}
		function settle(target: DropTarget | null, dizzy: boolean) {
			setPose("landing");
			function done() {
				if (target) {
					reset();
					if (target.el.isConnected) callbacks.current.onDrop(target);
				} else {
					const el = perched?.el;
					if (el?.matches(activityTargetSelector)) perform(activityTarget(el));
					else setPose("ledge-sitting");
					// A ledge in the conversation is a place to stay. The page floor is not:
					// it can sit over the session list, so he rests there briefly and hops home.
					if (!perched?.el) timer = window.setTimeout(() => home.current(), 8000);
				}
			}
			const landed = () => {
				if (motion && dizzy) {
					setPose("dizzy");
					timer = window.setTimeout(done, 1143);
				} else done();
			};
			timer = window.setTimeout(landed, motion ? 728 : 0);
		}
		function unobstructedX(x: number, y: number) {
			// A block edge may sit immediately below the previous paragraph. Keep
			// the same ledge height and move into the gutter if its text intersects.
			for (const message of viewport.querySelectorAll(".keating-bubble, [data-learning-message-ids]")) {
				const r = message.getBoundingClientRect();
				if (x < r.right && x + size > r.left && y < r.bottom && y + size > r.top) return homePoint().x;
			}
			return x;
		}
		function fall(vx: number, vy: number, dizzy: boolean) {
			const area = playground();
			const floor = { el: null, top: area.bottom, left: area.left, right: area.right };
			const edges = ledges();
			const points = [position!];
			let point = position!;
			if (!motion) {
				const contact = crossesLedge(edges, point, { x: point.x, y: floor.top - size }, size);
				perched = contact?.edge ?? floor;
				place(landOn(perched, point.x));
				settle(null, dizzy);
				return;
			}
			const faces = [...viewport.querySelectorAll<HTMLElement>(activityTargetSelector)]
				.filter(el => !el.closest("[aria-busy=true]"))
				.map(el => {
					const { left, right, top, bottom } = el.getBoundingClientRect();
					return { el, left, right, top, bottom };
				})
				.filter(r => r.right > r.left && r.bottom > area.top && r.top < area.bottom);
			// Precompute the flight so only an actively held sprite needs a frame loop.
			for (let i = 0; i < 240; i++) {
				vy += 2600 / 60;
				const next = { x: point.x + vx / 60, y: point.y + vy / 60 };
				const boundedX = clamp(next.x, area.left, area.right - size);
				if (boundedX !== next.x) {
					next.x = boundedX;
					vx *= -0.5;
				}
				if (next.y < area.top) {
					next.y = area.top;
					vy = Math.abs(vy) * 0.3;
				}
				let contact = crossesLedge(edges, point, next, size);
				const side = crossesSide(faces, point, next, size);
				if (side && (!contact || side.t * (next.y - point.y) < contact.edge.top - point.y - size)) {
					const probeX = next.x > point.x ? side.face.left + 1 : side.face.right - 1;
					const hit = document.elementsFromPoint(probeX, side.y).find(el => !el.closest(".chat-mascot-perch"));
					if (hit && side.face.el.contains(hit)) {
						next.x = side.x;
						vx *= -0.38;
						contact = crossesLedge(edges, point, next, size);
					}
				}
				if (contact || next.y >= floor.top - size) {
					perched = contact?.edge ?? floor;
					points.push(landOn(perched, contact?.x ?? next.x));
					break;
				}
				points.push(next);
				point = next;
			}
			setPose("falling");
			travel(points, ((points.length - 1) * 1000) / 60, () => {
				reanchor();
				if (perched) settle(null, dizzy);
			});
		}
		function over(e: PointerEvent) {
			return resolveDropTarget(document.elementsFromPoint(e.clientX, e.clientY), viewport);
		}
		function down(e: PointerEvent) {
			if (e.button !== 0 || !e.isPrimary || drag) return;
			const r = node.getBoundingClientRect(),
				pt = { x: e.clientX, y: e.clientY };
			drag = {
				id: e.pointerId,
				start: pt,
				last: pt,
				offset: { x: pt.x - r.left, y: pt.y - r.top },
				time: e.timeStamp,
				velocity: { x: 0, y: 0 },
				distance: 0,
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
				if (motion) node.dataset.companionHeld = "true";
				perched = null;
				drag.moved = true;
			}
			const dx = e.clientX - drag.last.x;
			const dy = e.clientY - drag.last.y;
			drag.velocity = dragVelocity(
				releaseVelocity(drag.velocity, e.timeStamp - drag.time),
				{ x: dx, y: dy },
				e.timeStamp - drag.time,
			);
			if (Math.abs(dx) > 3 && Math.sign(dx) !== drag.dir) {
				if (drag.dir) drag.flips++;
				drag.dir = Math.sign(dx);
			}
			const area = playground();
			const next = {
				x: clamp(e.clientX - drag.offset.x, area.left, area.right - size),
				y: clamp(e.clientY - drag.offset.y, area.top, area.bottom - size),
			};
			if (position) drag.distance += Math.hypot(next.x - position.x, next.y - position.y);
			place(next);
			const contact = findSurfaceContact(next, size, viewport);
			const semantic = over(e);
			if (contact) {
				const label = contact.grip === "top" ? targetLabels[contact.target.kind] : contact.grip === "underside" ? "Hang underneath" : "Climb here";
				mark(contact.target, label);
			} else mark(semantic && !isActivityDrop(semantic.kind) ? semantic : null);
			drag.last = { x: e.clientX, y: e.clientY };
			drag.time = e.timeStamp;
			if (motion && !heldFrame) {
				lastFrameTime = performance.now();
				heldFrame = window.requestAnimationFrame(renderHeld);
			}
		}
		function up(e: PointerEvent) {
			if (!drag || drag.id !== e.pointerId) return;
			const d = drag;
			drag = null;
			if (node.hasPointerCapture(e.pointerId)) node.releasePointerCapture(e.pointerId);
			if (!d.moved) return;
			suppressClick.current = true;
			stopHeld();
			distanceSinceSnack += d.distance;
			if (distanceSinceSnack >= snackDistance) setHungry(true);
			const target = over(e),
				dizzy = d.flips >= 6;
			mark(null);
			const velocity = releaseVelocity(d.velocity, e.timeStamp - d.time);
			const contact = position && findSurfaceContact(position, size, viewport);
			if (contact && !releasingAway(contact.grip, velocity)) {
				gripSurface(contact);
			} else if (target && !isActivityDrop(target.kind)) {
				hop(() => settle(target, dizzy));
			} else {
				fall(clamp(velocity.x, -1100, 1100), clamp(velocity.y, -1100, 900), dizzy);
			}
		}
		function reanchor() {
			if (attached) {
				refreshGrip?.();
				return;
			}
			if (!perched || !position || flight) return;
			const { left, right, bottom } = playground();
			const edge = perched.el ? bounds(perched.el) : { el: null, top: bottom, left, right };
			if (edge) {
				const x = position.x + edge.left - perched.left;
				perched = edge;
				place(landOn(edge, x));
			} else reset();
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
			perch.current = () => {};
		};
	}, [trigger, enabled, motion]);
	return { pose, hungry, suppressClick, home, clear, perch };
}
