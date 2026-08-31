import { createAgentRouter } from "@flue/runtime/routing";
import { Hono } from "hono";

import { KeatingTeacher } from "./agents/keating-teacher.ts";

const app = new Hono();

app.get("/health", (context) =>
  context.json({ ok: true, agent: KeatingTeacher.agentName }),
);
app.route("/agents/keating-teacher", createAgentRouter(KeatingTeacher));

export default app;
