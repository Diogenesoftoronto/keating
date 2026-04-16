import { readFile, writeFile } from "node:fs/promises";

import {
  EngagementPolicy,
  EngagementTimeline,
  LearnerState,
  TopicEngagement
} from "./types.js";
import { mean } from "./util.js";
import { titleCase } from "./util.js";

export const DEFAULT_ENGAGEMENT_POLICY: EngagementPolicy = {
  name: "spaced-revisit-default",
  retentionHalfLifeDays: 7,
  dueThreshold: 0.5,
  minReviewIntervalDays: 1,
  urgencyTiers: [21, 14, 7, 3]
};

const MS_PER_DAY = 86_400_000;

function daysBetween(a: string | Date, b: string | Date): number {
  const msA = typeof a === "string" ? new Date(a).getTime() : a.getTime();
  const msB = typeof b === "string" ? new Date(b).getTime() : b.getTime();
  return Math.abs(msB - msA) / MS_PER_DAY;
}

/**
 * Estimate retention using an exponential decay model inspired by Ebbinghaus.
 * retention = mastery × e^(-t / (halfLife × masteryFactor))
 *
 * Higher mastery extends the half-life: a topic mastered at 0.9 decays
 * more slowly than one mastered at 0.3.
 */
function estimateRetention(
  masteryEstimate: number,
  daysSinceLastSeen: number,
  halfLifeDays: number
): number {
  const masteryFactor = 0.5 + masteryEstimate * 1.5; // range: 0.5–2.0
  const effectiveHalfLife = halfLifeDays * masteryFactor;
  const decay = Math.exp((-daysSinceLastSeen * Math.LN2) / effectiveHalfLife);
  return Math.max(0, Math.min(1, masteryEstimate * decay));
}

/**
 * Compute urgency: 0 = not urgent, 1 = critically overdue.
 * Based on how far retention has fallen below the due threshold.
 */
function computeUrgency(
  estimatedRetention: number,
  dueThreshold: number,
  daysSinceLastSeen: number,
  tiers: [number, number, number, number]
): { urgency: number; label: TopicEngagement["urgencyLabel"] } {
  if (daysSinceLastSeen < 1) {
    return { urgency: 0, label: "fresh" };
  }

  if (estimatedRetention >= dueThreshold) {
    return { urgency: Math.max(0, 1 - estimatedRetention / dueThreshold) * 0.3, label: "low" };
  }

  // Retention is below threshold — compute urgency based on how far below
  const deficit = dueThreshold - estimatedRetention;
  const rawUrgency = Math.min(1, deficit / dueThreshold + 0.3);

  let label: TopicEngagement["urgencyLabel"];
  if (daysSinceLastSeen >= tiers[0]) {
    label = "critical";
  } else if (daysSinceLastSeen >= tiers[1]) {
    label = "high";
  } else if (daysSinceLastSeen >= tiers[2]) {
    label = "moderate";
  } else {
    label = "low";
  }

  return { urgency: rawUrgency, label };
}

/**
 * Estimate when the next review should happen based on current mastery
 * and the retention decay model.
 */
function estimateNextReview(
  lastSeen: string,
  masteryEstimate: number,
  halfLifeDays: number,
  dueThreshold: number
): string {
  // Solve for t where retention = dueThreshold:
  // dueThreshold = mastery × e^(-t·ln2 / effectiveHalfLife)
  // t = -effectiveHalfLife × ln(dueThreshold / mastery) / ln2
  if (masteryEstimate <= dueThreshold) {
    // Already due — next review is now
    return new Date().toISOString();
  }
  const masteryFactor = 0.5 + masteryEstimate * 1.5;
  const effectiveHalfLife = halfLifeDays * masteryFactor;
  const daysUntilDue = (-effectiveHalfLife * Math.log(dueThreshold / masteryEstimate)) / Math.LN2;
  const lastSeenMs = new Date(lastSeen).getTime();
  return new Date(lastSeenMs + daysUntilDue * MS_PER_DAY).toISOString();
}

export function computeTopicEngagement(
  topic: LearnerState["coveredTopics"][number],
  policy: EngagementPolicy,
  now: Date = new Date()
): TopicEngagement {
  const daysSince = daysBetween(topic.lastSeen, now);
  const retention = estimateRetention(
    topic.masteryEstimate,
    daysSince,
    policy.retentionHalfLifeDays
  );
  const isDue = retention < policy.dueThreshold && daysSince >= policy.minReviewIntervalDays;
  const { urgency, label } = computeUrgency(
    retention,
    policy.dueThreshold,
    daysSince,
    policy.urgencyTiers
  );
  const nextReview = estimateNextReview(
    topic.lastSeen,
    topic.masteryEstimate,
    policy.retentionHalfLifeDays,
    policy.dueThreshold
  );

  return {
    slug: topic.slug,
    title: titleCase(topic.slug.replace(/-/g, " ")),
    domain: topic.domain,
    lastSeen: topic.lastSeen,
    daysSinceLastSeen: daysSince,
    masteryEstimate: topic.masteryEstimate,
    estimatedRetention: retention,
    isDue,
    urgency,
    urgencyLabel: label,
    sessionCount: topic.sessionCount,
    nextReviewAt: nextReview
  };
}

export function buildEngagementTimeline(
  state: LearnerState,
  policy: EngagementPolicy = DEFAULT_ENGAGEMENT_POLICY,
  now: Date = new Date()
): EngagementTimeline {
  const topics = state.coveredTopics.map(t => computeTopicEngagement(t, policy, now));

  // Sort by urgency descending (most urgent first)
  topics.sort((a, b) => b.urgency - a.urgency);

  const dueCount = topics.filter(t => t.isDue).length;
  const criticalCount = topics.filter(t => t.urgencyLabel === "critical").length;
  const averageRetention = topics.length > 0 ? mean(topics.map(t => t.estimatedRetention)) : 1;
  const oldestUnreviewedDays = topics.length > 0
    ? Math.max(...topics.map(t => t.daysSinceLastSeen))
    : 0;

  return {
    generatedAt: now.toISOString(),
    policy,
    topics,
    summary: {
      totalTopics: topics.length,
      dueCount,
      criticalCount,
      averageRetention,
      oldestUnreviewedDays
    }
  };
}

export function dueTopics(
  state: LearnerState,
  policy: EngagementPolicy = DEFAULT_ENGAGEMENT_POLICY,
  now: Date = new Date()
): TopicEngagement[] {
  const timeline = buildEngagementTimeline(state, policy, now);
  return timeline.topics.filter(t => t.isDue);
}

function retentionBar(retention: number): string {
  const filled = Math.round(retention * 10);
  return "█".repeat(filled) + "░".repeat(10 - filled);
}

function urgencyEmoji(label: TopicEngagement["urgencyLabel"]): string {
  switch (label) {
    case "critical": return "🔴";
    case "high": return "🟠";
    case "moderate": return "🟡";
    case "low": return "🟢";
    case "fresh": return "✨";
  }
}

function formatDays(days: number): string {
  if (days < 1) return "today";
  if (days < 2) return "1 day ago";
  if (days < 7) return `${Math.floor(days)} days ago`;
  if (days < 14) return "1 week ago";
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 60) return "1 month ago";
  return `${Math.floor(days / 30)} months ago`;
}

export function engagementTimelineToMarkdown(timeline: EngagementTimeline): string {
  const lines = [
    "# Engagement Timeline",
    "",
    `Generated: ${new Date(timeline.generatedAt).toLocaleString()}`,
    "",
    "## Summary",
    "",
    `- **Topics tracked:** ${timeline.summary.totalTopics}`,
    `- **Due for review:** ${timeline.summary.dueCount}`,
    `- **Critical:** ${timeline.summary.criticalCount}`,
    `- **Average retention:** ${(timeline.summary.averageRetention * 100).toFixed(1)}%`,
    `- **Oldest unreviewed:** ${formatDays(timeline.summary.oldestUnreviewedDays)}`,
    ""
  ];

  if (timeline.topics.length === 0) {
    lines.push("No topics covered yet. Start a lesson to begin tracking.");
    return `${lines.join("\n")}\n`;
  }

  lines.push("## Topics");
  lines.push("");
  lines.push("| Status | Topic | Last Seen | Retention | Mastery | Sessions | Next Review |");
  lines.push("| :---: | --- | --- | --- | ---: | ---: | --- |");

  for (const topic of timeline.topics) {
    lines.push(
      `| ${urgencyEmoji(topic.urgencyLabel)} | **${topic.title}** (${topic.domain}) | ${formatDays(topic.daysSinceLastSeen)} | ${retentionBar(topic.estimatedRetention)} ${(topic.estimatedRetention * 100).toFixed(0)}% | ${(topic.masteryEstimate * 100).toFixed(0)}% | ${topic.sessionCount} | ${topic.isDue ? "**NOW**" : new Date(topic.nextReviewAt).toLocaleDateString()} |`
    );
  }

  lines.push("");

  // Legend
  lines.push("### Legend");
  lines.push("");
  lines.push("- 🔴 Critical — severely overdue, retention critically low");
  lines.push("- 🟠 High — significantly overdue, review soon");
  lines.push("- 🟡 Moderate — approaching review threshold");
  lines.push("- 🟢 Low — retention adequate, no rush");
  lines.push("- ✨ Fresh — recently covered");
  lines.push("");

  return `${lines.join("\n")}\n`;
}

export function dueTopicsToMarkdown(topics: TopicEngagement[]): string {
  if (topics.length === 0) {
    return "# Due Topics\n\n✅ All topics are up to date! No reviews needed right now.\n";
  }

  const lines = [
    "# Due Topics",
    "",
    `${topics.length} topic${topics.length === 1 ? "" : "s"} due for review:`,
    ""
  ];

  for (const topic of topics) {
    lines.push(`### ${urgencyEmoji(topic.urgencyLabel)} ${topic.title}`);
    lines.push(`- Domain: ${topic.domain}`);
    lines.push(`- Last seen: ${formatDays(topic.daysSinceLastSeen)}`);
    lines.push(`- Retention: ${retentionBar(topic.estimatedRetention)} ${(topic.estimatedRetention * 100).toFixed(0)}%`);
    lines.push(`- Mastery at last review: ${(topic.masteryEstimate * 100).toFixed(0)}%`);
    lines.push(`- Sessions: ${topic.sessionCount}`);
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

export async function loadEngagementPolicy(filePath: string): Promise<EngagementPolicy> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as EngagementPolicy;
  } catch {
    return DEFAULT_ENGAGEMENT_POLICY;
  }
}

export async function saveEngagementPolicy(
  filePath: string,
  policy: EngagementPolicy
): Promise<void> {
  await writeFile(filePath, `${JSON.stringify(policy, null, 2)}\n`, "utf8");
}
