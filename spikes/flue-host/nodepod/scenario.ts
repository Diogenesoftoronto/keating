import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { init } from "@flue/runtime";
import { start } from "@flue/runtime/node";
import { KeatingTeacher } from "../src/agents/keating-teacher.ts";
import { deterministicProvider } from "../src/provider.ts";

// This is executed by NodePod, never by the browser or host test process.
async function scenario() {
  let sawPersistedState = false;
  deterministicProvider.setResponses([
    fauxAssistantMessage(fauxToolCall("build_retrieval_probe", {
      concept: "equivalent fractions", misconception: "larger denominator means larger value",
    }), { stopReason: "toolUse" }),
    (context) => {
      if (!JSON.stringify(context).includes("Completed retrieval probes in this conversation: 1")) {
        throw new Error("Tool state was not reconciled into the next teaching turn");
      }
      return fauxAssistantMessage("Probe ready.");
    },
    (context) => {
      sawPersistedState = JSON.stringify(context).includes("Completed retrieval probes in this conversation: 1");
      return fauxAssistantMessage("Continuing the same learner.");
    },
  ]);
  const runtime = await start({ agents: [KeatingTeacher], providers: [deterministicProvider.provider] });
  try {
    const teacher = init(KeatingTeacher, { id: "nodepod-learner" });
    const first = await teacher.read(await teacher.dispatch("Build a retrieval probe."));
    const second = await teacher.read(await teacher.dispatch("Continue."));
    if (first.text !== "Probe ready." || second.text !== "Continuing the same learner." || !sawPersistedState) {
      throw new Error("Flue dispatch, tool loop, or persistent learner state failed");
    }
    console.log("FLUE_NODEPOD_RESULT=" + JSON.stringify({ ok: true, calls: deterministicProvider.state.callCount, sawPersistedState }));
  } finally { await runtime.stop(); }
}
scenario().catch((error) => { console.error(error.stack ?? String(error)); process.exitCode = 1; });
