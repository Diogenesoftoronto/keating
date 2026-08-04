import { useCallback, useEffect, useState } from "react";
import { isNotOrganicFeatureEnabled } from "../notorganic-provider";

export interface CoursesAccount {
	id: string;
	displayName: string;
}

export type CoursesAccessState =
	| { status: "loading" }
	| { status: "disabled" }
	| { status: "signed-out"; error: string }
	| { status: "ready"; account: CoursesAccount };

export function useCoursesAccess(): [CoursesAccessState, () => void] {
	const [nonce, setNonce] = useState(0);
	const [state, setState] = useState<CoursesAccessState>({ status: "loading" });
	useEffect(() => {
		let cancelled = false;
		if (!isNotOrganicFeatureEnabled()) {
			setState({ status: "disabled" });
			return;
		}
		setState({ status: "loading" });
		fetch("/api/courses/session")
			.then(async (response) => {
				const body = await response.json().catch(() => ({}));
				if (!response.ok) throw new Error(body?.statusMessage ?? body?.message ?? "Your Not Organic session is unavailable.");
				return body.account as CoursesAccount;
			})
			.then((account) => {
				if (!cancelled) setState({ status: "ready", account });
			})
			.catch((error) => {
				if (!cancelled) setState({
					status: "signed-out",
					error: error instanceof Error ? error.message : "Your Not Organic session is unavailable.",
				});
			});
		return () => {
			cancelled = true;
		};
	}, [nonce]);
	return [state, useCallback(() => setNonce((value) => value + 1), [])];
}
