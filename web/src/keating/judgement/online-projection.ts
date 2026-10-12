import type { ComingUpQueue } from "../coming-up";
import type { OnlineLearningResults } from "../../../../shared/online-learning-session";

/** The same stable control group as the retired policy, without loading its artifact runtime. */
export function onlineDecisionControl(id: string): boolean {
  let hash = 2166136261;
  for (const char of `decision-policy-exploration-v1:${id}`) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0) % 10 === 0;
}

/** Apply only accepted urgency scores to due-deck positions within the learner's existing lanes. */
export function projectOnlineLearningQueue(queue: ComingUpQueue, results: OnlineLearningResults): ComingUpQueue {
  const urgency = results.urgency;
  if (urgency?.receipt.status !== "active") return queue;
  const scores = new Map(urgency.predictions.filter(row => row.deckId).map(row => [row.deckId!, row.value]));
  const rerank = (lane: ComingUpQueue["items"]) => {
    const eligible = lane.filter(item => item.targetType === "deck" && item.dueCount > 0 && !onlineDecisionControl(item.id) && scores.has(item.targetId));
    const ranked = [...eligible].sort((a, b) => scores.get(b.targetId)! - scores.get(a.targetId)!);
    const ids = new Set(eligible.map(item => item.id)); let next = 0;
    return lane.map(item => ids.has(item.id) ? ranked[next++]! : item);
  };
  const lanes = { focus: rerank(queue.lanes.focus), maintain: rerank(queue.lanes.maintain), low: rerank(queue.lanes.low) };
  return { ...queue, lanes, dueDeckIds: [...lanes.focus, ...lanes.maintain, ...lanes.low]
    .filter(item => item.targetType === "deck" && item.dueCount > 0).map(item => item.targetId) };
}
