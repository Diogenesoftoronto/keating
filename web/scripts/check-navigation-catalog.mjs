import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GTProvider, initializeGT, T, useGT } from 'gt-react';
import { hashMessage } from 'gt-i18n/internal';
const root = new URL('../src/_gt/', import.meta.url);
const source = JSON.parse(await readFile(new URL('navigation-source.json', root), 'utf8'));
const translations = {};
for (const locale of ['en-CA', 'fr-CA']) translations[locale] = JSON.parse(await readFile(new URL(`${locale}.json`, root), 'utf8'));
initializeGT({defaultLocale: 'en-CA', locales: ['fr-CA'], cacheUrl: null, runtimeUrl: null});
function Imperative({message}) { const gt = useGT(); return React.createElement('span', null, gt(message)); }
let checked = 0;
for (const locale of ['en-CA', 'fr-CA']) {
  for (const [message, french] of Object.entries(source)) {
    const expected = locale === 'fr-CA' ? french : message;
    for (const $format of ['ICU', 'JSX']) assert.equal(translations[locale][hashMessage(message, {$format})], expected);
    for (const child of [React.createElement(Imperative, {message}), React.createElement(T, null, message)]) {
      const html = renderToStaticMarkup(React.createElement(GTProvider, {locale, translations}, child));
      const text = html.replace(/<[^>]+>/g,'').replace(/&#x27;/g,"'").replace(/&amp;/g,'&');
      assert.equal(text, expected, `${locale}: ${message}`); checked++;
    }
  }
}
console.log(`${checked} real gt-react renders passed; 30 source messages × 2 locales × 2 APIs.`);
