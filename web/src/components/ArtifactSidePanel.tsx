import { useCallback, useEffect, useRef, useState } from "react";
import { ArtifactViewer } from "./ArtifactViewer";
import { KeatingStorage } from "../keating/storage";

interface ArtifactSidePanelProps {
	open: boolean;
	artifactId?: string;
	onClose: () => void;
}

const artifactStorage = new KeatingStorage();

const MIN_WIDTH = 288;
const MAX_WIDTH = 960;
const DEFAULT_WIDTH = 480;
const STORAGE_KEY = "keating_artifact_panel_width";

function loadSavedWidth(): number {
	if (typeof localStorage === "undefined") return DEFAULT_WIDTH;
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return DEFAULT_WIDTH;
		const parsed = parseInt(raw, 10);
		if (isNaN(parsed) || parsed < MIN_WIDTH || parsed > MAX_WIDTH) return DEFAULT_WIDTH;
		return parsed;
	} catch {
		return DEFAULT_WIDTH;
	}
}

function saveWidth(value: number) {
	try {
		localStorage.setItem(STORAGE_KEY, String(value));
	} catch {
		/* noop */
	}
}

export function ArtifactSidePanel({ open, artifactId, onClose }: ArtifactSidePanelProps) {
	const [width, setWidth] = useState(loadSavedWidth);
	const dragState = useRef({ active: false, startX: 0, startWidth: 0 });

	useEffect(() => {
		if (!open) return;
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [open, onClose]);

	const handleDragStart = useCallback((e: React.MouseEvent | React.TouchEvent) => {
		e.preventDefault();
		const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
		dragState.current = { active: true, startX: clientX, startWidth: width };

		const onMove = (moveEvent: MouseEvent | TouchEvent) => {
			if (!dragState.current.active) return;
			const moveX = "touches" in moveEvent ? moveEvent.touches[0].clientX : moveEvent.clientX;
			const delta = dragState.current.startX - moveX;
			const nextWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, dragState.current.startWidth + delta));
			setWidth(nextWidth);
		};

		const onUp = () => {
			if (!dragState.current.active) return;
			dragState.current.active = false;
			document.body.style.cursor = "";
			document.body.style.userSelect = "";
			window.removeEventListener("mousemove", onMove);
			window.removeEventListener("mouseup", onUp);
			window.removeEventListener("touchmove", onMove);
			window.removeEventListener("touchend", onUp);
			setWidth((w) => {
				saveWidth(w);
				return w;
			});
		};

		document.body.style.cursor = "col-resize";
		document.body.style.userSelect = "none";
		window.addEventListener("mousemove", onMove);
		window.addEventListener("mouseup", onUp);
		window.addEventListener("touchmove", onMove, { passive: false });
		window.addEventListener("touchend", onUp);
	}, [width]);

	return (
		<div className="relative flex h-full flex-col bg-background" style={{ width: `${width}px` }}>
			{/* Resize handle — left edge drag bar */}
			<div
				className="group absolute inset-y-0 left-0 z-10 flex w-2 cursor-col-resize items-center justify-center"
				onMouseDown={handleDragStart}
				onTouchStart={handleDragStart}
			>
				<div className="h-8 w-0.5 rounded-full bg-border opacity-0 transition-opacity group-hover:opacity-100 group-active:opacity-100" />
			</div>

			{open && (
				<div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
					<ArtifactViewer storage={artifactStorage} artifactId={artifactId} onClose={onClose} />
				</div>
			)}
		</div>
	);
}
