import {
	nodePodGetAllFileContents,
	nodePodLoadSnapshotsFromDB,
	nodePodWriteTextFile,
	isNodePodActive,
} from "./nodepod-runtime";
import { persistSnapshot, type SnapshotRecord } from "./nodepod-snapshot-db";
import { exportSandboxVc, importSandboxVc, type SandboxVcExport } from "./lix-sandbox";

export interface PortableSnapshotRecord extends Omit<SnapshotRecord, "data"> {
	data: JsonValue;
}

export interface KeatingSandboxPortableBundle {
	schemaVersion: 1;
	kind: "keating-sandbox-portable";
	generatedAt: string;
	nodepod: {
		active: boolean;
		files: Array<{ path: string; content: string }>;
		snapshots: PortableSnapshotRecord[];
	};
	vc: SandboxVcExport;
}

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function bytesToBase64(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
	const binary = atob(base64);
	return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function encodeSnapshotData(value: unknown): JsonValue {
	if (value instanceof ArrayBuffer) {
		return { __keatingType: "ArrayBuffer", base64: bytesToBase64(new Uint8Array(value)) };
	}
	if (ArrayBuffer.isView(value)) {
		const view = value as ArrayBufferView;
		return {
			__keatingType: "TypedArray",
			name: view.constructor.name,
			base64: bytesToBase64(new Uint8Array(view.buffer, view.byteOffset, view.byteLength)),
		};
	}
	if (Array.isArray(value)) return value.map(encodeSnapshotData);
	if (value && typeof value === "object") {
		const out: Record<string, JsonValue> = {};
		for (const [key, nested] of Object.entries(value)) out[key] = encodeSnapshotData(nested);
		return out;
	}
	if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
		return value;
	}
	return null;
}

function decodeSnapshotData(value: JsonValue): unknown {
	if (Array.isArray(value)) return value.map(decodeSnapshotData);
	if (value && typeof value === "object") {
		const marker = value as Record<string, JsonValue>;
		if (marker.__keatingType === "ArrayBuffer" && typeof marker.base64 === "string") {
			return base64ToBytes(marker.base64).buffer;
		}
		if (marker.__keatingType === "TypedArray" && typeof marker.base64 === "string") {
			return base64ToBytes(marker.base64);
		}
		const out: Record<string, unknown> = {};
		for (const [key, nested] of Object.entries(value)) out[key] = decodeSnapshotData(nested);
		return out;
	}
	return value;
}

export async function buildSandboxPortableBundle(): Promise<KeatingSandboxPortableBundle> {
	const [snapshots, vc] = await Promise.all([
		nodePodLoadSnapshotsFromDB(),
		exportSandboxVc(),
	]);
	const files = isNodePodActive() ? await nodePodGetAllFileContents() : [];
	return {
		schemaVersion: 1,
		kind: "keating-sandbox-portable",
		generatedAt: new Date().toISOString(),
		nodepod: {
			active: isNodePodActive(),
			files,
			snapshots: snapshots.map((snapshot) => ({
				...snapshot,
				data: encodeSnapshotData(snapshot.data),
			})),
		},
		vc,
	};
}

export async function importSandboxPortableBundle(bundle: KeatingSandboxPortableBundle): Promise<{
	filesImported: number;
	snapshotsImported: number;
	commitsImported: number;
}> {
	if (!bundle || bundle.schemaVersion !== 1 || bundle.kind !== "keating-sandbox-portable") {
		throw new Error("Unsupported Keating sandbox portable bundle.");
	}
	if (isNodePodActive()) {
		for (const file of bundle.nodepod.files ?? []) {
			await nodePodWriteTextFile(file.path, file.content);
		}
	}
	for (const snapshot of bundle.nodepod.snapshots ?? []) {
		await persistSnapshot({
			...snapshot,
			data: decodeSnapshotData(snapshot.data),
		});
	}
	await importSandboxVc(bundle.vc);
	return {
		filesImported: isNodePodActive() ? bundle.nodepod.files.length : 0,
		snapshotsImported: bundle.nodepod.snapshots.length,
		commitsImported: bundle.vc.commits.length,
	};
}
