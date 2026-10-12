import { afterEach, expect, test } from "bun:test";
import { modelsFor } from "../components/settings/ProviderConnectPanel";
import { NOTORGANIC_DEFAULT_MODEL } from "../notorganic-provider";

const previousEnabled = process.env.VITE_NOTORGANIC_ENABLED;
afterEach(() => {
  if (previousEnabled === undefined) delete process.env.VITE_NOTORGANIC_ENABLED;
  else process.env.VITE_NOTORGANIC_ENABLED = previousEnabled;
});

test("hosted settings list the same default model used by the runtime", () => {
  process.env.VITE_NOTORGANIC_ENABLED = "true";
  expect(modelsFor("notorganic")).toEqual([{ id: NOTORGANIC_DEFAULT_MODEL.id, name: NOTORGANIC_DEFAULT_MODEL.name }]);
  process.env.VITE_NOTORGANIC_ENABLED = "false";
  expect(modelsFor("notorganic")).toEqual([]);
});
