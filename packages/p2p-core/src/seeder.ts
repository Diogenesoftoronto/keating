#!/usr/bin/env bun
/**
 * Headless always-on seeder ("Option B" cloud node).
 *
 * It is just another peer: it joins the same swarm topic and replicates +
 * persists every core so a user's data is available even when none of their
 * devices are online. It never writes (`seedOnly: true`).
 *
 * Run:  bun run src/seeder.ts
 * Env:
 *   KEATING_SEEDER_STORAGE   on-disk path for Corestore data (required)
 *   KEATING_USER_SECRET      hex-encoded 32-byte per-user secret (required)
 *   KEATING_SEEDER_LABEL     optional log label
 *
 * Deploy on any always-on Node host (Fly.io, Railway, a VPS). A single seeder
 * process can host one user; run one process per user-secret, or extend to a
 * multi-tenant variant that opens one P2PStore per secret.
 */
import b4a from "b4a";
import { P2PStore } from "./store.js";

function requireEnv(name: string): string {
	const v = process.env[name];
	if (!v) throw new Error(`Missing required env var ${name}`);
	return v;
}

function log(label: string, msg: string): void {
	// eslint-disable-next-line no-console
	console.log(`[keating-seeder:${label}] ${msg}`);
}

function parseHexSecret(hex: string): Uint8Array {
	const trimmed = hex.trim();
	if (!/^[0-9a-fA-F]+$/.test(trimmed)) {
		throw new Error("KEATING_USER_SECRET must be hex-encoded");
	}
	const buf = b4a.from(trimmed, "hex");
	if (buf.length !== 32) {
		throw new Error(`KEATING_USER_SECRET must be 32 bytes (got ${buf.length})`);
	}
	return buf;
}

async function main(): Promise<void> {
	const storageDir = requireEnv("KEATING_SEEDER_STORAGE");
	const userSecretHex = requireEnv("KEATING_USER_SECRET");
	const label = process.env.KEATING_SEEDER_LABEL ?? "seeder";

	const userSecret = parseHexSecret(userSecretHex);

	log(label, `opening corestore at ${storageDir} (seedOnly=true)`);
	const store = await P2PStore.open({
		storageDir,
		userSecret,
		seedOnly: true,
		label,
	});

	const logStats = () => {
		try {
			const s = store.stats();
			log(
				label,
				`stats peers=${s.peers} writableLength=${s.writableLength} connected=${s.connected} topic=${s.topicHex.slice(0, 12)}…`,
			);
		} catch (err) {
			log(label, `stats error: ${(err as Error).message}`);
		}
	};

	// Best-effort peer-change logging. P2PStore exposes stats; we poll
	// periodically since the underlying swarm listener is internal.
	let lastPeers = -1;
	const onChange = () => {
		const current = store.stats().peers;
		if (current !== lastPeers) {
			lastPeers = current;
			log(label, `peer count changed: ${current}`);
		}
	};

	const interval = setInterval(() => {
		logStats();
		onChange();
	}, 30_000);
	// Don't keep the event loop alive solely for this timer (we also keep it
	// alive via the swarm below).
	if (typeof interval.unref === "function") interval.unref();

	const shutdown = async (sig: NodeJS.Signals) => {
		log(label, `received ${sig}, shutting down...`);
		clearInterval(interval);
		try {
			await store.close();
		} catch (err) {
			log(label, `close error: ${(err as Error).message}`);
		}
		log(label, "bye");
		process.exit(0);
	};

	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);

	// Keep the process alive — the swarm keeps the event loop running, but we
	// add an explicit noop interval as a belt-and-braces guard.
	const keepAlive = setInterval(() => {}, 60_000);
	if (typeof keepAlive.unref === "function") keepAlive.unref();

	log(label, "ready; replicating cores (Ctrl-C to exit)");
}

main().catch((err) => {
	// eslint-disable-next-line no-console
	console.error("[keating-seeder] fatal:", err);
	process.exit(1);
});