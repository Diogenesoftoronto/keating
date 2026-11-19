const [{ getInitPromise, sessions }, { trajectoryReviewStore }, reviewApi] = await Promise.all([
  import("/src/hooks/keating-storage.ts"),
  import("/src/keating/trajectory-store.ts"),
  import("/src/keating/trajectory-review.ts"),
]);
await getInitPromise();
const session = await sessions.loadSession(data.sessionId);
if (!session) throw new Error("Seed sessions before review.");
const store = trajectoryReviewStore();
const now = Date.now();
const review = await store.getOrCreateReview(data.sessionId, now);
await store.saveReview({ ...review, ...data.review }, now);
for (const sample of data.notes) {
  const { turn, quote, ...fields } = sample;
  const message = reviewApi.messageReviewAnchor(data.sessionId, session.messages[turn], turn);
  const start = message.text.indexOf(quote);
  if (start < 0) throw new Error(`Sample note no longer matches turn ${turn}: ${quote}`);
  const target = {
    kind: "message-span", messageId: message.id, role: message.role,
    messageTimestamp: message.timestamp,
    anchor: reviewApi.createTextAnchor(message.text, start, start + quote.length),
  };
  await store.saveAnnotation({
    ...fields, reviewId: review.id, sessionId: data.sessionId,
    target, targetKey: reviewApi.reviewTargetKey(target),
    authorship: "human", status: "draft", createdAt: now,
  }, now);
}
