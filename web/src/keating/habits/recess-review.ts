import type { RecessResult } from "../../components/recess/types";

export function recessReviewDraft(result: RecessResult): string | null {
  const missed = result.gates.filter(item => !item.ok);
  const prompts = (missed.length ? missed : result.gates).map(item => item.q);
  if (result.wind && (!result.wind.ok || !prompts.length)) prompts.unshift(result.wind.q);
  const topics = [...prompts, ...result.myths.map(item => item.right)].slice(0, 3);
  return topics.length ? "Quiz me on these topics from Recess, one question at a time." + topics.map(topic => `\n- ${topic}`).join("") : null;
}
