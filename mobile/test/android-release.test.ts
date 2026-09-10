import { describe, expect, test } from "bun:test";
import { configureAndroidRelease } from "../scripts/prepare-android-release.mjs";

const generated = `apply plugin: "com.android.application"
android { buildTypes { release { signingConfig signingConfigs.debug } } }
`;

describe("Android release preparation", () => {
  test("overrides Expo debug signing and gives each patch an increasing install version", () => {
    const current = configureAndroidRelease(generated, "3.15.0");
    expect(current).toContain("versionCode 3015000");
    expect(current).toContain('versionName "3.15.0"');
    expect(current.lastIndexOf("signingConfig null")).toBeGreaterThan(current.indexOf("signingConfigs.debug"));
    expect(configureAndroidRelease(current, "3.15.0")).toBe(current);
    const next = configureAndroidRelease(current, "3.15.1");
    expect(next).toContain("versionCode 3015001");
    expect(next).not.toContain("versionCode 3015000");
  });

  test("fails closed for unsupported versions and an unexpected native template", () => {
    for (const version of ["3.15.0-beta.1", "3.1000.0", "3.15.1000", "2101.0.0", "0.0.0"]) {
      expect(() => configureAndroidRelease(generated, version)).toThrow();
    }
    expect(() => configureAndroidRelease("", "3.15.0")).toThrow("Unexpected Expo");
  });
});
