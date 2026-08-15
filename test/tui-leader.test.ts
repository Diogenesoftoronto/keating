import { describe, expect, test } from "bun:test";
import { isTuiLeaderKey, TUI_LEADER_HINT, tuiLeaderAction } from "../src/tui/leader.js";

describe("TUI leader commands", () => {
  test("uses colon as a portable leader for model and navigation commands", () => {
    expect(isTuiLeaderKey(":")).toBe(true);
    expect(isTuiLeaderKey("colon")).toBe(true);
    expect(tuiLeaderAction("m")).toBe("model");
    expect(tuiLeaderAction("P")).toBe("palette");
    expect(tuiLeaderAction("s")).toBe("sessions");
    expect(tuiLeaderAction("unknown")).toBeUndefined();
    expect(TUI_LEADER_HINT).toContain(":m models");
  });
});
