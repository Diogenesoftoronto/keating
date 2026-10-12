import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { patchOnnxAndroidGradle } from "../scripts/prepare-android-dependencies.mjs";

test("pinned ONNX Android preparation removes the Gradle 9 failure and is repeatable", () => {
  const require = createRequire(import.meta.url);
  const manifest = require.resolve("onnxruntime-react-native/package.json");
  const installed = readFileSync(new URL("android/build.gradle", `file://${manifest}`), "utf8");
  const result = patchOnnxAndroidGradle(installed, "1.24.3");
  expect(result).not.toContain("VersionNumber");
  expect(result).toContain('tokenize(".")[1].toInteger() < 71');
  expect(patchOnnxAndroidGradle(result, "1.24.3")).toBe(result);
  expect(() => patchOnnxAndroidGradle(installed, "1.25.0")).toThrow();
  expect(() => patchOnnxAndroidGradle("changed upstream source", "1.24.3")).toThrow();
});
