import { expect, test } from "bun:test";
import { manifestForSurface } from "../src/surface.js";

test("browser remains fully local while signed-in state is account portable", () => {
  const manifest = manifestForSurface("browser-local", true);
  expect(manifest.execution.mayLeaveDevice).toBe(false);
  expect(manifest.storageAuthority).toBe("notorganic");
  expect(manifest.portableState).toContain("evolution-code");
  expect(manifest.credentialsPersistedInAgentState).toBe(false);
});

test("mobile requests a provider-neutral secure remote execution capability", () => {
  const manifest = manifestForSurface("mobile-remote", true);
  expect(manifest.execution.requirements.secureIsolation).toBe(true);
  expect(manifest.execution.requirements.outboundNetwork).toBe(true);
});
