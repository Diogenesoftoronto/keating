import { afterEach, describe, expect, test } from "bun:test";
import { CourseApiError, listCourses } from "../courses/client";
import { classifyLlmError } from "../core/api-retry";
import { createTool, KeatingToolError } from "../keating/browser-tools/shared";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe("course tool error recovery", () => {
  test("a failed course-list request retains its authenticated account error through the tool wrapper", async () => {
    globalThis.fetch = (async () => Response.json({
      statusMessage: "Request failed",
      data: { code: "notorganic_auth_adapter_unavailable" },
    }, { status: 503 })) as unknown as typeof fetch;
    const tool = createTool("course_list", "List courses", {}, async () => {
      const courses = await listCourses();
      return String(courses.length);
    });
    let caught: unknown;
    try { await tool.execute("test", {}); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(KeatingToolError);
    const cause = (caught as Error).cause as CourseApiError;
    expect(cause).toBeInstanceOf(CourseApiError);
    expect(cause.status).toBe(503);
    expect(cause.code).toBe("notorganic_auth_adapter_unavailable");
    const details = classifyLlmError(caught);
    expect(details.category).toBe("auth");
    expect(details.statusCode).toBe(503);
    expect(details.recovery).toContain("Keating account");
    expect(details.automaticRetry).toBe(false);
    expect(details.recovery).not.toContain("model");
    // The Pi tool-result/card boundary contains only the thrown message.
    const cardDetails = classifyLlmError((caught as Error).message);
    expect(cardDetails).toEqual(details);
    expect((caught as Error).message).toBe("Keating course request failed (503; notorganic_auth_adapter_unavailable).");
  });

  test("course HTTP failures use course recovery without automatically repeating mutations", () => {
    for (const status of [400, 401, 403, 404, 409, 422, 429, 500, 503, 504]) {
      const error = new CourseApiError("Request failed", status, "course_failure", 12);
      const wrapped = new KeatingToolError("course_update", error.message, "execution-failed", error);
      const details = classifyLlmError(wrapped);
      expect((wrapped.cause as CourseApiError).currentRevision).toBe(12);
      expect(details.statusCode).toBe(status);
      expect(details.title.toLowerCase()).toContain(status === 401 ? "sign in" : "course");
      expect(details.recovery).not.toContain("provider");
      expect(details.recovery).not.toContain("model");
      expect(details.automaticRetry).toBe(false);
    }
  });

  test("ordinary provider errors and untrusted course-shaped objects retain existing classification", () => {
    expect(classifyLlmError({ status: 404, message: "Not found" }).category).toBe("model-unavailable");
    expect(classifyLlmError({ status: 401, code: "notorganic_auth_adapter_unavailable" }).title).toBe("Provider sign-in failed");
    expect(classifyLlmError(new Error("Request failed")).category).toBe("unknown");
    expect(classifyLlmError("Keating course request failed (503; arbitrary_secret).").category).toBe("server");
    expect(classifyLlmError("Keating course request failed (404). trailing text").category).toBe("model-unavailable");
  });
});
