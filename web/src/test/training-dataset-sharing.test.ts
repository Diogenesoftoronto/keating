import { afterEach, expect, it } from "bun:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, unzipSync, zipSync } from "fflate";
import { H3 } from "h3";
import { buildWebFineTuneExportFromSources } from "../keating/export";
import { buildWebTrainingArchive } from "../keating/training-archive";
import uploadDataset from "../../server/api/training-datasets/index.post";
import { MAX_TRAINING_DATASET_BYTES, receiveTrainingDataset, TRAINING_DATASET_CONSENT, validateTrainingDataset } from "../../server/utils/training-datasets";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))); });
async function directory() { const path = await mkdtemp(join(tmpdir(), "keating-dataset-test-")); directories.push(path); return path; }
async function archive() {
 const result = await buildWebFineTuneExportFromSources({ plans: [{ id: "p1", topic: "Fractions", content: "Explain equal portions.", createdAt: 0, updatedAt: 0 }] }, { source: "artifacts", format: "both", redact: true, minAssistantChars: 1 });
 return buildWebTrainingArchive(result).bytes;
}
function request(bytes: Uint8Array, headers: Record<string, string> = {}) {
 return new Request("https://keating.example/api/training-datasets", { method: "POST", headers: { "content-type": "application/zip", "x-keating-training-consent": TRAINING_DATASET_CONSENT, ...headers }, body: Uint8Array.from(bytes).buffer });
}

it("stores a validated archive privately and returns a durable receipt with consent and owner metadata", async () => {
 const storageDir = await directory();
 const bytes = await archive();
 const receipt = await receiveTrainingDataset(request(bytes), { storageDir, resolveAccount: async () => "account-123" });
 expect(receipt).toMatchObject({ recordCount: 1, sizeBytes: bytes.length, purpose: "global_improvement", consentVersion: TRAINING_DATASET_CONSENT });
 expect(receipt.sha256).toMatch(/^[a-f0-9]{64}$/);
 expect(await readdir(storageDir)).toEqual([receipt.id]);
 expect(new Uint8Array(await readFile(join(storageDir, receipt.id, "dataset.zip")))).toEqual(Uint8Array.from(bytes));
 expect(JSON.parse(await readFile(join(storageDir, receipt.id, "metadata.json"), "utf8"))).toMatchObject({ accountId: "account-123", consent: { version: TRAINING_DATASET_CONSENT, purpose: "global_improvement" }, sha256: receipt.sha256 });
});

it("requires explicit consent, same-origin requests and a server-resolved account", async () => {
 const storageDir = await directory();
 const bytes = await archive();
 await expect(receiveTrainingDataset(request(bytes, { "x-keating-training-consent": "" }), { storageDir, resolveAccount: async () => "owner" })).rejects.toMatchObject({ statusCode: 400 });
 await expect(receiveTrainingDataset(request(bytes, { origin: "https://attacker.example" }), { storageDir, resolveAccount: async () => "owner" })).rejects.toMatchObject({ statusCode: 403 });
 await expect(receiveTrainingDataset(request(bytes, { "x-account-id": "forged" }), { storageDir, resolveAccount: async () => null })).rejects.toMatchObject({ statusCode: 401 });
 expect(await readdir(storageDir)).toEqual([]);
});

it("checks consent and sign-in behind the Railway edge before accepting any dataset body", async () => {
 const originalRailway = process.env.RAILWAY_ENVIRONMENT_ID;
 process.env.RAILWAY_ENVIRONMENT_ID = "test-environment";
 try {
  let accountChecks = 0;
  const server = new H3().use(event => {
   event.context.notOrganicSessionAdapter = { getProductSession: async () => { accountChecks++; return null; } };
  }).post("/api/training-datasets", uploadDataset);
  for (const host of ["chat.keating.help", "keating-staging.up.railway.app"]) {
   const send = (headers: Record<string, string>) => server.fetch(new Request(`http://${host}/api/training-datasets`, {
    method: "POST", headers: { origin: `https://${host}`, "x-forwarded-proto": "https", ...headers },
   }));
   const consent = { "x-keating-training-consent": TRAINING_DATASET_CONSENT };
   expect((await send({})).status).toBe(400);
   expect((await send(consent)).status).toBe(401);
   expect((await send({ ...consent, origin: "https://another.test", "x-forwarded-host": "another.test" })).status).toBe(403);
  }
  expect(accountChecks).toBe(2);
 } finally {
  if (originalRailway === undefined) delete process.env.RAILWAY_ENVIRONMENT_ID;
  else process.env.RAILWAY_ENVIRONMENT_ID = originalRailway;
 }
});

it("fails closed without configured durable storage and rejects upload size and type", async () => {
 const bytes = await archive();
 const storageDir = await directory();
 await expect(receiveTrainingDataset(request(bytes), { resolveAccount: async () => "owner" })).rejects.toMatchObject({ statusCode: 503 });
 await expect(receiveTrainingDataset(request(bytes, { "content-type": "text/plain" }), { storageDir, resolveAccount: async () => "owner" })).rejects.toMatchObject({ statusCode: 415 });
 await expect(receiveTrainingDataset(request(bytes, { "content-length": String(MAX_TRAINING_DATASET_BYTES + 1) }), { storageDir, resolveAccount: async () => "owner" })).rejects.toMatchObject({ statusCode: 413 });
});

it("validates canonical records, checksums, safe ZIP paths and expansion bounds", async () => {
 const bytes = await archive();
 const files = unzipSync(bytes);
 expect(validateTrainingDataset(bytes)).toEqual({ recordCount: 1 });
 expect(validateTrainingDataset(zipSync({ ...files, "data/source-snapshot.json": strToU8("{}"), "data/review-notes.jsonl": strToU8("{}\n"), "data/review-summaries.jsonl": strToU8("{}\n") }))).toEqual({ recordCount: 1 });
 expect(() => validateTrainingDataset(zipSync({ ...files, "../escape.json": strToU8("{}") }))).toThrow();
 expect(() => validateTrainingDataset(zipSync({ ...files, "data/keating.training.jsonl": strToU8('{"schemaVersion":2}\n') }))).toThrow();
 const corrupt = Buffer.from(bytes);
 corrupt[40] ^= 1;
 expect(() => validateTrainingDataset(corrupt)).toThrow();
 const bomb = Buffer.from(bytes);
 const directoryOffset = bomb.readUInt32LE(bomb.length - 22 + 16);
 bomb.writeUInt32LE(101 * 1024 * 1024, directoryOffset + 24);
 expect(() => validateTrainingDataset(bomb)).toThrow("Expanded dataset exceeds");
});

it("enforces streamed body size even without Content-Length", async () => {
 const storageDir = await directory();
 const oversized = new Request("https://keating.example/api/training-datasets", { method: "POST", headers: { "content-type": "application/zip", "x-keating-training-consent": TRAINING_DATASET_CONSENT }, body: new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(MAX_TRAINING_DATASET_BYTES + 1)); controller.close(); } }), duplex: "half" } as RequestInit);
 await expect(receiveTrainingDataset(oversized, { storageDir, resolveAccount: async () => "owner" })).rejects.toMatchObject({ statusCode: 413 });
 expect(await readdir(storageDir)).toEqual([]);
});

it("does not issue a receipt when persistent storage cannot be written", async () => {
 const root = await directory();
 const storageDir = join(root, "not-a-directory");
 await writeFile(storageDir, "existing file");
 await expect(receiveTrainingDataset(request(await archive()), { storageDir, resolveAccount: async () => "owner" })).rejects.toMatchObject({ statusCode: 503 });
 expect(await readFile(storageDir, "utf8")).toBe("existing file");
});
