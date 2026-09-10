import { spawnSync } from "node:child_process";
const result = spawnSync(process.platform === "win32" ? "electron-builder.cmd" : "electron-builder", [
  "--config.directories.output=release-offline",
  "--config.artifactName=Keating-${version}-offline-${os}-${arch}.${ext}",
  "--config.linux.artifactName=Keating-${version}-offline-linux-${arch}.${ext}",
  ...process.argv.slice(2),
], { stdio: "inherit", env: { ...process.env, KEATING_OFFLINE_EDITION: "1" }, shell: process.platform === "win32" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
