import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const COMPATIBLE_GRADLE_VERSION = "8.14.3";
const scriptDir = dirname(fileURLToPath(import.meta.url));
const wrapperPath = resolve(scriptDir, "../android/gradle/wrapper/gradle-wrapper.properties");
const current = await readFile(wrapperPath, "utf8");
const next = current.replace(
  /distributionUrl=https\\:\/\/services\.gradle\.org\/distributions\/gradle-[^-]+-bin\.zip/,
  `distributionUrl=https\\://services.gradle.org/distributions/gradle-${COMPATIBLE_GRADLE_VERSION}-bin.zip`,
);

if (next === current && !current.includes(`gradle-${COMPATIBLE_GRADLE_VERSION}-bin.zip`)) {
  throw new Error(`Could not update Gradle wrapper at ${wrapperPath}`);
}

await writeFile(wrapperPath, next, "utf8");
console.log(`Pinned generated Android wrapper to Gradle ${COMPATIBLE_GRADLE_VERSION}.`);
