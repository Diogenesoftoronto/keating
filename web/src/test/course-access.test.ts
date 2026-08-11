import { describe, expect, it } from "bun:test";
import { describeCourseAccessFailure } from "../courses/useCoursesAccess";

describe("course access recovery", () => {
  it("turns a missing dev API route into an actionable server recovery", () => {
    expect(
      describeCourseAccessFailure(404, { error: "No Vite dev handler" }),
    ).toEqual({
      status: "unavailable",
      error:
        "The course API is not running. Start the full Keating web task, then retry.",
      recovery: "start-server",
    });
  });

  it("keeps hosted account recovery separate from ordinary API failures", () => {
    expect(
      describeCourseAccessFailure(503, {
        statusMessage: "Hosted session adapter missing",
        data: { code: "notorganic_auth_adapter_unavailable" },
      }),
    ).toEqual({
      status: "unavailable",
      error: "Hosted session adapter missing",
      recovery: "account",
    });
  });

  it("surfaces an API error body when retry is appropriate", () => {
    expect(
      describeCourseAccessFailure(502, { error: "Courses API proxy failed" }),
    ).toEqual({
      status: "unavailable",
      error: "Courses API proxy failed",
      recovery: "retry",
    });
  });
});
