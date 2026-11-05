import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import config from "../../nitro.config";
import { PERSISTENT_STORES, persistentStorageMounts } from "../../server/plugins/persistent-storage";

test("stores are remounted from runtime variables, not build-time defaults", () => {
  expect(persistentStorageMounts({
    KEATING_SHARE_STORAGE_DIR: "/data/keating-shares",
    KEATING_COURSES_STORAGE_DIR: " /data/keating-courses ",
    KEATING_SUBMISSION_STORAGE_DIR: "",
  })).toEqual([
    { mount: "keating:share", base: "/data/keating-shares" },
    { mount: "keating:courses", base: "/data/keating-courses" },
  ]);
  expect(persistentStorageMounts({})).toEqual([]);
});

test("every compiled fs store has a runtime override and the plugin is registered", () => {
  const compiled = Object.keys(config.storage ?? {}).sort();
  expect(PERSISTENT_STORES.map(([mount]) => mount as string).sort()).toEqual(compiled);
  expect(config.plugins).toContain("server/plugins/persistent-storage.ts");
  // Each variable the plugin reads appears in the config's own fallback.
  const source = readFileSync(new URL("../../nitro.config.ts", import.meta.url), "utf8");
  for (const [, variable] of PERSISTENT_STORES) expect(source).toContain(`process.env.${variable}`);
});
