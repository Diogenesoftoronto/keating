import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const script = fileURLToPath(new URL('../scripts/build-flatpak.mjs', import.meta.url));
const run = (args: string[]) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });

test('requires a complete signing identity before doing any packaging', () => {
  const result = run(['--app-dir', '/does-not-exist', '--repo', '/not-created', '--arch', 'x86_64', '--gpg-sign', 'short-id']);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('complete GPG signing fingerprint');
});

test('rejects mismatched prebuilt architecture before exporting or creating a repository', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'keating-flatpak-input-'));
  try {
    const executable = Buffer.alloc(20);
    executable.set([0x7f, 0x45, 0x4c, 0x46, 2, 1]);
    executable.writeUInt16LE(62, 18);
    await writeFile(join(directory, 'keating-desktop'), executable);
    const repo = join(directory, 'repository');
    const result = run(['--app-dir', directory, '--repo', repo, '--arch', 'aarch64', '--gpg-sign', 'A'.repeat(40)]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('does not match --arch aarch64');
    await expect(access(repo)).rejects.toThrow();
  } finally { await rm(directory, { recursive: true, force: true }); }
});


test('fails before export when host AppStream composition is unavailable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'keating-flatpak-catalog-'));
  try {
    const executable = Buffer.alloc(20);
    executable.set([0x7f, 0x45, 0x4c, 0x46, 2, 1]);
    executable.writeUInt16LE(62, 18);
    await writeFile(join(directory, 'keating-desktop'), executable);
    await mkdir(join(directory, 'resources/nitro/server'), { recursive: true });
    await writeFile(join(directory, 'resources/app.asar'), 'fixture');
    await writeFile(join(directory, 'resources/nitro/server/index.mjs'), 'fixture');
    const repo = join(directory, 'repository');
    const result = spawnSync(process.execPath, [script, '--app-dir', directory, '--repo', repo, '--arch', 'x86_64', '--gpg-sign', 'A'.repeat(40)], {
      encoding: 'utf8', env: { ...process.env, APPSTREAMCLI: join(directory, 'missing-appstreamcli') },
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('AppStream compose is required');
    await expect(access(repo)).rejects.toThrow();
  } finally { await rm(directory, { recursive: true, force: true }); }
});
