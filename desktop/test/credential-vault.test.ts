import { randomBytes } from "node:crypto";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import {
	CREDENTIAL_VAULT_VERSION,
	CredentialVault,
	type CredentialEncryptionCodec,
} from "../src/credential-vault.js";

const directories: string[] = [];

afterEach(async () => {
	await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function fixture(): Promise<{ directory: string; path: string; codec: CredentialEncryptionCodec; vault: CredentialVault }> {
	const directory = await mkdtemp(join(tmpdir(), "keating-credential-vault-"));
	directories.push(directory);
	const key = randomBytes(32);
	const codec: CredentialEncryptionCodec = {
		isEncryptionAvailable: () => true,
		encryptString(plaintext) {
			const source = Buffer.from(plaintext, "utf8");
			return new Uint8Array(source.map((byte, index) => byte ^ key[index % key.length]!));
		},
		decryptString(ciphertext) {
			return Buffer.from(ciphertext.map((byte, index) => byte ^ key[index % key.length]!)).toString("utf8");
		},
	};
	const path = join(directory, "state", "credentials.json");
	return { directory, path, codec, vault: new CredentialVault({ path, codec }) };
}

describe("CredentialVault", () => {
	test("round-trips across restart, deletes, and clears provider/OAuth credentials", async () => {
		const { path, codec, vault } = await fixture();
		await vault.set("provider.openai", "sk-keating-secret");
		await vault.set("oauth:anthropic", "refresh-token");
		expect(await vault.get("provider.openai")).toBe("sk-keating-secret");
		expect(await vault.keys()).toEqual(["oauth:anthropic", "provider.openai"]);

		const restarted = new CredentialVault({ path, codec });
		expect(await restarted.get("oauth:anthropic")).toBe("refresh-token");
		expect(await restarted.delete("provider.openai")).toBe(true);
		expect(await restarted.delete("provider.openai")).toBe(false);
		expect(await restarted.has("provider.openai")).toBe(false);
		await restarted.clear();
		expect(await restarted.keys()).toEqual([]);
		expect(await restarted.get("oauth:anthropic")).toBeNull();
	});

	test("serializes concurrent writes without losing credentials", async () => {
		const { vault } = await fixture();
		await Promise.all(Array.from({ length: 48 }, (_, index) => vault.set(`provider.${index}`, `token-${index}`)));
		expect(await vault.keys()).toHaveLength(48);
		await Promise.all(Array.from({ length: 48 }, (_, index) =>
			expect(vault.get(`provider.${index}`)).resolves.toBe(`token-${index}`),
		));
	});

	test("persists only versioned ciphertext with an owner-only atomic replacement", async () => {
		const { directory, path, vault } = await fixture();
		const secret = "never-write-this-provider-secret";
		await vault.set("provider.openai", secret);
		const first = await lstat(path);
		const disk = await readFile(path, "utf8");
		expect(disk).not.toContain(secret);
		expect(JSON.parse(disk)).toEqual({
			version: CREDENTIAL_VAULT_VERSION,
			entries: { "provider.openai": expect.any(String) },
		});
		if (process.platform !== "win32") expect(first.mode & 0o777).toBe(0o600);

		await vault.set("provider.openai", "replacement");
		const second = await lstat(path);
		expect(`${second.dev}:${second.ino}`).not.toBe(`${first.dev}:${first.ino}`);
		expect((await readdir(join(directory, "state"))).filter((name) => name.endsWith(".tmp"))).toEqual([]);
	});

	test("fails closed when secure OS encryption is unavailable", async () => {
		const { path } = await fixture();
		const vault = new CredentialVault({
			path,
			codec: {
				isEncryptionAvailable: () => false,
				encryptString: () => new Uint8Array([1]),
				decryptString: () => "never",
			},
		});
		await expect(vault.set("provider.openai", "secret")).rejects.toThrow("unavailable");
		await expect(vault.keys()).rejects.toThrow("unavailable");
		expect(await Bun.file(path).exists()).toBe(false);
	});

	test("rejects invalid credential ids before reading or writing", async () => {
		const { vault } = await fixture();
		for (const id of ["", "../escape", "Provider.OpenAI", "space value", "__proto__", "x".repeat(129)]) {
			await expect(vault.set(id, "secret")).rejects.toThrow("Credential id is invalid");
		}
	});

	test("rejects corruption and unsupported versions without overwriting the vault", async () => {
		const { path, vault } = await fixture();
		await mkdir(join(path, ".."), { recursive: true });
		const corrupt = "{ not valid JSON";
		await writeFile(path, corrupt, { mode: 0o600 });
		await expect(vault.set("provider.openai", "secret")).rejects.toThrow("corrupt");
		expect(await readFile(path, "utf8")).toBe(corrupt);

		const unsupported = JSON.stringify({ version: 99, entries: {} });
		await writeFile(path, unsupported, { mode: 0o600 });
		await expect(vault.set("provider.openai", "secret")).rejects.toThrow("not supported");
		expect(await readFile(path, "utf8")).toBe(unsupported);
	});

	test("rejects symlinked or non-owner-readable vaults without replacing them", async () => {
		const { directory, path, vault } = await fixture();
		const target = join(directory, "target.json");
		await writeFile(target, JSON.stringify({ version: CREDENTIAL_VAULT_VERSION, entries: {} }), { mode: 0o600 });
		await mkdir(join(directory, "state"), { recursive: true });
		await symlink(target, path);
		await expect(vault.set("provider.openai", "secret")).rejects.toThrow("unsafe");
		expect((await lstat(path)).isSymbolicLink()).toBe(true);

		await rm(path);
		await writeFile(path, JSON.stringify({ version: CREDENTIAL_VAULT_VERSION, entries: {} }), { mode: 0o600 });
		if (process.platform !== "win32") {
			await chmod(path, 0o644);
			await expect(vault.set("provider.openai", "secret")).rejects.toThrow("permissions are unsafe");
			expect(await readFile(path, "utf8")).toContain('"version":1');
		}
	});
});
