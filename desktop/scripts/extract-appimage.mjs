import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error('Usage: node desktop/scripts/extract-appimage.mjs INPUT.AppImage OUTPUT_DIRECTORY');
const bytes = readFileSync(input);
let offset = -1;
for (let start = 0; start < bytes.length;) {
  const candidate = bytes.indexOf(Buffer.from('hsqs'), start);
  if (candidate < 0) break;
  if (candidate + 32 < bytes.length && bytes.readUInt16LE(candidate + 28) === 4) { offset = candidate; break; }
  start = candidate + 4;
}
if (offset < 0) throw new Error('AppImage contains no supported SquashFS filesystem.');
const result = spawnSync('unsquashfs', ['-no-progress', '-o', String(offset), '-d', output, input], { stdio: 'inherit' });
if (result.status !== 0) throw new Error('AppImage extraction failed.');
