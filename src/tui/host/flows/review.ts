/**
 * Spaced-repetition review: summary, due-card rating and deck generation.
 */
import { flashcardsTopicArtifact } from "../../../core/project.js";
import { type SrsRating, formatDueIn } from "../../learner-contracts.js";
import { loadTuiReviewDashboard, rateTuiReviewCard, reviewCardOption } from "../../review.js";
import { sanitizeDiagnostic } from "../../view-model.js";
import type { HostContext } from "../context.js";
import { busySurfaceNotice, restoreIdleStatus } from "./common.js";

export type ReviewDeps = Pick<HostContext, "cwd" | "dialogs" | "state" | "surface" | "view">;

export async function showReview(deps: ReviewDeps): Promise<void> {
  const { cwd, surface, dialogs } = deps;
  const { appendEntry, status } = deps.view;
  const { presentSelect } = dialogs;
  if (busySurfaceNotice(deps, "Review")) return;
  status.content = "Loading review queue…";
  try {
    const now = new Date().toISOString();
    const dashboard = await loadTuiReviewDashboard(cwd, now);
    appendEntry({
      id: `review-summary-${Date.now()}`,
      kind: "artifact",
      title: "Review queue",
      body: [
        `${dashboard.dueCards.length} observed card${dashboard.dueCards.length === 1 ? "" : "s"} due across ${dashboard.cards.length} saved card${dashboard.cards.length === 1 ? "" : "s"}.`,
        `${dashboard.dueTopics.length} topic${dashboard.dueTopics.length === 1 ? "" : "s"} estimated due from local learner history.`,
        "",
        dashboard.provenance,
      ].join("\n"),
    });

    if (dashboard.dueCards.length > 0) {
      const cardOptions = dashboard.dueCards.map((card, index) => reviewCardOption(card, index, now));
      const selected = await presentSelect("Due cards · schedule order", cardOptions);
      if (selected === undefined) return;
      const card = dashboard.dueCards[cardOptions.indexOf(selected)];
      if (!card) return;
      const reveal = await presentSelect(`Question\n${card.front}`, ["Reveal answer", "Cancel"]);
      if (reveal !== "Reveal answer") return;
      const ratingOption = await presentSelect(`Answer\n${card.back}`, ["0 · Again", "1 · Hard", "2 · Good", "3 · Easy", "Cancel"]);
      if (!ratingOption || ratingOption === "Cancel") return;
      const rating = Number(ratingOption[0]) as SrsRating;
      const outcome = await rateTuiReviewCard(cwd, card, rating, now);
      appendEntry({
        id: `review-rated-${Date.now()}`,
        kind: "notice",
        title: "Review recorded",
        body: `${card.front}\n\nRating: ${ratingOption.slice(4)} · next review ${formatDueIn(outcome.next.dueAt, now)}.`,
      });
      return;
    }

    if (dashboard.dueTopics.length > 0) {
      const topicOptions = dashboard.dueTopics.map((topic, index) => `${index + 1}. ${topic.title} · estimated retention ${(topic.estimatedRetention * 100).toFixed(0)}% · ${Math.floor(topic.daysSinceLastSeen)}d since seen`);
      const selected = await presentSelect("No saved due cards · generate a deck for an estimated-due topic", topicOptions);
      if (selected === undefined) return;
      const topic = dashboard.dueTopics[topicOptions.indexOf(selected)];
      if (!topic) return;
      const confirmed = await surface.presentConfirm("Generate review cards?", `Generate a deterministic local deck for ${topic.title}? Topic urgency is estimated, not proven mastery.`);
      if (!confirmed) return;
      const generated = await flashcardsTopicArtifact(cwd, topic.slug);
      appendEntry({ id: `review-generated-${Date.now()}`, kind: "artifact", title: "Review deck generated", body: `Saved ${generated.flashcardsPath}. Reopen Review to begin the now-due cards.` });
      return;
    }

    appendEntry({ id: `review-empty-${Date.now()}`, kind: "notice", title: "Nothing due", body: "No saved cards or locally estimated topics need review right now." });
  } catch (error) {
    appendEntry({ id: `review-error-${Date.now()}`, kind: "error", title: "Review unavailable", body: `${sanitizeDiagnostic(error)}\n\nNo review state was changed. Repair the local schedule or use /shell, then retry.` });
  } finally {
    restoreIdleStatus(deps);
  }
}
