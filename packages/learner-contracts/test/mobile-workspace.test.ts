import { describe, expect, test } from "bun:test";
import {
  validateMobileWorkspaceActivationReceipt,
  validateMobileWorkspaceBase,
  validateMobileWorkspaceOverlay,
} from "../src/mobile-workspace.js";

const ZERO = "0".repeat(64);
const ONE = "1".repeat(64);
const TWO = "2".repeat(64);
const NOW = "2026-08-16T00:00:00.000Z";

function base() {
  return {
    schemaVersion: 1 as const,
    kind: "keating-mobile-workspace-base" as const,
    id: "mobile-base-1",
    runtimeVersion: "ios-1",
    sdkVersion: "1.0.0",
    createdAt: NOW,
    treeSha256: ONE,
    files: [
      { path: "screens/home.json", language: "json" as const, source: "{}", sha256: ZERO },
      { path: "theme/tokens.json", language: "json" as const, source: "{}", sha256: ZERO },
    ],
  };
}

function overlay() {
  return {
    schemaVersion: 1 as const,
    kind: "keating-mobile-workspace-overlay" as const,
    id: "overlay-1",
    baseId: "mobile-base-1",
    baseTreeSha256: ONE,
    parentTreeSha256: ONE,
    resultingTreeSha256: TWO,
    createdAt: NOW,
    intent: "Put the next review at the top of the learner home screen.",
    requiredCapabilities: ["ui.render", "review.start"] as const,
    changes: [{
      path: "screens/home.json",
      operation: "modify" as const,
      beforeSha256: ZERO,
      afterSha256: TWO,
      source: "{\"type\":\"review-queue\"}",
    }],
  };
}

describe("mobile workspace contracts", () => {
  test("accepts closed, sorted, user-visible bases and overlays", () => {
    expect(validateMobileWorkspaceBase(base())).toBe(true);
    expect(validateMobileWorkspaceOverlay(overlay())).toBe(true);
  });

  test("rejects unsafe paths, unknown capabilities, hidden deletion source, and unknown fields", () => {
    const unsafe = base();
    unsafe.files[0]!.path = "../secrets";
    expect(validateMobileWorkspaceBase(unsafe)).toBe(false);
    expect(validateMobileWorkspaceOverlay({ ...overlay(), requiredCapabilities: ["network.raw"] })).toBe(false);
    expect(validateMobileWorkspaceOverlay({
      ...overlay(),
      changes: [{ ...overlay().changes[0], operation: "delete", source: "hidden" }],
    })).toBe(false);
    expect(validateMobileWorkspaceOverlay({ ...overlay(), authorization: "Bearer hidden" })).toBe(false);
  });

  test("requires deterministic ordering and matching activation status", () => {
    const unsorted = base();
    unsorted.files.reverse();
    expect(validateMobileWorkspaceBase(unsorted)).toBe(false);

    const receipt = {
      schemaVersion: 1 as const,
      kind: "keating-mobile-workspace-activation" as const,
      id: "activation-1",
      baseId: "mobile-base-1",
      overlayId: "overlay-1",
      resultingTreeSha256: TWO,
      createdAt: NOW,
      status: "active" as const,
      checks: [{ id: "schema", status: "passed" as const, message: "Workspace schema is valid." }],
    };
    expect(validateMobileWorkspaceActivationReceipt(receipt)).toBe(true);
    expect(validateMobileWorkspaceActivationReceipt({
      ...receipt,
      status: "rejected",
      checks: [{ id: "schema", status: "failed", message: "Invalid component." }],
    })).toBe(true);
    expect(validateMobileWorkspaceActivationReceipt({ ...receipt, status: "rejected" })).toBe(false);
  });
});
