import { OfflineRuntime } from "../dist/offline-runtime.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
const model = process.argv[2];
if (!model) throw new Error("Usage after compiling desktop: node desktop/scripts/smoke-offline.mjs /absolute/model.litertlm");
const runtime = new OfflineRuntime({
  directory: await mkdtemp(join(tmpdir(), "keating-native-smoke-")),
  executable: resolve("desktop/dist/offline", process.platform === "win32" ? "keating-offline.exe" : "keating-offline"),
  bundledModel: resolve(model),
});
try {
  console.log("status", await runtime.status());
  const start = Date.now();
  console.log("answer", await runtime.generate({ prompt: JSON.stringify({ system: "Answer concisely.", conversation: [{ role: "user", content: "What is 2 + 2?" }] }), maxTokens: 64, temperature: 0 }));
  console.log("elapsedMs", Date.now() - start);
  const pending = runtime.generate({ prompt: "Write a long explanation of fractions.", maxTokens: 1024 }).catch(error => error);
  await new Promise(resolve => setTimeout(resolve, 300));
  console.log("duringGeneration", (await runtime.status()).generating);
  await runtime.cancelGeneration();
  const cancellation = await pending;
  if (!(cancellation instanceof Error) || !cancellation.message.includes("cancelled")) throw new Error("Cancellation did not reject generation.");
  console.log("cancellation", cancellation.message);
  console.log("historyAnswer", await runtime.generate({ prompt: JSON.stringify({ system: "Answer with only the requested name.", conversation: [{ role: "user", content: "My name is Maya." }, { role: "assistant", content: "Hello Maya." }, { role: "user", content: "What is my name?" }] }), maxTokens: 32, temperature: 0 }));
} finally { await runtime.stop(); }
