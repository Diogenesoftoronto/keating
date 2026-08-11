import { useCallback, useEffect, useState } from "react";

export interface CoursesAccount {
	id: string;
	displayName: string;
	mode: "development" | "local" | "hosted";
}

export type CoursesAccessState =
	| { status: "loading" }
	| { status: "unavailable"; error: string; recovery: "account" | "start-server" | "retry" }
	| { status: "ready"; account: CoursesAccount };

export function describeCourseAccessFailure(
	status: number,
	body: { statusMessage?: unknown; message?: unknown; error?: unknown; data?: { code?: unknown } },
): Extract<CoursesAccessState, { status: "unavailable" }> {
	const code = typeof body.data?.code === "string" ? body.data.code : undefined;
	if (code === "notorganic_auth_adapter_unavailable") {
		return {
			status: "unavailable",
			error: typeof body.statusMessage === "string" ? body.statusMessage : "Your hosted course account could not be verified.",
			recovery: "account",
		};
	}
	if (status === 404) {
		return {
			status: "unavailable",
			error: "The course API is not running. Start the full Keating web task, then retry.",
			recovery: "start-server",
		};
	}
	const message = [body.statusMessage, body.message, body.error].find((value): value is string => typeof value === "string" && value.trim().length > 0);
	return {
		status: "unavailable",
		error: message ?? "Your course workspace is unavailable.",
		recovery: "retry",
	};
}

export function useCoursesAccess(): [CoursesAccessState, () => void] {
	const [nonce, setNonce] = useState(0);
	const [state, setState] = useState<CoursesAccessState>({ status: "loading" });
	useEffect(() => {
		let cancelled = false;
		setState({ status: "loading" });
		fetch("/api/courses/session")
			.then(async (response) => {
				const body = await response.json().catch(() => ({}));
				if (!response.ok) {
					throw describeCourseAccessFailure(response.status, body);
				}
				return body.account as CoursesAccount;
			})
			.then((account) => {
				if (!cancelled) setState({ status: "ready", account });
			})
			.catch((error) => {
				if (!cancelled) setState(
					error?.status === "unavailable"
						? error as Extract<CoursesAccessState, { status: "unavailable" }>
						: { status: "unavailable", error: error instanceof Error ? error.message : "Your course workspace is unavailable.", recovery: "retry" },
				);
			});
		return () => {
			cancelled = true;
		};
	}, [nonce]);
	return [state, useCallback(() => setNonce((value) => value + 1), [])];
}
