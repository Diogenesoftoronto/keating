import { expect, test } from "bun:test";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { courseToolsAvailable } from "../courses/tool-availability";
import { filterAvailableKeatingTools } from "../keating/capabilities";

test("unavailable hosted course adapter is omitted without disabling teaching tools", async () => {
  const fetcher = (async () => Response.json({ data: { code: "notorganic_auth_adapter_unavailable" } }, { status: 503 }));
  const available = await courseToolsAvailable(fetcher);
  expect(available).toBe(false);
  const tools = ["course_list", "course_inspect", "course_create", "course_update", "feedback", "set_learner_goal"]
    .map(name => ({ name }) as AgentTool);
  expect(filterAvailableKeatingTools(tools, { coursesAvailable: available }).map(tool => tool.name))
    .toEqual(["feedback", "set_learner_goal"]);
});

test("a validated course session enables courses and unavailable responses do not", async () => {
  for (const mode of ["hosted", "local", "development"]) {
    expect(await courseToolsAvailable((async () => Response.json({ account: { id: "fixture", mode } })))).toBe(true);
  }
  for (const body of [{}, { account: { id: "fixture" } }, { account: { id: "", mode: "hosted" } }]) {
    expect(await courseToolsAvailable((async () => Response.json(body)))).toBe(false);
  }
  expect(await courseToolsAvailable((async () => { throw new Error("offline"); }))).toBe(false);
});
