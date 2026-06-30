import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

function loadVersion(): string {
	try {
		const currentFile = fileURLToPath(import.meta.url);
		const pkgPath = join(dirname(currentFile), "..", "..", "..", "package.json");
		const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
		if (typeof pkg.version === "string") return pkg.version;
	} catch {
		// fall through to fallback
	}
	return "1.4.1";
}

/**
 * Keating version string, read from package.json at runtime so it stays
 * in sync with the canonical source of truth. Falls back to a hard-coded
 * value if package.json cannot be resolved.
 */
export const KEATING_VERSION = loadVersion();
