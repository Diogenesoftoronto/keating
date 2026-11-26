import { afterEach, expect, test } from "bun:test";
import { modelsFor } from "../components/settings/ProviderConnectPanel";
import { NOTORGANIC_ASTRA_MODEL, NOTORGANIC_MERCURY_2_MODEL, NOTORGANIC_DEFAULT_MODEL, NOTORGANIC_UNLISTED_CHAT_MODELS } from "../notorganic-provider";

const previousEnabled = process.env.VITE_NOTORGANIC_ENABLED;
afterEach(() => {
  if (previousEnabled === undefined) delete process.env.VITE_NOTORGANIC_ENABLED;
  else process.env.VITE_NOTORGANIC_ENABLED = previousEnabled;
});

test("hosted settings list the gateway's chat models, and only the default before it answers", () => {
  process.env.VITE_NOTORGANIC_ENABLED = "true";
  const unlisted = modelsFor("notorganic");
  expect(unlisted).toEqual(NOTORGANIC_UNLISTED_CHAT_MODELS.map(({ id, name }) => ({ id, name })));
  expect(unlisted).toEqual([{ id: NOTORGANIC_DEFAULT_MODEL.id, name: NOTORGANIC_DEFAULT_MODEL.name }]);
  expect(modelsFor("notorganic", [NOTORGANIC_ASTRA_MODEL, NOTORGANIC_MERCURY_2_MODEL])).toEqual([
    { id: "gpt-6-astra", name: "GPT-6 Astra" }, { id: "mercury-2", name: "Mercury 2" },
  ]);
  process.env.VITE_NOTORGANIC_ENABLED = "false";
  expect(modelsFor("notorganic")).toEqual([]);
});
