import { Nodepod } from "../../../web/node_modules/@scelar/nodepod/dist/index.mjs";
const state = { stage: "boot", result: null as unknown, error: null as string | null };
Object.assign(window, { flueNodepodTest: state });
async function run() {
  const pod = await Nodepod.boot({ workdir: "/workspace", serviceWorker: false, enableSnapshotCache: false });
  try {
    state.stage = "mount";
    await pod.fs.mkdir("/workspace", { recursive: true });
    const source = await (await fetch(new URLSearchParams(location.search).get("fixture") === "portable" ? "/portable.cjs" : "/scenario.cjs")).text();
    await pod.fs.writeFile("/workspace/scenario.cjs", source);
    state.stage = "execute";
    const process = await pod.spawn("node", ["/workspace/scenario.cjs"], { cwd: "/workspace" });
    const timer = setTimeout(() => process.kill(), 45_000);
    try { state.result = await process.completion; } finally { clearTimeout(timer); }
    state.stage = "done";
  } finally { pod.teardown(); }
}
const selected = new URLSearchParams(location.search).get("fixture");
const execute = selected === "chat" ? async () => {
  const { runFlueChatFixture } = await import("../../../web/src/test/fixtures/flue-chat");
  const result = await runFlueChatFixture();
  state.result = { exitCode: 0, stdout: "FLUE_CHAT_RESULT=" + JSON.stringify(result) };
  state.stage = "done";
} : run;
execute().catch((error) => { state.error = error.stack ?? String(error); state.stage = "failed"; });
