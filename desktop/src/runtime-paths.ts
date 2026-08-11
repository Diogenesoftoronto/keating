import { join } from "node:path";

export interface DesktopRuntimePathOptions {
	isPackaged: boolean;
	moduleDir: string;
	resourcesPath: string;
	userData: string;
}

export interface DesktopRuntimePaths {
	/** Read-only Nitro output shipped beside the Electron application. */
	runtimeRoot: string;
	serverEntry: string;
	/** Mutable state must never be written to app resources or ASAR. */
	stateRoot: string;
	coursesStorageDir: string;
	coursesPearStorageDir: string;
}

/**
 * Resolve all filesystem boundaries used by the packaged local server. In a
 * development build the staging script places Nitro beneath dist/; packaged
 * builds receive that exact tree as an Electron extraResource at resources/nitro.
 */
export function resolveDesktopRuntimePaths(
	options: DesktopRuntimePathOptions,
): DesktopRuntimePaths {
	const runtimeRoot = options.isPackaged
		? join(options.resourcesPath, "nitro")
		: join(options.moduleDir, "nitro");
	const stateRoot = join(options.userData, "nitro");

	return {
		runtimeRoot,
		serverEntry: join(runtimeRoot, "server", "index.mjs"),
		stateRoot,
		coursesStorageDir: join(stateRoot, "courses"),
		coursesPearStorageDir: join(stateRoot, "courses-pear"),
	};
}

export function nitroEnvironment(
	paths: DesktopRuntimePaths,
	port: number,
	parentEnvironment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
	if (!Number.isInteger(port) || port < 1 || port > 65_535) {
		throw new Error(`Nitro loopback port must be an integer from 1 to 65535 (got ${port}).`);
	}

	return {
		...parentEnvironment,
		// Run the Electron executable as a Node child so the bundled Nitro output
		// shares Electron's Node ABI without opening another Chromium process.
		ELECTRON_RUN_AS_NODE: "1",
		NITRO_HOST: "127.0.0.1",
		NITRO_PORT: String(port),
		KEATING_COURSES_STORAGE_DIR: paths.coursesStorageDir,
		KEATING_COURSES_PEAR_STORAGE_DIR: paths.coursesPearStorageDir,
	};
}
