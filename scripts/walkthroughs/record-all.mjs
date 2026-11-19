import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";

const directory = join(import.meta.dirname, "storyboards");
const names = (await readdir(directory)).filter(name => name.endsWith(".json")).sort();
if (!names.length) throw new Error("No JSON storyboards in " + directory);
for (const name of names) {
  const child = spawn(process.execPath, [join(import.meta.dirname, "record.mjs"), join(directory, name), ...process.argv.slice(2)], { stdio: "inherit" });
  const signals = ["SIGINT", "SIGTERM", "SIGHUP"];
  const forward = signal => child.kill(signal);
  for (const signal of signals) process.once(signal, forward);
  try {
    const { code, signal } = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    if (code !== 0) throw new Error("Stopped at " + name + " (" + (signal ?? code) + ")");
  } finally {
    for (const signal of signals) process.removeListener(signal, forward);
  }
}
