import { useEffect, useRef } from "react";
import { useMotionAllowed } from "../../design-system/motion";

export type FaceProgram =
	| "face"
	| "dots"
	| "wave"
	| "search"
	| "timer"
	| "progress"
	| "check"
	| "question"
	| "heart"
	| "k"
	| "pong";
type Blank = "blank-idle" | "blank-sitting";
const rectangles = {
	"blank-idle": [
		[100, 52, 67, 51],
		[101, 52, 66, 50],
		[100, 52, 67, 51],
		[100, 54, 67, 51],
		[100, 52, 67, 51],
		[102, 51, 69, 53],
		[101, 52, 67, 51],
		[102, 52, 66, 51],
	],
	"blank-sitting": [
		[95, 55, 64, 52],
		[95, 55, 64, 52],
		[95, 55, 64, 52],
		[96, 55, 64, 52],
		[95, 55, 64, 52],
		[95, 55, 63, 52],
		[96, 55, 63, 52],
		[96, 55, 63, 52],
	],
} as const;
export function faceRectangle(state: Blank, frame: number, size = 100) {
	const [x, y, w, h] = rectangles[state][Math.max(0, Math.min(7, Math.floor(frame) || 0))];
	const scale = size / 256;
	return { left: (x - 5) * scale, top: (y - 5) * scale, width: (w + 10) * scale, height: (h + 10) * scale };
}

const font: Record<string, string> = {
	"0": "111101101101111",
	"1": "010110010010010",
	"2": "111001111100111",
	"3": "111001111001111",
	"4": "101101111001001",
	"5": "111100111001111",
	"6": "111100111101111",
	"7": "111001001001001",
	"8": "111101111101111",
	"9": "111101111001111",
	":": "000010000010000",
	"%": "101001010100101",
	"?": "111001011000010",
	K: "101101110101101",
};

function paint(
	c: CanvasRenderingContext2D,
	program: FaceProgram,
	t: number,
	gx: number,
	gy: number,
	near: boolean,
	watching: boolean,
	game: { x: number; y: number; vx: number; vy: number; p: number; score: number },
	dt: number,
) {
	c.clearRect(0, 0, 32, 24);
	c.fillStyle = "#0d1b14";
	const dot = (x: number, y: number, w = 1, h = 1) => c.fillRect(Math.round(x), Math.round(y), w, h);
	const text = (word: string, x: number, y: number) => {
		for (const letter of word) {
			[...(font[letter] ?? "")].forEach((v, i) => {
				if (v === "1") dot(x + (i % 3), y + Math.floor(i / 3));
			});
			x += 4;
		}
	};
	switch (program) {
		case "face": {
			for (const x of [9 + gx, 20 + gx]) {
				if (t % 3.9 < 0.13) dot(x, 10 + gy, 3);
				else if (near) {
					dot(x - 1, 7 + gy, 5, 6);
					c.clearRect(x, 8 + gy, 3, 4);
					dot(x + 1, 9 + gy, 1, 2);
				} else dot(x, 8 + gy, 3, 4);
			}
			const x = 12 + Math.round(gx / 2),
				y = 15 + Math.round(gy / 2);
			if (near) {
				dot(x + 3, y, 3, 3);
				c.clearRect(x + 4, y + 1, 1, 1);
			} else if (watching) dot(x + 2, y + 1, 5);
			else {
				dot(x, y);
				dot(x + 1, y + 1);
				dot(x + 2, y + 2, 5);
				dot(x + 7, y + 1);
				dot(x + 8, y);
			}
			break;
		}
		case "dots":
			for (let i = 0; i < 3; i++) dot(8 + i * 7, 11 - Math.max(0, Math.sin(t * 5 - i * 0.9)) * 4, 3, 3);
			break;
		case "wave":
			for (let i = 0; i < 9; i++) {
				const h = Math.round(2 + Math.abs(Math.sin(t * 6 + i * 1.1) * Math.sin(t * 1.7 + i)) * 14);
				dot(3 + i * 3, 12 - h / 2, 2, h);
			}
			break;
		case "search": {
			const x = 10 + Math.sin(t * 2.2) * 5,
				y = 7 + Math.cos(t * 1.6) * 2;
			dot(x + 1, y, 4);
			dot(x, y + 1, 1, 4);
			dot(x + 5, y + 1, 1, 4);
			dot(x + 1, y + 5, 4);
			dot(x + 5, y + 5);
			dot(x + 6, y + 6, 2, 2);
			break;
		}
		case "timer": {
			const left = 299 - (Math.floor(t) % 300);
			text("0" + Math.floor(left / 60) + ":" + String(left % 60).padStart(2, "0"), 6, 7);
			dot(4, 16, Math.round((24 * left) / 299), 2);
			break;
		}
		case "progress": {
			const pct = Math.floor(t * 9) % 101;
			text(pct + "%", 9, 6);
			dot(5, 15, 22);
			dot(5, 18, 22);
			dot(5, 16, 1, 2);
			dot(26, 16, 1, 2);
			dot(6, 16, Math.round(pct / 5), 2);
			break;
		}
		case "check":
			for (let i = 0; i < Math.min(11, (t % 2.2) * 14); i++) dot(9 + i, i < 4 ? 12 + i : 18 - i, 2, 2);
			break;
		case "question":
			if (Math.floor(t * 1.6) % 2 === 0) text("?", 14, 8);
			break;
		case "heart":
			["0110110", "1111111", "1111111", "0111110", "0011100", "0001000"].forEach((row, y) =>
				[...row].forEach((v, x) => {
					if (v === "1") dot(9 + x * 2, 6 + y * 2, 2, (t * 2) % 1 < 0.5 ? 2 : 3);
				}),
			);
			break;
		case "k":
			text("K", 11, 6);
			if ("11101011100000"[Math.floor(t * 5) % 14] === "1") dot(17, 9, 3, 2);
			dot(8, 15, 16);
			break;
		case "pong":
			game.x += game.vx * dt;
			game.y += game.vy * dt;
			if (game.x < 1 || game.x > 30) game.vx = game.x < 1 ? 9 : -9;
			if (game.y < 1) game.vy = 7;
			if (game.y > 20 && game.vy > 0 && Math.abs(game.x - game.p) < 5) {
				game.vy = -7;
				game.score++;
			}
			if (game.y > 23) {
				game.y = 4;
				game.score = 0;
			}
			dot(game.x - 1, game.y - 1, 2, 2);
			dot(game.p - 4, 21, 8);
			text(String(game.score % 100), 1, 1);
			break;
	}
}

export function PixelScreen({
	state,
	program,
	active,
	frame,
}: {
	state: Blank;
	program: FaceProgram;
	active: boolean;
	frame?: number;
}) {
	const canvas = useRef<HTMLCanvasElement>(null);
	const motion = useMotionAllowed();
	useEffect(() => {
		const el = canvas.current!;
		const body = el.parentElement!;
		const sprite = el.previousElementSibling as HTMLElement;
		const c = el.getContext("2d");
		if (!c) return;
		const chat = el.closest(".chat-mascot-perch")?.parentElement?.parentElement;
		let raf = 0,
			elapsed = 0,
			previous = 0,
			inside = !chat,
			lastActive = performance.now(),
			caretUntil = 0;
		let pointer: { x: number; y: number } | undefined;
		let caret: { x: number; y: number } | undefined;
		const game = { x: 16, y: 6, vx: 9, vy: 7, p: 16, score: 0 };
		function draw(now: number) {
			raf = 0;
			const dt = previous ? Math.min(0.05, (now - previous) / 1000) : 0;
			previous = now;
			if (active && motion) elapsed += dt;
			const f =
				frame === undefined ? Math.floor(elapsed * 4) % 8 : Math.min(7, Math.max(0, Math.floor(frame) || 0));
			sprite.style.backgroundPosition = `${((f % 4) / 3) * 100}% ${Math.floor(f / 4) * 100}%`;
			const box = faceRectangle(state, f);
			for (const [key, value] of Object.entries(box)) el.style.setProperty(key, value + "%");
			const watching = now < caretUntil,
				point = watching ? caret : pointer,
				rect = body.getBoundingClientRect();
			const dx = point ? point.x - rect.left - rect.width / 2 : 0,
				dy = point ? point.y - rect.top - rect.height * 0.32 : 0,
				dist = Math.hypot(dx, dy);
			if (program === "pong" && point) {
				const glass = el.getBoundingClientRect();
				game.p = Math.max(4, Math.min(28, ((point.x - glass.left) / glass.width) * 32));
			}
			paint(
				c!,
				program,
				0.2 + elapsed,
				Math.round((3 * dx) / Math.max(90, dist)),
				Math.round((2 * dy) / Math.max(90, dist)),
				!!point && !watching && dist < 46,
				watching,
				game,
				dt,
			);
			if (active && motion && !document.hidden && (inside || now - lastActive < 3000))
				raf = requestAnimationFrame(draw);
		}
		function wake() {
			if (active && motion && !raf && !document.hidden) {
				previous = 0;
				raf = requestAnimationFrame(draw);
			}
		}
		function move(event: PointerEvent) {
			pointer = { x: event.clientX, y: event.clientY };
			const over = !chat || chat.contains(event.target as Node);
			if (inside || over) lastActive = performance.now();
			inside = over;
			if (over) wake();
		}
		function input(event: Event) {
			const field = event.target;
			if (
				!(field instanceof HTMLTextAreaElement) ||
				!field.closest(".composer-root") ||
				!chat?.contains(field)
			)
				return;
			const r = field.getBoundingClientRect();
			const line = field.value.slice(0, field.selectionStart).split("\n").at(-1) ?? "";
			caret = { x: r.left + Math.min(r.width - 12, 12 + line.length * 7), y: r.top + 14 };
			caretUntil = performance.now() + 1400;
			lastActive = performance.now();
			wake();
		}
		const leave = () => {
			inside = false;
			lastActive = performance.now();
		};
		draw(performance.now());
		if (active && motion) {
			window.addEventListener("pointermove", move, { passive: true });
			document.documentElement.addEventListener("pointerleave", leave);
			document.addEventListener("input", input);
		}
		return () => {
			cancelAnimationFrame(raf);
			window.removeEventListener("pointermove", move);
			document.documentElement.removeEventListener("pointerleave", leave);
			document.removeEventListener("input", input);
		};
	}, [state, program, frame, active, motion]);
	return <canvas className="keating-bot__screen" ref={canvas} width={32} height={24} aria-hidden="true" />;
}
