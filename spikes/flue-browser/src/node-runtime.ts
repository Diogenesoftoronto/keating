import { init } from "@flue/runtime";
import { start } from "@flue/runtime/node";

import { KeatingTeacher } from "./keating-agent";

/** Proof fixture for code that belongs in a Node/microVM runner, never the UI. */
export async function startRemoteTeacher(conversationId: string) {
  const runtime = await start({ agents: [KeatingTeacher] });
  return {
    runtime,
    teacher: init(KeatingTeacher, { id: conversationId }),
  };
}
