/** Offline corpus admission uses the same OpenUI validator as native delivery. */
import { validateNativeSourceDocument } from './native_source_document.js';

const documents: unknown = await Bun.stdin.json();
if (!Array.isArray(documents)) throw new Error('Expected document array');
for (const document of documents) validateNativeSourceDocument(document);
console.log(JSON.stringify({ documents: documents.length, validator: 'validateNativeSourceDocument', runtimeExecuted: false }));
