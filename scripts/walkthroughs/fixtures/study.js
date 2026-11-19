const [{ getInitPromise, sessions, keatingStorage }, { initialSrsState }, { presentationsFromAssistantText }, sources] = await Promise.all([
  import("/src/hooks/keating-storage.ts"),
  import("/src/keating/srs.ts"),
  import("/src/keating/judgement/active-work-host.ts"),
  import("/src/keating/learning-intelligence/source-navigation.ts"),
]);
await getInitPromise();
const session = await sessions.loadSession(data.sessionId);
if (!session) throw new Error("Seed sessions before study.");
const now = Date.now();
const presentations = session.messages.flatMap((message, index) => {
  if (message.role !== "assistant") return [];
  const text = sources.learningMessageText(message);
  const messageId = sources.learningMessageId(message, index);
  return presentationsFromAssistantText(text, { sessionId: data.sessionId, messageId }, null, message.timestamp);
});
await keatingStorage.recordOpenUiPresentations(presentations);
const { plan, verification, deck, quiz } = data;
await keatingStorage.importPortableData({
  lessonPlans: [{ ...plan, topic: data.topic, createdAt: now, updatedAt: now, sessionId: data.sessionId }],
  verifications: [{ ...verification, topic: data.topic, createdAt: now, sessionId: data.sessionId }],
  quizResults: [{ ...quiz, topic: data.topic, createdAt: now, sessionId: data.sessionId }],
});
await keatingStorage.saveDeck({
  ...deck, topic: data.topic, sessionId: data.sessionId,
  cards: deck.cards.map(card => ({ ...card, createdAt: now, updatedAt: now, srs: initialSrsState(now) })),
});
for (const entry of data.feedback) {
  const message = session.messages[entry.turn];
  const content = message?.content?.find(part => part.type === "text")?.text;
  if (!content) throw new Error(`No sample reply for feedback at turn ${entry.turn}.`);
  const messageId = sources.learningMessageId(message, entry.turn);
  await keatingStorage.recordFeedback(data.topic, entry.signal, {
    source: "explicit", sessionId: data.sessionId, messageId, evidence: entry.evidence,
    referent: { sessionId: data.sessionId, messageId, content, createdAt: message.timestamp },
  });
}
