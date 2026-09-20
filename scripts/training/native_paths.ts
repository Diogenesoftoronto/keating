/** Keep complete source-derived artifacts inside ignored local research storage. */
import { realpath } from 'node:fs/promises';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export async function nativeOutputPath(path: string, root = fileURLToPath(new URL('../..', import.meta.url))): Promise<string> {
  const rootReal = await realpath(root);
  const output = resolve(rootReal, path);
  let existing = output;
  while (true) {
    try { await realpath(existing); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || dirname(existing) === existing) throw error;
      existing = dirname(existing);
    }
  }
  const resolvedOutput = resolve(await realpath(existing), relative(existing, output));
  const local = relative(rootReal, resolvedOutput).split(sep).join('/');
  if (!(local.startsWith('.keating/native-learning/') || local.startsWith('.keating/outputs/'))
    || local.split('/').includes('..')) throw new Error('native_output_must_be_local_research_storage');
  const ignored = spawnSync('git', ['check-ignore', '--quiet', '--no-index', '--', resolvedOutput], { cwd: rootReal });
  if (ignored.status !== 0) throw new Error('native_output_must_be_git_ignored');
  return resolvedOutput;
}
