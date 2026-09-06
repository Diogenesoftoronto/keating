interface CapturedOutput {
	stdout: string;
	stderr: string;
	exitCode: number;
}

interface CapturedProcess {
	completion: Promise<CapturedOutput>;
	on(event: "error", listener: (text: string) => void): unknown;
	removeListener(event: "error", listener: (text: string) => void): unknown;
}

interface CaptureClient {
	processManager: {
		on(event: "spawn", listener: (pid: number) => void): unknown;
		removeListener(event: "spawn", listener: (pid: number) => void): unknown;
		getProcess(pid: number): { stdout: string; stderr: string; exitCode?: number } | undefined;
	};
	spawn(command: string, args: string[], options: { cwd: string }): Promise<CapturedProcess>;
}

/**
 * NodePod 1.8.2's ProcessHandle retains the worker's final output, but its
 * NodepodProcess wrapper forwards only the exit code. A command that buffers
 * output until exit consequently has an empty `completion.stdout`.
 *
 * Observe only this synchronous spawn call to obtain its public process handle.
 * Removing the listener before awaiting avoids mixing concurrent commands or
 * their child processes. Execution still goes through the SDK's normal spawn.
 */
export async function captureNodePodProcess(
	pod: CaptureClient,
	command: string,
	args: string[],
): Promise<CapturedOutput> {
	let handle: ReturnType<CaptureClient["processManager"]["getProcess"]>;
	const captureHandle = (pid: number) => { handle ??= pod.processManager.getProcess(pid); };
	pod.processManager.on("spawn", captureHandle);
	let pending: ReturnType<CaptureClient["spawn"]>;
	try {
		pending = pod.spawn(command, args, { cwd: "/workspace" });
	} finally {
		pod.processManager.removeListener("spawn", captureHandle);
	}
	const process = await pending;
	// The SDK emits stderr as an EventEmitter "error" event. Subscribe while
	// waiting so ordinary command stderr cannot become an unhandled exception.
	const acceptStderr = (_text: string) => {};
	process.on("error", acceptStderr);
	try {
		const completed = await process.completion;
		return {
			stdout: handle?.stdout ?? completed.stdout,
			stderr: handle?.stderr ?? completed.stderr,
			exitCode: handle?.exitCode ?? completed.exitCode,
		};
	} finally {
		process.removeListener("error", acceptStderr);
	}
}
