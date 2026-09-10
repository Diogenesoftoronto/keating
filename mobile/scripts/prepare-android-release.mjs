import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const begin = "// BEGIN KEATING RELEASE APK";
const end = "// END KEATING RELEASE APK";

/** Expo's generated release variant uses the debug key. Sign separately in CI. */
export function configureAndroidRelease(source, version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) throw new Error("Android APK releases require a stable SemVer version.");
  const [major, minor, patch] = match.slice(1).map(Number);
  const versionCode = major * 1_000_000 + minor * 1_000 + patch;
  if (minor > 999 || patch > 999 || !Number.isSafeInteger(versionCode) || versionCode < 1 || versionCode > 2_100_000_000) {
    throw new Error("Release version cannot be represented as an Android versionCode.");
  }
  if (!source.includes('com.android.application') || !source.includes('signingConfigs.debug')) {
    throw new Error("Unexpected Expo Android app build file; inspect release signing before continuing.");
  }
  const clean = source.replace(new RegExp(`\\n${begin}[\\s\\S]*?${end}\\n?`, "g"), "");
  return `${clean.trimEnd()}\n\n${begin}\nandroid {\n    defaultConfig {\n        versionCode ${versionCode}\n        versionName "${version}"\n    }\n    buildTypes {\n        release {\n            signingConfig null\n        }\n    }\n}\n${end}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const appGradle = new URL("../android/app/build.gradle", import.meta.url);
  const source = await readFile(appGradle, "utf8");
  await writeFile(appGradle, configureAndroidRelease(source, manifest.version));
  console.log(`Prepared Android ${manifest.version} release APK with bundled JavaScript; APK signing is a separate required step.`);
}
