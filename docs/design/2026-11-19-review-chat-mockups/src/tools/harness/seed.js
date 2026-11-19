(async () => {
  const store = await import('/src/hooks/keating-storage.ts');
  const meta = await import('/src/hooks/session-metadata.ts');
  await store.getInitPromise();
  localStorage.setItem('keating:onboarding:v1', JSON.stringify({ status: 'skipped', outcome: 'skipped', completedAt: new Date().toISOString(), version: 2, step: 0 }));
  localStorage.setItem('keating:tour:v1', JSON.stringify({ outcome: 'skipped', position: 0, completedAt: new Date().toISOString(), version: 1 }));
  const model = { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5', api: 'anthropic-messages', provider: 'anthropic', baseUrl: 'https://api.anthropic.com', reasoning: true, input: ['text'], cost: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }, contextWindow: 200000, maxTokens: 16000 };
  const t0 = Date.now() - 1000 * 60 * 42; let n = 0;
  const usage = (i, o) => ({ input: i, output: o, cacheRead: 0, cacheWrite: 0, totalTokens: i + o, cost: { input: i * 3e-6, output: o * 15e-6, cacheRead: 0, cacheWrite: 0, total: i * 3e-6 + o * 15e-6 } });
  const u = (text) => ({ role: 'user', content: [{ type: 'text', text }], timestamp: t0 + (n++) * 90000 });
  const a = (text, i, o) => ({ role: 'assistant', content: [{ type: 'text', text }], api: model.api, provider: model.provider, model: model.id, usage: usage(i, o), stopReason: 'stop', timestamp: t0 + (n++) * 90000 });
  const messages = [
    u("I keep mixing up when recursion is the right tool versus a plain loop. Can you help me actually understand recursion instead of memorising factorial?"),
    a("Good instinct: factorial is the example everyone memorises and nobody learns from.\n\nBefore I explain anything, one question so I know where to start:\n\n**When a function calls itself, what do you think happens to the first call while the second one runs?**", 1840, 96),
    u("I think the first call just stops and the second one replaces it? Like the function restarts with a new argument."),
    a("That is the most common model, and it is half right, which is why it causes trouble.\n\nThe second call does start fresh with a new argument. But the first call is **not replaced**. It is *paused*, waiting, with all of its local variables intact.\n\n```python\ndef countdown(n):\n    if n == 0:          # base case\n        return\n    print(\"before\", n)\n    countdown(n - 1)    # paused here\n    print(\"after\", n)   # resumes here\n```\n\nPredict the output of `countdown(2)` before you run it. Write down the four lines you expect.", 2210, 268),
    u("before 2, before 1, after 1, after 2. Oh. So the after lines come out backwards because each call is still waiting."),
    a("Exactly. You just described the **call stack** without being told the term.\n\nEach paused call sits on a stack. The most recent one finishes first, so the `after` lines unwind in reverse.\n\nNow the question you actually asked, turned around: would you walk a folder tree with a loop or with recursion, and what decides it?", 2640, 301),
  ];
  const now = new Date().toISOString();
  const id = '11111111-2222-4333-8444-555555555555';
  const data = { id, title: 'Recursion: pause and resume, not replace', model, thinkingLevel: 'medium', messages, createdAt: new Date(t0).toISOString(), lastModified: now, aiGeneratedTitle: true };
  const md = { id, title: data.title, createdAt: data.createdAt, lastModified: now, messageCount: messages.length, usage: meta.sessionUsage(messages), thinkingLevel: 'medium', ...meta.sessionModelMetadata(model), preview: meta.sessionPreview(messages), searchText: meta.sessionSearchText(messages), aiGeneratedTitle: true };
  await store.sessions.save(data, md);
  for (const [k, title, q, ans, ago] of [
    ['22222222-2222-4333-8444-555555555555', "Bayes' theorem with a medical test", "Why is a positive test not 99% likely to mean I am sick?", "Start with 1,000 people rather than a formula.", 26],
    ['33333333-2222-4333-8444-555555555555', 'French past tenses', "When do I use imparfait?", "Tell me about a habit you had as a child.", 75],
  ]) {
    const ts = Date.now() - ago * 3600 * 1000;
    const ms = [{ role: 'user', content: [{ type: 'text', text: q }], timestamp: ts }, { role: 'assistant', content: [{ type: 'text', text: ans }], api: model.api, provider: model.provider, model: model.id, usage: usage(900, 80), stopReason: 'stop', timestamp: ts + 20000 }];
    const iso = new Date(ts + 20000).toISOString();
    await store.sessions.save({ id: k, title, model, thinkingLevel: 'medium', messages: ms, createdAt: new Date(ts).toISOString(), lastModified: iso, aiGeneratedTitle: true }, { id: k, title, createdAt: new Date(ts).toISOString(), lastModified: iso, messageCount: 2, usage: meta.sessionUsage(ms), thinkingLevel: 'medium', ...meta.sessionModelMetadata(model), preview: meta.sessionPreview(ms), searchText: meta.sessionSearchText(ms), aiGeneratedTitle: true });
  }
  return 'seeded ' + (await store.sessions.getAllMetadata()).length;
})()
