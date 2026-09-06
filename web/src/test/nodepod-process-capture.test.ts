import { describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { captureNodePodProcess } from "../keating/nodepod-process-capture";

type Result = { stdout: string; stderr: string; exitCode: number };

function fixture() {
	const events = new EventEmitter();
	const handles = new Map<number, Result>();
	const completions: Array<(result: Result) => void> = [];
	const processes: EventEmitter[] = [];
	const calls: Array<{ command: string; args: string[]; cwd: string }> = [];
	const pod = {
		processManager: Object.assign(events, { getProcess: (pid: number) => handles.get(pid) }),
		spawn(command: string, args: string[], { cwd }: { cwd: string }) {
			calls.push({ command, args, cwd });
			const pid = calls.length;
			handles.set(pid, { stdout: "", stderr: "", exitCode: 0 });
			events.emit("spawn", pid);
			const completion = new Promise<Result>((resolve) => completions.push(resolve));
			const process = Object.assign(new EventEmitter(), { completion });
			processes.push(process);
			return Promise.resolve(process);
		},
	};
	return { pod, events, handles, completions, calls, processes };
}

describe("NodePod command output capture", () => {
	test("keeps output sent only in the worker's exit payload", async () => {
		const f = fixture();
		const pending = captureNodePodProcess(f.pod, "echo", ["ready"]);
		expect(f.events.listenerCount("spawn")).toBe(0);
		Object.assign(f.handles.get(1)!, { stdout: "ready\n", stderr: "notice\n", exitCode: 3 });
		f.completions[0]({ stdout: "", stderr: "", exitCode: 3 });
		expect(await pending).toEqual({ stdout: "ready\n", stderr: "notice\n", exitCode: 3 });
		expect(f.calls).toEqual([{ command: "echo", args: ["ready"], cwd: "/workspace" }]);
	});

	test("does not duplicate streamed output in the final buffers", async () => {
		const f = fixture();
		const pending = captureNodePodProcess(f.pod, "node", ["example.js"]);
		const result = { stdout: "first\nsecond\n", stderr: "warning\n", exitCode: 0 };
		Object.assign(f.handles.get(1)!, result);
		f.completions[0](result);
		expect(await pending).toEqual(result);
	});

	test("isolates simultaneous identical commands completed in reverse order", async () => {
		const f = fixture();
		const first = captureNodePodProcess(f.pod, "echo", ["same"]);
		const second = captureNodePodProcess(f.pod, "echo", ["same"]);
		expect(f.events.listenerCount("spawn")).toBe(0);
		Object.assign(f.handles.get(1)!, { stdout: "first\n" });
		Object.assign(f.handles.get(2)!, { stdout: "second\n" });
		f.events.emit("spawn", 2); // An unrelated child must not replace either handle.
		f.completions[1]({ stdout: "", stderr: "", exitCode: 0 });
		f.completions[0]({ stdout: "", stderr: "", exitCode: 0 });
		expect((await first).stdout).toBe("first\n");
		expect((await second).stdout).toBe("second\n");
	});

	test("cleans up the observer when spawn throws", async () => {
		const f = fixture();
		f.pod.spawn = () => { throw new Error("process limit"); };
		await expect(captureNodePodProcess(f.pod, "echo", [])).rejects.toThrow("process limit");
		expect(f.events.listenerCount("spawn")).toBe(0);
	});

	test("accepts stderr error events and removes the listener after completion", async () => {
		const f = fixture();
		const pending = captureNodePodProcess(f.pod, "node", ["broken.js"]);
		await Promise.resolve();
		expect(() => f.processes[0].emit("error", "command failed\n")).not.toThrow();
		Object.assign(f.handles.get(1)!, { stderr: "command failed\n", exitCode: 1 });
		f.completions[0]({ stdout: "", stderr: "command failed\n", exitCode: 1 });
		expect(await pending).toEqual({ stdout: "", stderr: "command failed\n", exitCode: 1 });
		expect(f.processes[0].listenerCount("error")).toBe(0);
	});

	test("uses SDK completion if a future spawn emits its handle asynchronously", async () => {
		const f = fixture();
		const result = { stdout: "buffered\n", stderr: "", exitCode: 0 };
		f.pod.spawn = () => Promise.resolve(Object.assign(new EventEmitter(), { completion: Promise.resolve(result) }));
		expect(await captureNodePodProcess(f.pod, "echo", [])).toEqual(result);
	});
});
