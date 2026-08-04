import { useEffect, useRef, useState } from "react";
import type { CourseRealtimeMessage, CourseViewerSnapshot } from "./contracts";

export interface CourseRealtimeState {
	status: "connected" | "reconnecting" | "offline";
	presentAccountIds: string[];
}

export function useCourseRealtime(
	courseId: string | null,
	onSnapshot: (snapshot: CourseViewerSnapshot) => void,
	onCourseUpdated: () => void,
): CourseRealtimeState {
	const [status, setStatus] = useState<CourseRealtimeState["status"]>("offline");
	const [presentAccountIds, setPresentAccountIds] = useState<string[]>([]);
	const snapshotRef = useRef(onSnapshot);
	const updatedRef = useRef(onCourseUpdated);
	snapshotRef.current = onSnapshot;
	updatedRef.current = onCourseUpdated;

	useEffect(() => {
		if (!courseId) return;
		let socket: WebSocket | null = null;
		let retryTimer: number | undefined;
		let stopped = false;
		let retries = 0;

		const connect = () => {
			if (stopped) return;
			setStatus(retries === 0 ? "offline" : "reconnecting");
			const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
			socket = new WebSocket(`${protocol}//${window.location.host}/api/courses/realtime?courseId=${encodeURIComponent(courseId)}`);
			socket.addEventListener("open", () => {
				retries = 0;
				setStatus("connected");
			});
			socket.addEventListener("message", (event) => {
				if (event.data === "pong") return;
				try {
					const message = JSON.parse(String(event.data)) as CourseRealtimeMessage;
					if (message.type === "snapshot") snapshotRef.current(message.snapshot);
					if (message.type === "course.updated") updatedRef.current();
					if (message.type === "presence") setPresentAccountIds(message.accountIds);
					if (message.type === "gateway.status") setStatus(message.status);
				} catch {
					// Ignore non-contract messages from proxies and stale deployments.
				}
			});
			socket.addEventListener("close", () => {
				if (stopped) return;
				setStatus("reconnecting");
				retries += 1;
				retryTimer = window.setTimeout(connect, Math.min(1_000 * 2 ** retries, 15_000));
			});
			socket.addEventListener("error", () => socket?.close());
		};

		connect();
		return () => {
			stopped = true;
			if (retryTimer !== undefined) window.clearTimeout(retryTimer);
			socket?.close();
		};
	}, [courseId]);

	return { status, presentAccountIds };
}
