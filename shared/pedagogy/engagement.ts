import type { EngagementPolicy } from "./types.js";

export const DEFAULT_ENGAGEMENT_POLICY: EngagementPolicy = {
  name: "spaced-revisit-default",
  retentionHalfLifeDays: 7,
  dueThreshold: 0.5,
  minReviewIntervalDays: 1,
  urgencyTiers: [21, 14, 7, 3],
};

export function formatDaysAgo(days: number): string {
  if (days < 1) return "today";
  if (days < 2) return "1 day ago";
  if (days < 7) return `${Math.floor(days)} days ago`;
  if (days < 14) return "1 week ago";
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 60) return "1 month ago";
  return `${Math.floor(days / 30)} months ago`;
}
