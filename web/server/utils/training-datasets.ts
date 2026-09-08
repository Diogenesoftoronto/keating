import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { CanonicalTrainingRecordSchema, TrainingManifestSchema } from "../../src/keating/training-schema";

export const TRAINING_DATASET_CONSENT = "global-improvement-v1";
export const MAX_TRAINING_DATASET_BYTES = 25 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 100 * 1024 * 1024;

export class TrainingDatasetError extends Error {
 constructor(readonly statusCode: number, message: string) { super(message); }
}
const invalid = () => new TrainingDatasetError(400, "Choose a valid Keating training dataset ZIP.");

export interface TrainingDatasetReceipt {
 id: string;
 createdAt: string;
 sha256: string;
 sizeBytes: number;
 recordCount: number;
 purpose: "global_improvement";
 consentVersion: typeof TRAINING_DATASET_CONSENT;
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
 let value = index;
 for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
 return value >>> 0;
});
function crc32(bytes: Uint8Array): number {
 let value = 0xffffffff;
 for (const byte of bytes) value = (value >>> 8) ^ CRC_TABLE[(value ^ byte) & 0xff];
 return (value ^ 0xffffffff) >>> 0;
}

/** Read ZIP entries without extracting paths; limit expansion before decompression. */
export function validateTrainingDataset(bytes: Uint8Array): { recordCount: number } {
 if (!bytes.length || bytes.length > MAX_TRAINING_DATASET_BYTES) throw new TrainingDatasetError(413, "Dataset ZIPs must be between 1 byte and 25 MiB.");
 try {
  const zip = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = zip.length - 22;
  for (; end >= Math.max(0, zip.length - 65557); end--) if (zip.readUInt32LE(end) === 0x06054b50 && end + 22 + zip.readUInt16LE(end + 20) === zip.length) break;
  if (end < 0 || zip.readUInt32LE(end) !== 0x06054b50 || zip.readUInt16LE(end + 4) !== 0 || zip.readUInt16LE(end + 6) !== 0) throw invalid();
  const count = zip.readUInt16LE(end + 10);
  const directorySize = zip.readUInt32LE(end + 12);
  const directoryStart = zip.readUInt32LE(end + 16);
  if (!count || count > 64 || count !== zip.readUInt16LE(end + 8) || directoryStart + directorySize !== end) throw invalid();
  const entries = new Map<string, Buffer>();
  let cursor = directoryStart;
  let expanded = 0;
  for (let index = 0; index < count; index++) {
   if (zip.readUInt32LE(cursor) !== 0x02014b50) throw invalid();
   const flags = zip.readUInt16LE(cursor + 8);
   const method = zip.readUInt16LE(cursor + 10);
   const expectedCrc = zip.readUInt32LE(cursor + 16);
   const compressed = zip.readUInt32LE(cursor + 20);
   const size = zip.readUInt32LE(cursor + 24);
   const nameLength = zip.readUInt16LE(cursor + 28);
   const extraLength = zip.readUInt16LE(cursor + 30);
   const commentLength = zip.readUInt16LE(cursor + 32);
   const local = zip.readUInt32LE(cursor + 42);
   const name = zip.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
   if ((flags & 0x41) || ![0, 8].includes(method) || zip.readUInt16LE(cursor + 34) !== 0 || ((zip.readUInt32LE(cursor + 38) >>> 16) & 0xf000) === 0xa000) throw invalid();
   if (name.length > 200 || !/^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*){0,7}\.(?:json|jsonl|md)$/.test(name) || name.split("/").some((part) => part === "." || part === "..") || entries.has(name)) throw invalid();
   expanded += size;
   if (expanded > MAX_EXPANDED_BYTES) throw new TrainingDatasetError(413, "Expanded dataset exceeds 100 MiB.");
   if (zip.readUInt32LE(local) !== 0x04034b50 || zip.readUInt16LE(local + 6) !== flags || zip.readUInt16LE(local + 8) !== method) throw invalid();
   const localNameLength = zip.readUInt16LE(local + 26);
   const start = local + 30 + localNameLength + zip.readUInt16LE(local + 28);
   if (zip.subarray(local + 30, local + 30 + localNameLength).toString("utf8") !== name || start + compressed > directoryStart) throw invalid();
   const payload = zip.subarray(start, start + compressed);
   const data = method === 0 ? payload : inflateRawSync(payload, { maxOutputLength: Math.max(1, size) });
   if (data.length !== size || crc32(data) !== expectedCrc) throw invalid();
   entries.set(name, data);
   cursor += 46 + nameLength + extraLength + commentLength;
   if (cursor > end) throw invalid();
  }
  if (cursor !== end) throw invalid();
  const manifestBytes = entries.get("manifest.json");
  const canonical = entries.get("data/keating.training.jsonl");
  if (!manifestBytes || manifestBytes.length > 1024 * 1024 || !canonical) throw invalid();
  const manifest = TrainingManifestSchema.parse(JSON.parse(manifestBytes.toString("utf8")));
  const lines = canonical.toString("utf8").split("\n").filter((line) => line.trim());
  if (!lines.length || lines.length > 100000 || lines.length !== manifest.counts.canonicalRecords) throw invalid();
  for (const line of lines) {
   if (line.length > 2 * 1024 * 1024) throw invalid();
   CanonicalTrainingRecordSchema.parse(JSON.parse(line));
  }
  return { recordCount: lines.length };
 } catch (error) {
  if (error instanceof TrainingDatasetError) throw error;
  throw invalid();
 }
}

async function syncFile(path: string, bytes: Uint8Array | string): Promise<void> {
 const file = await open(path, "wx", 0o600);
 try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
}
async function syncDirectory(path: string): Promise<void> {
 const directory = await open(path, "r");
 try { await directory.sync(); } finally { await directory.close(); }
}

export async function saveTrainingDataset(bytes: Uint8Array, accountId: string, storageDir: string | undefined): Promise<TrainingDatasetReceipt> {
 if (!storageDir || !isAbsolute(storageDir)) throw new TrainingDatasetError(503, "Dataset sharing requires configured persistent storage.");
 if (!accountId || accountId.length > 512) throw new TrainingDatasetError(401, "Sign in before sharing a dataset.");
 const { recordCount } = validateTrainingDataset(bytes);
 const receipt: TrainingDatasetReceipt = {
  id: `dataset_${randomUUID().replaceAll("-", "")}`, createdAt: new Date().toISOString(),
  sha256: createHash("sha256").update(bytes).digest("hex"), sizeBytes: bytes.length, recordCount,
  purpose: "global_improvement", consentVersion: TRAINING_DATASET_CONSENT,
 };
 const pending = join(storageDir, `.${receipt.id}.pending`);
 try {
  await mkdir(storageDir, { recursive: true, mode: 0o700 });
  await mkdir(pending, { mode: 0o700 });
  await syncFile(join(pending, "dataset.zip"), bytes);
  await syncFile(join(pending, "metadata.json"), JSON.stringify({ schemaVersion: 1, ...receipt, accountId, consent: { version: TRAINING_DATASET_CONSENT, purpose: "global_improvement", acceptedAt: receipt.createdAt } }, null, 2));
  await syncDirectory(pending);
  await rename(pending, join(storageDir, receipt.id));
  await syncDirectory(storageDir);
  return receipt;
 } catch {
  await rm(pending, { recursive: true, force: true }).catch(() => {});
  throw new TrainingDatasetError(503, "Dataset storage is unavailable. No upload receipt was issued.");
 }
}

export async function receiveTrainingDataset(request: Request, dependencies: {
 resolveAccount: () => Promise<string | null>;
 storageDir?: string;
}): Promise<TrainingDatasetReceipt> {
 const origin = request.headers.get("origin");
 if (origin && origin !== new URL(request.url).origin) throw new TrainingDatasetError(403, "Cross-origin uploads are not allowed.");
 if (request.method !== "POST") throw new TrainingDatasetError(405, "Use POST to share a dataset.");
 if (request.headers.get("x-keating-training-consent") !== TRAINING_DATASET_CONSENT) throw new TrainingDatasetError(400, "Explicit global-improvement consent is required.");
 const accountId = await dependencies.resolveAccount();
 if (!accountId) throw new TrainingDatasetError(401, "Sign in before sharing a dataset.");
 if (!dependencies.storageDir || !isAbsolute(dependencies.storageDir)) throw new TrainingDatasetError(503, "Dataset sharing requires configured persistent storage.");
 if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/zip") throw new TrainingDatasetError(415, "Upload a dataset ZIP.");
 const declared = request.headers.get("content-length");
 if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_TRAINING_DATASET_BYTES)) throw new TrainingDatasetError(413, "Dataset ZIPs must be 25 MiB or smaller.");
 const reader = request.body?.getReader();
 if (!reader) throw invalid();
 const chunks: Uint8Array[] = [];
 let size = 0;
 try {
  for (;;) {
   const { done, value } = await reader.read();
   if (done) break;
   size += value.byteLength;
   if (size > MAX_TRAINING_DATASET_BYTES) { await reader.cancel(); throw new TrainingDatasetError(413, "Dataset ZIPs must be 25 MiB or smaller."); }
   chunks.push(value);
  }
 } finally { reader.releaseLock(); }
 return saveTrainingDataset(Buffer.concat(chunks, size), accountId, dependencies.storageDir);
}
