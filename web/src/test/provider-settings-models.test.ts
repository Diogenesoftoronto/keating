import { afterEach, expect, test } from "bun:test";
import { modelsFor } from "../components/settings/ProviderConnectPanel";
import { NOTORGANIC_ESTABLISHED_CHAT_MODELS, NOTORGANIC_MERCURY_2_MODEL, NOTORGANIC_DEFAULT_MODEL } from "../notorganic-provider";

const previousEnabled = process.env.VITE_NOTORGANIC_ENABLED;
afterEach(() => {
  if (previousEnabled === undefined) delete process.env.VITE_NOTORGANIC_ENABLED;
  else process.env.VITE_NOTORGANIC_ENABLED = previousEnabled;
});

test("hosted settings list every selectable chat model, led by the runtime default", () => {
  process.env.VITE_NOTORGANIC_ENABLED = "true";
  const listed = modelsFor("notorganic");
  expect(listed[0]).toEqual({ id: NOTORGANIC_DEFAULT_MODEL.id, name: NOTORGANIC_DEFAULT_MODEL.name });
  expect(listed).toEqual(NOTORGANIC_ESTABLISHED_CHAT_MODELS.map(({ id, name }) => ({ id, name })));
  expect(modelsFor("notorganic", [...NOTORGANIC_ESTABLISHED_CHAT_MODELS, NOTORGANIC_MERCURY_2_MODEL])).toContainEqual({ id: "mercury-2", name: "Mercury 2" });
  process.env.VITE_NOTORGANIC_ENABLED = "false";
  expect(modelsFor("notorganic")).toEqual([]);
});
