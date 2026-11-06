import { getAppStorage } from "../app-storage";
import { getInitPromise, sessions } from "../../hooks/keating-storage";
import { getNotOrganicAccount, notOrganicPublicClient } from "../../notorganic-provider";
import { PROVIDER_CREDENTIALS_CHANGED_EVENT } from "../model-prefs";
import { BrowserChatSyncLocalStore, CHAT_SYNC_IMPORTED_EVENT } from "./chat-sync-local";
import { CHAT_SYNC_LOCAL_CHANGE_EVENT } from "./chat-sync-journal";
import { ChatRecordSyncController, type ChatRecordSyncCheckpoint } from "./chat-record-sync-controller";
import { ChatSyncRecordsClient } from "./chat-sync-records";
import { deriveAccountSyncNamespace, IndexedDbAccountSyncKeyStore } from "./device-identity";
import { unlockAccountSyncKeyWithLogin } from "./account-key-broker";
import { CHAT_SYNC_RETRY_EVENT, setChatSyncStatus } from "./chat-sync-status";

/** One lifecycle per app, with a durable cursor/outbox shared under an account Web Lock. */
export function startBrowserChatSync(): () => void {
	let disposed = false;
	let generation = 0;
	let identity: string | null = null;
	let controller: ChatRecordSyncController | undefined;
	let accountNamespace: string | undefined;
	let starting: Promise<void> | undefined;
	let debounce: ReturnType<typeof setTimeout> | undefined;
	let poll: ReturnType<typeof setTimeout> | undefined;
	let idleRounds = 0;
	const writer = crypto.randomUUID();
	const client = notOrganicPublicClient();
	const sessionIdentity = () => {
		const session = client?.getSession();
		return session ? session.id ?? session.refreshToken ?? session.accessToken : null;
	};
	const stop = () => {
		generation++;
		controller?.dispose(); controller = undefined;
		identity = null; accountNamespace = undefined;
	};
	const sync = async () => {
		const active = controller;
		const namespace = accountNamespace;
		if (!active || !namespace) return;
		const run = async () => { if (!disposed && active === controller) await active.request(); };
		if (navigator.locks) await navigator.locks.request(`keating-chat-sync:${namespace}`, run);
		else await run();
	};
	const refresh = async () => {
		if (disposed) return;
		let next: string | null;
		try { next = sessionIdentity(); } catch { stop(); setChatSyncStatus({ phase: "error" }); return; }
		if (next !== identity) stop();
		if (!next || !client) { setChatSyncStatus({ phase: "signed-out" }); return; }
		if (!["sync:key:read", "sync:read", "sync:write"].every(scope => client.getSession()?.scope.split(/\s+/).includes(scope))) {
			setChatSyncStatus({ phase: "reconnect" }); return;
		}
		if (controller) {
			try {
				await client.activeSession();
				if (next === sessionIdentity()) await sync();
				else { stop(); setChatSyncStatus({ phase: "signed-out" }); }
			} catch { if (!disposed) setChatSyncStatus({ phase: "error" }); }
			return;
		}
		if (starting) return;
		identity = next;
		const run = generation;
		const current = () => !disposed && generation === run && sessionIdentity() === next;
		setChatSyncStatus({ phase: "syncing" });
		starting = (async () => {
			try {
				const account = await getNotOrganicAccount();
				if (!current()) return;
				if (!account.did) throw new Error("The verified account has no sync identity.");
				await getInitPromise();
				if (!current()) return;
				const namespace = await deriveAccountSyncNamespace(account.did);
				const keys = new IndexedDbAccountSyncKeyStore(namespace);
				const key = await unlockAccountSyncKeyWithLogin({ did: account.did, requester: client });
				if (!current()) return;
				await keys.save(key, { active: true });
				const backend = getAppStorage().backend;
				const checkpointKey = `keating:chat-record-sync:${namespace}`;
				const local = new BrowserChatSyncLocalStore(backend, account.did, writer, current, ids => {
					window.dispatchEvent(new CustomEvent("keating:sessions-changed"));
					window.dispatchEvent(new CustomEvent(CHAT_SYNC_IMPORTED_EVENT, { detail: { ids } }));
				});
				await local.bind();
				if (!current()) return;
				sessions.enableAccountSyncTracking(account.did);
				accountNamespace = namespace;
				controller = new ChatRecordSyncController({
					remote: new ChatSyncRecordsClient(client), key, keys, namespace, local,
					loadCheckpoint: () => backend.get<ChatRecordSyncCheckpoint>("settings", checkpointKey),
					saveCheckpoint: checkpoint => backend.transaction(["settings"], "readwrite", async tx => {
						if (!current()) throw new Error("Chat sync account changed.");
						await tx.set("settings", checkpointKey, checkpoint);
						if (!current()) throw new Error("Chat sync account changed.");
					}),
					isCurrent: current,
					onStatus: phase => { if (current()) setChatSyncStatus({ phase, ...(phase === "synced" ? { lastSyncedAt: Date.now() } : {}) }); },
				});
				await sync();
			} catch {
				if (current()) setChatSyncStatus({ phase: "error" });
			} finally { starting = undefined; }
		})();
		await starting;
	};
	// Quiet, visible tabs back off to once a minute. Hidden tabs do no polling.
	const schedule = () => {
		if (poll) clearTimeout(poll);
		if (disposed || document.visibilityState === "hidden") return;
		poll = setTimeout(() => {
			idleRounds++;
			if (debounce) schedule();
			else void refresh().finally(schedule);
		}, Math.min(60_000, 15_000 * (idleRounds + 1)));
	};
	const request = () => { if (debounce) return; idleRounds = 0; void refresh().finally(schedule); };
	const changed = () => {
		idleRounds = 0;
		if (debounce) clearTimeout(debounce);
		debounce = setTimeout(() => { debounce = undefined; request(); }, 2_000);
	};
	const visible = () => {
		if (document.visibilityState === "visible") request();
		else if (poll) clearTimeout(poll);
	};
	window.addEventListener(PROVIDER_CREDENTIALS_CHANGED_EVENT, request);
	window.addEventListener(CHAT_SYNC_RETRY_EVENT, request);
	window.addEventListener(CHAT_SYNC_LOCAL_CHANGE_EVENT, changed);
	window.addEventListener("online", request);
	window.addEventListener("focus", request);
	window.addEventListener("storage", request);
	document.addEventListener("visibilitychange", visible);
	request();
	return () => {
		disposed = true; stop();
		if (debounce) clearTimeout(debounce);
		if (poll) clearTimeout(poll);
		window.removeEventListener(PROVIDER_CREDENTIALS_CHANGED_EVENT, request);
		window.removeEventListener(CHAT_SYNC_RETRY_EVENT, request);
		window.removeEventListener(CHAT_SYNC_LOCAL_CHANGE_EVENT, changed);
		window.removeEventListener("online", request);
		window.removeEventListener("focus", request);
		window.removeEventListener("storage", request);
		document.removeEventListener("visibilitychange", visible);
	};
}
