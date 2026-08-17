import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const peer = process.env.GUN_RELAY_URL?.trim() || "http://127.0.0.1:8765/gun";
const role = process.argv[2];
const key = process.argv[3];

if (role === "reader" || role === "writer") {
	if (!key) throw new Error("A smoke-test record key is required.");
	const { default: WebSocket } = await import("ws");
	globalThis.WebSocket = WebSocket;
	const { default: Gun } = await import("gun/gun.js");
	const gun = Gun({ peers: [peer], WebSocket, localStorage: false, radisk: false, multicast: false });
	if (role === "reader") {
		const timeout = setTimeout(() => {
			console.error("Reader timed out waiting for the relay.");
			process.exit(1);
		}, 10_000);
		gun.get(key).on((value) => {
			if (value?.message !== "encrypted-sync-ok") return;
			clearTimeout(timeout);
			console.log("reader-ok");
			process.exit(0);
		});
	} else {
		const timeout = setTimeout(() => {
			console.error("Writer timed out waiting for the relay acknowledgement.");
			process.exit(1);
		}, 10_000);
		gun.get(key).put({ message: "encrypted-sync-ok" }, (ack) => {
			if (ack?.err) {
				clearTimeout(timeout);
				console.error(ack.err);
				process.exit(1);
			}
			clearTimeout(timeout);
			setTimeout(() => process.exit(0), 750);
		});
	}
} else {
	const script = fileURLToPath(import.meta.url);
	const recordKey = `keating-relay-smoke-${Date.now()}`;
	const childEnvironment = { ...process.env, GUN_RELAY_URL: peer };
	const reader = spawn(process.execPath, [script, "reader", recordKey], {
		env: childEnvironment,
		stdio: ["ignore", "pipe", "inherit"],
	});
	let readerOutput = "";
	reader.stdout.on("data", (chunk) => {
		readerOutput += String(chunk);
	});
	const readerExit = new Promise((resolve) => reader.once("exit", resolve));
	await new Promise((resolve) => setTimeout(resolve, 400));
	const writer = spawn(process.execPath, [script, "writer", recordKey], {
		env: childEnvironment,
		stdio: "inherit",
	});
	const writerCode = await new Promise((resolve) => writer.once("exit", resolve));
	const readerCode = await readerExit;
	if (writerCode !== 0 || readerCode !== 0 || !readerOutput.includes("reader-ok")) {
		throw new Error(`GUN relay smoke failed (writer=${writerCode}, reader=${readerCode}).`);
	}
	console.log("two-client-relay-ok");
}
