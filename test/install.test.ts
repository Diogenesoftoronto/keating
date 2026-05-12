import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const tempRoots: string[] = [];

function makeTempRoot() {
	const root = mkdtempSync(join(tmpdir(), "keating-install-test-"));
	tempRoots.push(root);
	return root;
}

afterEach(() => {
	for (const root of tempRoots.splice(0)) {
		rmSync(root, { recursive: true, force: true });
	}
});

function currentInstallerTarget() {
	const os = process.platform === "darwin" ? "darwin" : process.platform === "linux" ? "linux" : null;
	const arch = process.arch === "x64" ? "x64" : process.arch === "arm64" ? "arm64" : null;
	return os && arch ? `${os}-${arch}` : null;
}

test("standalone installer downloads, links, and runs a release bundle", () => {
	const target = currentInstallerTarget();
	if (!target) return;

	const version = "9.9.9-test";
	const root = makeTempRoot();
	const releaseDir = join(root, "release");
	const installBinDir = join(root, "bin");
	const installAppDir = join(root, "app");
	const markerPath = join(root, "keating-ran.txt");
	const bundleName = `keating-${version}-${target}`;
	const bundleDir = join(releaseDir, bundleName);

	mkdirSync(join(bundleDir, "bin"), { recursive: true });
	writeFileSync(join(bundleDir, "package.json"), JSON.stringify({ type: "module" }), "utf8");
	writeFileSync(
		join(bundleDir, "bin", "keating.js"),
		"#!/usr/bin/env node\nimport { writeFileSync } from 'node:fs';\nwriteFileSync(process.env.KEATING_INSTALL_SMOKE_MARKER, 'keating install smoke ok');\n",
		"utf8",
	);

	const tar = spawnSync("tar", ["-czf", `${bundleName}.tar.gz`, bundleName], {
		cwd: releaseDir,
		encoding: "utf8",
	});
	expect(tar.status).toBe(0);

	const install = spawnSync("sh", ["scripts/install/install.sh", version], {
		cwd: process.cwd(),
		env: {
			...process.env,
			KEATING_INSTALL_BASE_URL: `file://${releaseDir}`,
			KEATING_INSTALL_BIN_DIR: installBinDir,
			KEATING_INSTALL_APP_DIR: installAppDir,
			KEATING_INSTALL_SKIP_PATH_UPDATE: "1",
		},
		encoding: "utf8",
	});
	expect(install.status).toBe(0);
	expect(install.stdout).toContain(`Keating ${version} installed successfully.`);

	const run = spawnSync(join(installBinDir, "keating"), [], {
		env: { ...process.env, KEATING_INSTALL_SMOKE_MARKER: markerPath },
		encoding: "utf8",
	});
	expect(run.status).toBe(0);
	expect(existsSync(markerPath)).toBe(true);
	expect(readFileSync(markerPath, "utf8")).toBe("keating install smoke ok");
});
