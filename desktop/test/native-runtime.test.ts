import { nativeSenderAuthorized } from "../src/native-policy.js";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { promises as fs } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	NativeWorkspaceService,
	nativeProcessEnvironment,
	nativeRequestAuthorized,
	nativeWorkspacePath,
	startNativeRuntime,
} from "../src/native-runtime.js";

let root: string;
let service: NativeWorkspaceService;
beforeEach(async () => {
	root = await fs.mkdtemp(join(tmpdir(), "keating-native-test-"));
	service = new NativeWorkspaceService(root);
});
afterEach(async () => {
	await service.stop();
	await fs.rm(root, { recursive: true, force: true });
});

describe("native workspace boundaries", () => {
	test("persistent files can be listed, read, uniquely edited and deleted", async () => {
		await service.execute("fs.write", {
			path: "/workspace/src/a.txt",
			content: "one two",
		});
		expect(
			await service.execute("fs.read", { path: "src/a.txt" }),
		).toMatchObject({ content: "one two", encoding: "utf8" });
		expect(await service.execute("fs.list", { path: "src" })).toEqual([
			{ name: "a.txt", path: "src/a.txt", size: 7, isDir: false },
		]);
		await service.execute("fs.edit", {
			path: "src/a.txt",
			search: "two",
			replace: "$& three",
		});
		expect(
			await service.execute("fs.read", { path: "src/a.txt" }),
		).toMatchObject({ content: "one $& three" });
		await expect(
			service.execute("fs.edit", {
				path: "src/a.txt",
				search: "missing",
				replace: "x",
			}),
		).rejects.toThrow("exactly once");
		await service.execute("fs.delete", { path: "src/a.txt" });
		expect(await service.execute("fs.list", { path: "src" })).toEqual([]);
	});
	test("rejects traversal, deleting root, external symlinks and dangling symlinks", async () => {
		await expect(nativeWorkspacePath(root, "../outside")).rejects.toThrow(
			"inside",
		);
		await expect(
			service.execute("fs.delete", { path: root, recursive: true }),
		).rejects.toThrow("inside");
		await fs.symlink(tmpdir(), join(root, "escape"));
		await expect(
			service.execute("fs.write", { path: "escape/leak.txt", content: "no" }),
		).rejects.toThrow("Symlink");
		await fs.symlink(
			join(tmpdir(), "missing-native-target-xyz"),
			join(root, "dangling"),
		);
		await expect(nativeWorkspacePath(root, "dangling/new.txt")).rejects.toThrow(
			"Dangling",
		);
	});
	test("file and process inputs have explicit bounds", async () => {
		await expect(
			service.execute("fs.write", {
				path: "large",
				content: "x".repeat(1048577),
			}),
		).rejects.toThrow("limit");
		await expect(
			service.execute("shell.exec", { command: "echo", timeoutMs: 1800001 }),
		).rejects.toThrow("Timeout");
		await expect(
			service.execute("shell.exec", {
				command: "echo",
				args: ["ok"],
				shell: true,
			}),
		).rejects.toThrow("also provide");
		await expect(service.execute("other", {})).rejects.toThrow("Unsupported");
	});
	test("process inheritance excludes application credentials", () => {
		process.env.KEATING_NATIVE_TEST_SECRET = "should-not-inherit";
		try {
			expect(nativeProcessEnvironment({ LOCAL_VALUE: "ok" })).toMatchObject({
				LOCAL_VALUE: "ok",
			});
			expect(
				nativeProcessEnvironment(undefined).KEATING_NATIVE_TEST_SECRET,
			).toBeUndefined();
		} finally {
			delete process.env.KEATING_NATIVE_TEST_SECRET;
		}
		expect(() => nativeProcessEnvironment({ BAD: 4 })).toThrow();
	});
	test("HTTP auth requires exact host, token, method, path and no browser origin", () => {
		const request = {
			method: "POST",
			url: "/execute",
			headers: { host: "127.0.0.1:1234", authorization: "Bearer abc" },
		};
		expect(nativeRequestAuthorized(request, "127.0.0.1:1234", "abc")).toBe(
			true,
		);
		for (const headers of [
			{ ...request.headers, origin: "http://localhost:3000" },
			{ ...request.headers, host: "evil.test" },
			{ ...request.headers, authorization: "Bearer abd" },
		])
			expect(
				nativeRequestAuthorized(
					{ ...request, headers },
					"127.0.0.1:1234",
					"abc",
				),
			).toBe(false);
		expect(
			nativeRequestAuthorized(
				{ ...request, method: "GET" },
				"127.0.0.1:1234",
				"abc",
			),
		).toBe(false);
	});
	test("native IPC accepts only the exact trusted main frame", () => {
		const mainFrame = { url: "http://localhost:3000/chat" };
		const window = { webContents: { mainFrame } };
		const event = { sender: window.webContents, senderFrame: mainFrame };
		expect(nativeSenderAuthorized(event, window, "http://localhost:3000")).toBe(
			true,
		);
		expect(
			nativeSenderAuthorized(
				{ ...event, senderFrame: { ...mainFrame } },
				window,
				"http://localhost:3000",
			),
		).toBe(false);
		expect(
			nativeSenderAuthorized(
				{ ...event, sender: {} },
				window,
				"http://localhost:3000",
			),
		).toBe(false);
		expect(
			nativeSenderAuthorized(
				{ ...event, senderFrame: null },
				window,
				"http://localhost:3000",
			),
		).toBe(false);
		mainFrame.url = "https://evil.test/chat";
		expect(nativeSenderAuthorized(event, window, "http://localhost:3000")).toBe(
			false,
		);
	});
	test("binary files require explicit base64 reads", async () => {
		await fs.writeFile(join(root, "binary"), Buffer.from([0xff, 0xfe]));
		await expect(
			service.execute("fs.read", { path: "binary", encoding: "utf8" }),
		).rejects.toThrow();
		expect(
			await service.execute("fs.read", { path: "binary", encoding: "base64" }),
		).toMatchObject({ content: "//4=", encoding: "base64" });
	});

	test("shutdown prevents subsequent native work", async () => {
		await service.stop();
		await expect(service.execute("runtime.ping", {})).rejects.toThrow(
			"shutting down",
		);
	});
});

describe("native execution", () => {
	test("executes an installed process with literal arguments and separate streams", async () => {
		const output = (await service.execute("shell.exec", {
			command: process.execPath,
			args: [
				"-e",
				"process.stdout.write(process.argv[1]); process.stderr.write('error')",
				"$(not-a-command)",
			],
			timeoutMs: 10000,
		})) as Record<string, unknown>;
		expect(output).toMatchObject({
			stdout: "$(not-a-command)",
			stderr: "error",
			exitCode: 0,
			running: false,
			timedOut: false,
			truncated: false,
		});
	});
	test("interactive process receives stdin, remains pollable and can be stopped in Node", () => {
		// Exercise the same Node pipe implementation used by Electron.
		const script = `
   import { NativeWorkspaceService } from ${JSON.stringify(new URL("../src/native-runtime.ts", import.meta.url).href)};
   const service = new NativeWorkspaceService(${JSON.stringify(root)});
   try {
    const {processId} = await service.execute("process.start", {command:"cat",args:[],timeoutMs:10000});
    await service.execute("process.write", {processId,input:"hello"});
    let snapshot;
    for(let i=0;i<100;i++){snapshot=await service.execute("process.poll",{processId});if(snapshot.stdout==="hello")break;await new Promise(r=>setTimeout(r,10));}
    if(snapshot.stdout!=="hello" || !snapshot.running)throw new Error("Interactive stdin failed");
    const stopped=await service.execute("process.stop",{processId});
    if(stopped.running)throw new Error("Stop failed");
   }finally{await service.stop();}
  `;
		expect(() =>
			execFileSync(
				"node",
				["--experimental-transform-types", "--input-type=module", "-e", script],
				{ timeout: 15000, stdio: "pipe" },
			),
		).not.toThrow();
	});
	test("preserves Unicode split across native stdout and stderr chunks", async () => {
		const code =
			"const fs=require('node:fs');fs.writeSync(1,Buffer.from([0xf0,0x9f]));fs.writeSync(2,Buffer.from([0xc3]));setTimeout(()=>{fs.writeSync(1,Buffer.from([0x8c,0xb1]));fs.writeSync(2,Buffer.from([0xa9]));},50)";
		const output = await service.execute("shell.exec", {
			command: "node",
			args: ["-e", code],
			timeoutMs: 5000,
		});
		expect(output).toMatchObject({
			stdout: "🌱",
			stderr: "é",
			exitCode: 0,
			stdoutTruncated: false,
			stderrTruncated: false,
		});
	});

	test("timeout and output limits are enforced", async () => {
		expect(
			await service.execute("shell.exec", {
				command: process.execPath,
				args: ["-e", "setInterval(()=>{},1000)"],
				timeoutMs: 50,
			}),
		).toMatchObject({ timedOut: true, running: false });
		const output = (await service.execute("shell.exec", {
			command: process.execPath,
			args: ["-e", "process.stdout.write('x'.repeat(2*1024*1024))"],
			timeoutMs: 10000,
		})) as { stdout: string; stdoutTruncated: boolean };
		expect(output.stdout.length).toBe(1048576);
		expect(output.stdoutTruncated).toBe(true);
	});
	test("exclusive creation cannot replace a file and stdinClosed delivers EOF", async () => {
		await service.execute("fs.write", {
			path: "existing",
			content: "original",
			exclusive: true,
		});
		await expect(
			service.execute("fs.write", {
				path: "existing",
				content: "replacement",
				exclusive: true,
			}),
		).rejects.toThrow();
		expect(
			await service.execute("fs.read", { path: "existing" }),
		).toMatchObject({ content: "original" });
		const { processId } = (await service.execute("process.start", {
			command: "cat",
			args: [],
			stdinClosed: true,
			timeoutMs: 1000,
		})) as { processId: string };
		let snapshot: Record<string, unknown> = {};
		for (let i = 0; i < 100; i++) {
			snapshot = (await service.execute("process.poll", {
				processId,
			})) as Record<string, unknown>;
			if (!snapshot.running) break;
			await new Promise((r) => setTimeout(r, 10));
		}
		expect(snapshot).toMatchObject({
			running: false,
			exitCode: 0,
			timedOut: false,
		});
		const { stdout: _stdout, stderr: _stderr, ...metadata } = snapshot;
		expect(await service.execute("process.list", {})).toEqual([metadata]);
	});

	test("missing executables reject process start", async () => {
		await expect(
			service.execute("process.start", {
				command: "keating-nonexistent-test-executable",
				args: [],
			}),
		).rejects.toThrow();
	});
	test("server transports operations and closes cleanly", async () => {
		const runtime = await startNativeRuntime(root);
		try {
			expect(await runtime.execute("runtime.ping", {})).toMatchObject({
				ok: true,
				projectRoot: root,
			});
			await runtime.execute("fs.write", {
				path: "through-server",
				content: "ok",
			});
			expect(await fs.readFile(join(root, "through-server"), "utf8")).toBe(
				"ok",
			);
		} finally {
			await runtime.stop();
		}
	});
});
