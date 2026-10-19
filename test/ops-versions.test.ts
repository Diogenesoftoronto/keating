import { expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lockVersions } from '../scripts/ops/versions.js';
test('lock check detects drift without writes; sync preserves independent workspace/dependency versions', () => {
  const root = mkdtempSync(join(tmpdir(), 'ops-locks-'));
  try {
    mkdirSync(join(root, 'mobile'));
    mkdirSync(join(root, 'packages/contracts'), { recursive: true });
    writeFileSync(join(root, 'package.json'), '{"version":"4.0.16"}');
    writeFileSync(join(root, 'mobile/package.json'), '{"version":"4.0.16"}');
    writeFileSync(join(root, 'packages/contracts/package.json'), '{"version":"0.1.0"}');
    const bun = '{\n  "workspaces": {\n    "": {\n      "name": "keating",\n    },\n    "mobile": {\n      "name": "mobile",\n      "version": "4.0.15",\n    },\n    "packages/contracts": {\n      "version": "0.1.0",\n    },\n  },\n  "packages": {"dependency": ["dependency@4.0.15"]},\n}\n';
    const npm = JSON.stringify({ version: '4.0.15', packages: { '': { name: 'keating', version: '4.0.15' }, 'node_modules/dependency': { version: '4.0.15' } } }, null, 2);
    writeFileSync(join(root, 'bun.lock'), bun);
    writeFileSync(join(root, 'package-lock.json'), npm);
    expect(lockVersions(root, '4.0.16', true)).toEqual(['bun.lock', 'package-lock.json']);
    expect(readFileSync(join(root, 'bun.lock'), 'utf8')).toBe(bun);
    expect(readFileSync(join(root, 'package-lock.json'), 'utf8')).toBe(npm);
    expect(lockVersions(root, '4.0.16', false)).toEqual(['bun.lock', 'package-lock.json']);
    expect(lockVersions(root, '4.0.16', true)).toEqual([]);
    const synced = readFileSync(join(root, 'bun.lock'), 'utf8');
    expect(synced).toContain('"version": "0.1.0"');
    expect(synced).toContain('dependency@4.0.15');
    const packageLock = JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8'));
    expect(packageLock.version).toBe('4.0.16');
    expect(packageLock.packages[''].version).toBe('4.0.16');
    expect(packageLock.packages['node_modules/dependency'].version).toBe('4.0.15');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
