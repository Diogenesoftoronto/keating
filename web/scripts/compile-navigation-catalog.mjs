import { readFile, writeFile } from 'node:fs/promises';
import { hashMessage } from 'gt-i18n/internal';
const root = new URL('../src/_gt/', import.meta.url);
const source = JSON.parse(await readFile(new URL('navigation-source.json', root), 'utf8'));
for (const locale of ['en-CA', 'fr-CA']) {
  const path = new URL(`${locale}.json`, root);
  const catalog = JSON.parse(await readFile(path, 'utf8'));
  for (const [message, translation] of Object.entries(source)) {
    if (!translation.trim()) throw new Error(`Empty French translation: ${message}`);
    // Nav uses imperative ICU, Footer/T use JSX. Plain messages have distinct hashes.
    for (const $format of ['ICU', 'JSX']) {
      const key = hashMessage(message, { $format });
      catalog[key] = locale === 'fr-CA' ? translation : message;
    }
  }
  await writeFile(path, JSON.stringify(catalog, null, 2) + '\n');
  console.log(`${locale}: ${Object.keys(catalog).length} canonical hashes`);
}
