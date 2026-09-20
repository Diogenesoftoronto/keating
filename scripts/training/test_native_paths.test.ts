import { test, expect } from 'bun:test';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { nativeOutputPath } from './native_paths.js';

test('private source outputs require ignored workspace storage, including symlink resolution', async () => {
  const root = await mkdtemp(join(tmpdir(), 'keating-native-paths-'));
  try {
    expect(spawnSync('git', ['init', '--quiet', root]).status).toBe(0);
    await writeFile(join(root, '.gitignore'), '.keating/\n');
    await mkdir(join(root, '.keating/native-learning'), { recursive: true });
    expect(await nativeOutputPath('.keating/native-learning/new-run', root)).toBe(join(root, '.keating/native-learning/new-run'));
    await expect(nativeOutputPath('docs/private-source', root)).rejects.toThrow('native_output_must_be_local_research_storage');
    await expect(nativeOutputPath('../outside', root)).rejects.toThrow('native_output_must_be_local_research_storage');
    await mkdir(join(root, 'docs'));
    await symlink(join(root, 'docs'), join(root, '.keating/native-learning/escape'));
    await expect(nativeOutputPath('.keating/native-learning/escape/leak', root)).rejects.toThrow('native_output_must_be_local_research_storage');
    await writeFile(join(root, '.gitignore'), '');
    await expect(nativeOutputPath('.keating/native-learning/new-run', root)).rejects.toThrow('native_output_must_be_git_ignored');
  } finally { await rm(root, { recursive: true, force: true }); }
});
