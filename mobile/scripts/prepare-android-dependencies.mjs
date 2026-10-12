import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

const original = 'VersionNumber.parse(REACT_NATIVE_VERSION) < VersionNumber.parse("0.71")';
const compatible = '(REACT_NATIVE_VERSION.tokenize(".")[0].toInteger() == 0 && REACT_NATIVE_VERSION.tokenize(".")[1].toInteger() < 71)';

/** Preserve the legacy fbjni branch without Gradle's removed VersionNumber API. */
export function patchOnnxAndroidGradle(source, version) {
  if (version !== "1.24.3") throw new Error(`Inspect ONNX Android compatibility for dependency ${version}.`);
  if (source.includes(compatible) && !source.includes("VersionNumber")) return source;
  if (source.split(original).length !== 2 || source.replace(original, "").includes("VersionNumber")) {
    throw new Error("Unexpected ONNX Android Gradle source; refusing an unverified patch.");
  }
  return source.replace(original, compatible);
}

export async function prepareAndroidDependencies() {
  const require = createRequire(import.meta.url);
  const manifestPath = require.resolve("onnxruntime-react-native/package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const gradlePath = new URL("android/build.gradle", `file://${manifestPath}`);
  const source = await readFile(gradlePath, "utf8");
  const patched = patchOnnxAndroidGradle(source, manifest.version);
  if (patched !== source) await writeFile(gradlePath, patched);
}
