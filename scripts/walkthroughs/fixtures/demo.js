const [{ getInitPromise }, { getAppStorage }, modelPrefs, ui, judgement] = await Promise.all([
  import("/src/hooks/keating-storage.ts"),
  import("/src/keating/app-storage.ts"),
  import("/src/keating/model-prefs.ts"),
  import("/src/keating/ui-settings.ts"),
  import("/src/keating/judgement-model.ts"),
]);
await getInitPromise();
const now = new Date().toISOString();
localStorage.setItem("keating:onboarding:v1", JSON.stringify({
  outcome: "skipped", completedAt: now, version: 2, step: 0,
}));
localStorage.setItem("keating:tour:v1", JSON.stringify({
  outcome: "skipped", position: 0, completedAt: now, version: 1,
}));
ui.saveKeatingUiSettings({
  ...ui.loadKeatingUiSettings(),
  alternativeResponseChance: 0,
  webSearch: "off",
});
judgement.saveJudgementModelSettings({ ...judgement.loadJudgementModelSettings(), backend: "off" });
if (providerUrl) {
  const model = { ...data.model, baseUrl: `${providerUrl}/v1` };
  const storage = getAppStorage();
  await storage.customProviders.set({ ...data.provider, baseUrl: model.baseUrl, models: [model] });
  await storage.providerKeys.set(data.provider.name, data.provider.apiKey);
  const key = `${model.provider}::${model.api}::${model.id}`;
  const prefs = modelPrefs.loadModelPrefs();
  modelPrefs.saveModelPrefs({
    ...prefs,
    defaultChatModelKey: key,
    recentModels: [{ key, timestamp: Date.now() }],
  });
}
