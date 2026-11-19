const { getInitPromise, sessions } = await import("/src/hooks/keating-storage.ts");
const metadata = await import("/src/hooks/session-metadata.ts");
await getInitPromise();
const model = { ...data.model, baseUrl: `${providerUrl ?? "http://127.0.0.1:9"}/v1` };
const now = Date.now();
for (const sample of data.sessions) {
  const { hoursAgo, turns, ...fields } = sample;
  const first = now - hoursAgo * 60 * 60 * 1000;
  const messages = turns.map(([role, text], index) => {
    const entry = { role, content: [{ type: "text", text }], timestamp: first + index * 12_000 };
    if (role === "user") return entry;
    return {
      ...entry,
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: {
        input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
    };
  });
  const createdAt = new Date(first).toISOString();
  const lastModified = new Date(messages.at(-1).timestamp).toISOString();
  const record = { ...fields, createdAt, lastModified, model, thinkingLevel: "off", messages, aiGeneratedTitle: true };
  if (fields.parentSessionId) record.forkedAt = createdAt;
  await sessions.save(record, {
    id: record.id, title: record.title, parentSessionId: record.parentSessionId,
    forkedAt: record.forkedAt, createdAt, lastModified, messageCount: messages.length, thinkingLevel: "off",
    ...metadata.sessionModelMetadata(model),
    usage: metadata.sessionUsage(messages), preview: metadata.sessionPreview(messages),
    searchText: metadata.sessionSearchText(messages), aiGeneratedTitle: true,
  });
}
