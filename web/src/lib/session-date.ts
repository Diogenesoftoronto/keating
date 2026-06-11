export type TodayDateLabel = "today" | "time";
export type RecentDateStyle = "short" | "long";

export function formatRelativeSessionDate(
	isoString: string,
	options: { today?: TodayDateLabel; recent?: RecentDateStyle } = {},
) {
	const date = new Date(isoString);
	const now = new Date();
	const days = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
	if (days === 0) {
		return options.today === "time"
			? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
			: "Today";
	}
	if (days === 1) return "Yesterday";
	if (days < 7) {
		return options.recent === "long" ? `${days} days ago` : `${days}d ago`;
	}
	return date.toLocaleDateString();
}
