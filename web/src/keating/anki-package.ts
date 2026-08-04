import initSqlJs, { type Database, type SqlJsStatic, type SqlValue } from "sql.js";
import sqlWasmUrl from "sql.js/dist/sql-wasm.wasm?url";
import { decompress } from "fzstd";
import { strToU8, unzipSync, zipSync } from "fflate";

import type { Flashcard, FlashcardDeck, FlashcardSrsState } from "./storage";

const FIELD_SEPARATOR = "\x1f";
const MS_PER_DAY = 86_400_000;
const MAX_PACKAGE_BYTES = 128 * 1024 * 1024;
const MAX_COLLECTION_BYTES = 256 * 1024 * 1024;
const MAX_IMPORTED_CARDS = 50_000;
const MAX_MEDIA_INDEX_BYTES = 4 * 1024 * 1024;
const BASIC_MODEL_NAME = "Keating Basic";

let sqlPromise: Promise<SqlJsStatic> | null = null;

function getSql(): Promise<SqlJsStatic> {
	if (!sqlPromise) sqlPromise = initSqlJs({ locateFile: () => sqlWasmUrl });
	return sqlPromise;
}

export interface AnkiImportResult {
	decks: FlashcardDeck[];
	cardCount: number;
	mediaCount: number;
	warnings: string[];
	collectionFormat: "collection.anki2" | "collection.anki21" | "collection.anki21b" | "text";
}

export interface AnkiMergeResult {
	deck: FlashcardDeck;
	added: number;
	updated: number;
	unchanged: number;
}

interface AnkiCardRow {
	card_id: number;
	did: number;
	type: number;
	queue: number;
	due: number;
	ivl: number;
	factor: number;
	reps: number;
	lapses: number;
	note_id: number;
	guid: string;
	tags: string;
	flds: string;
	note_mod: number;
}

function asNumber(value: SqlValue | undefined, fallback = 0): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asString(value: SqlValue | undefined): string {
	return typeof value === "string" ? value : "";
}

function resultRows(db: Database, sql: string): AnkiCardRow[] {
	const result = db.exec(sql)[0];
	if (!result) return [];
	return result.values.map((values) => {
		const row = Object.fromEntries(result.columns.map((column, index) => [column, values[index]]));
		return {
			card_id: asNumber(row.card_id),
			did: asNumber(row.did),
			type: asNumber(row.type),
			queue: asNumber(row.queue),
			due: asNumber(row.due),
			ivl: asNumber(row.ivl),
			factor: asNumber(row.factor),
			reps: asNumber(row.reps),
			lapses: asNumber(row.lapses),
			note_id: asNumber(row.note_id),
			guid: asString(row.guid),
			tags: asString(row.tags),
			flds: asString(row.flds),
			note_mod: asNumber(row.note_mod),
		};
	});
}

function decodeHtmlEntities(value: string): string {
	if (typeof document !== "undefined") {
		const textarea = document.createElement("textarea");
		textarea.innerHTML = value;
		return textarea.value;
	}
	const named: Record<string, string> = {
		amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
	};
	return value.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
		if (entity[0] !== "#") return named[entity.toLowerCase()] ?? match;
		const radix = entity[1]?.toLowerCase() === "x" ? 16 : 10;
		const digits = radix === 16 ? entity.slice(2) : entity.slice(1);
		const codePoint = Number.parseInt(digits, radix);
		return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
	});
}

export function ankiHtmlToText(value: string): string {
	const withMediaLabels = value
		.replace(/\[sound:[^\]]+\]/gi, "")
		.replace(/<img\b[^>]*\balt=(?:"([^"]*)"|'([^']*)')[^>]*>/gi, (_match, doubleQuoted: string, singleQuoted: string) => doubleQuoted || singleQuoted || "")
		.replace(/<(?:br|hr)\s*\/?>/gi, "\n")
		.replace(/<\/(?:div|p|li|tr|h[1-6])>/gi, "\n")
		.replace(/<[^>]+>/g, "");
	return decodeHtmlEntities(withMediaLabels)
		.replace(/\r/g, "")
		.replace(/[ \t]+\n/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

function renderClozeFront(value: string): string {
	return value.replace(/{{c\d+::(.*?)(?:::(.*?))?}}/gi, (_match, _answer: string, hint?: string) => hint ? `[${hint}]` : "[…]");
}

function renderClozeBack(value: string): string {
	return value.replace(/{{c\d+::(.*?)(?:::(.*?))?}}/gi, (_match, answer: string) => answer);
}

function cardText(fields: string[]): { front: string; back: string } {
	const first = fields[0] ?? "";
	const hasCloze = /{{c\d+::/i.test(first);
	if (hasCloze) {
		const front = ankiHtmlToText(renderClozeFront(first));
		const expanded = ankiHtmlToText(renderClozeBack(first));
		const extra = fields.slice(1).map(ankiHtmlToText).filter(Boolean).join("\n\n");
		return { front, back: extra ? `${expanded}\n\n${extra}` : expanded };
	}
	return {
		front: ankiHtmlToText(first),
		back: fields.slice(1).map(ankiHtmlToText).filter(Boolean).join("\n\n"),
	};
}

function safeDeckName(value: unknown, deckId: number): string {
	if (!value || typeof value !== "object") return `Anki deck ${deckId}`;
	const name = (value as { name?: unknown }).name;
	return typeof name === "string" && name.trim() ? name.trim() : `Anki deck ${deckId}`;
}

function slugify(value: string): string {
	return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "anki-deck";
}

function importedDueAt(row: AnkiCardRow, collectionCreatedSeconds: number, now: number): number {
	if (row.queue === 1 || row.queue === 3) {
		const scheduled = row.due * 1000;
		return scheduled > 0 ? scheduled : now;
	}
	if (row.queue === 2 || row.type === 2) {
		const scheduled = collectionCreatedSeconds * 1000 + Math.max(0, row.due) * MS_PER_DAY;
		return scheduled > 0 ? scheduled : now + Math.max(0, row.ivl) * MS_PER_DAY;
	}
	return now;
}

function importedSrs(row: AnkiCardRow, collectionCreatedSeconds: number, now: number): FlashcardSrsState {
	return {
		ease: row.factor >= 1300 ? row.factor / 1000 : 2.5,
		intervalDays: Math.max(0, row.ivl),
		reps: Math.max(0, row.reps),
		lapses: Math.max(0, row.lapses),
		dueAt: importedDueAt(row, collectionCreatedSeconds, now),
		lastReviewedAt: 0,
		lastRating: null,
	};
}

function parseJsonRecord(value: string): Record<string, unknown> {
	try {
		const parsed = JSON.parse(value);
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
	} catch {
		return {};
	}
}

function mediaCount(bytes: Uint8Array | undefined): number {
	if (!bytes) return 0;
	try {
		const parsed = JSON.parse(new TextDecoder().decode(bytes));
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? Object.keys(parsed).length : 0;
	} catch {
		return 0;
	}
}

export async function parseAnkiPackage(bytes: Uint8Array, now: number = Date.now()): Promise<AnkiImportResult> {
	if (bytes.byteLength === 0) throw new Error("This Anki package is empty.");
	if (bytes.byteLength > MAX_PACKAGE_BYTES) throw new Error("This Anki package is larger than the 128 MB import limit.");

	const extracted = unzipSync(bytes, {
		filter: (file) => {
			const allowed = ["collection.anki2", "collection.anki21", "collection.anki21b"].includes(file.name);
			if (allowed && file.originalSize > MAX_COLLECTION_BYTES) throw new Error("The Anki collection is too large to import safely.");
			return allowed || (file.name === "media" && file.originalSize <= MAX_MEDIA_INDEX_BYTES);
		},
	});
	const collectionFormat = (["collection.anki21b", "collection.anki21", "collection.anki2"] as const)
		.find((name) => extracted[name]);
	if (!collectionFormat) throw new Error("No Anki collection database was found in this package.");
	const compressedCollection = extracted[collectionFormat];
	const collection = collectionFormat === "collection.anki21b" ? decompress(compressedCollection) : compressedCollection;
	if (collection.byteLength > MAX_COLLECTION_BYTES) throw new Error("The expanded Anki collection is too large to import safely.");

	const SQL = await getSql();
	const db = new SQL.Database(collection);
	try {
		const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('col', 'notes', 'cards')")[0]?.values.flat() ?? [];
		if (!tables.includes("col") || !tables.includes("notes") || !tables.includes("cards")) {
			throw new Error("This package does not contain a compatible Anki collection.");
		}
		const col = db.exec("SELECT crt, decks FROM col LIMIT 1")[0]?.values[0];
		if (!col) throw new Error("The Anki collection metadata is missing.");
		const collectionCreatedSeconds = asNumber(col[0], Math.floor(now / 1000 / 86_400) * 86_400);
		const deckMetadata = parseJsonRecord(asString(col[1]));
		const rows = resultRows(db, `
			SELECT c.id AS card_id, c.did, c.type, c.queue, c.due, c.ivl, c.factor, c.reps, c.lapses,
				n.id AS note_id, n.guid, n.tags, n.flds, n.mod AS note_mod
			FROM cards c JOIN notes n ON n.id = c.nid
			ORDER BY c.did, c.id
			LIMIT ${MAX_IMPORTED_CARDS + 1}
		`);
		if (rows.length > MAX_IMPORTED_CARDS) throw new Error(`This package has more than ${MAX_IMPORTED_CARDS.toLocaleString()} cards, above Keating's import limit.`);

		const warnings: string[] = [];
		const grouped = new Map<number, Flashcard[]>();
		let skipped = 0;
		for (const row of rows) {
			const text = cardText(row.flds.split(FIELD_SEPARATOR));
			if (!text.front || !text.back) {
				skipped += 1;
				continue;
			}
			const card: Flashcard = {
				id: `anki-card-${row.card_id}`,
				front: text.front,
				back: text.back,
				tags: row.tags.trim().split(/\s+/).filter(Boolean),
				anki: { noteGuid: row.guid, noteId: row.note_id, cardId: row.card_id, deckId: row.did },
				srs: importedSrs(row, collectionCreatedSeconds, now),
				createdAt: row.note_mod > 0 ? row.note_mod * 1000 : now,
				updatedAt: row.note_mod > 0 ? row.note_mod * 1000 : now,
			};
			const cards = grouped.get(row.did) ?? [];
			cards.push(card);
			grouped.set(row.did, cards);
		}
		if (skipped > 0) warnings.push(`${skipped.toLocaleString()} card${skipped === 1 ? " was" : "s were"} skipped because a front or back was empty.`);
		const importedMedia = mediaCount(extracted.media);
		if (importedMedia > 0 || collectionFormat === "collection.anki21b") {
			warnings.push("Card media and template styling were not imported; Keating keeps the review text safe and local.");
		}
		const decks = [...grouped.entries()].map(([deckId, cards]) => {
			const title = safeDeckName(deckMetadata[String(deckId)], deckId);
				return {
					id: `anki-deck-${deckId}`,
				topic: title.split("::").at(-1) || title,
				slug: `anki-${slugify(title)}-${deckId}`,
				title,
					description: `Imported from Anki · ${cards.length.toLocaleString()} cards`,
					anki: { deckId },
				cards,
				createdAt: Math.min(...cards.map((card) => card.createdAt), now),
				updatedAt: Math.max(...cards.map((card) => card.updatedAt), now),
			} satisfies FlashcardDeck;
		});
		return { decks, cardCount: decks.reduce((sum, deck) => sum + deck.cards.length, 0), mediaCount: importedMedia, warnings, collectionFormat };
	} finally {
		db.close();
	}
}

function fnvChecksum(value: string): number {
	let hash = 0x811c9dc5;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

function stableAnkiId(value: string, prefix: "deck" | "card" | "note", used: Set<number>): number {
	const imported = prefix === "deck"
		? /^anki-deck-(\d+)$/.exec(value)?.[1]
		: prefix === "card"
			? /^anki-card-(\d+)$/.exec(value)?.[1]
			: undefined;
	let candidate = imported ? Number(imported) : 1_000_000_000_000 + fnvChecksum(`${prefix}:${value}`);
	if (!Number.isSafeInteger(candidate) || candidate <= 0) candidate = 1_000_000_000_000 + fnvChecksum(`${prefix}:fallback:${value}`);
	while (used.has(candidate)) candidate += 1;
	used.add(candidate);
	return candidate;
}

function exportModel(modelId: number, nowSeconds: number): Record<string, unknown> {
	return {
		id: modelId, name: BASIC_MODEL_NAME, type: 0, mod: nowSeconds, usn: -1, sortf: 0, did: null,
		tmpls: [{ name: "Card 1", ord: 0, qfmt: "{{Front}}", afmt: "{{FrontSide}}<hr id=answer>{{Back}}", bqfmt: "", bafmt: "", did: null }],
		flds: ["Front", "Back"].map((name, ord) => ({ name, ord, sticky: false, rtl: false, font: "Arial", size: 20, description: "", plainText: false, collapsed: false, excludeFromSearch: false })),
		css: ".card { font-family: Arial; font-size: 20px; text-align: left; color: black; background-color: white; }",
		latexPre: "", latexPost: "", latexsvg: false, req: [[0, "all", [0]]],
	};
}

function exportDeck(deckId: number, title: string, nowSeconds: number): Record<string, unknown> {
	return { id: deckId, name: title, mod: nowSeconds, usn: -1, desc: "Exported from Keating", dyn: 0, collapsed: false, browserCollapsed: false, conf: 1, extendNew: 0, extendRev: 0 };
}

const SCHEMA_SQL = `
CREATE TABLE col (id integer primary key, crt integer not null, mod integer not null, scm integer not null, ver integer not null, dty integer not null, usn integer not null, ls integer not null, conf text not null, models text not null, decks text not null, dconf text not null, tags text not null);
CREATE TABLE notes (id integer primary key, guid text not null, mid integer not null, mod integer not null, usn integer not null, tags text not null, flds text not null, sfld integer not null, csum integer not null, flags integer not null, data text not null);
CREATE TABLE cards (id integer primary key, nid integer not null, did integer not null, ord integer not null, mod integer not null, usn integer not null, type integer not null, queue integer not null, due integer not null, ivl integer not null, factor integer not null, reps integer not null, lapses integer not null, left integer not null, odue integer not null, odid integer not null, flags integer not null, data text not null);
CREATE TABLE revlog (id integer primary key, cid integer not null, usn integer not null, ease integer not null, ivl integer not null, lastIvl integer not null, factor integer not null, time integer not null, type integer not null);
CREATE TABLE graves (usn integer not null, oid integer not null, type integer not null);
CREATE INDEX ix_notes_usn ON notes (usn); CREATE INDEX ix_cards_usn ON cards (usn); CREATE INDEX ix_cards_nid ON cards (nid); CREATE INDEX ix_cards_sched ON cards (did, queue, due); CREATE INDEX ix_revlog_cid ON revlog (cid); CREATE INDEX ix_notes_csum ON notes (csum);
`;

export async function buildAnkiPackage(decks: FlashcardDeck[], now: number = Date.now()): Promise<Uint8Array> {
	if (decks.length === 0 || decks.every((deck) => deck.cards.length === 0)) throw new Error("There are no flashcards to export.");
	const totalCards = decks.reduce((sum, deck) => sum + deck.cards.length, 0);
	if (totalCards > MAX_IMPORTED_CARDS) throw new Error(`Anki exports are limited to ${MAX_IMPORTED_CARDS.toLocaleString()} cards.`);
	const SQL = await getSql();
	const db = new SQL.Database();
	try {
		db.run(SCHEMA_SQL);
		const nowSeconds = Math.floor(now / 1000);
		const collectionCreatedSeconds = Math.floor(nowSeconds / 86_400) * 86_400;
		const usedDeckIds = new Set<number>();
		const usedCardIds = new Set<number>();
		const usedNoteIds = new Set<number>();
		const modelId = 1_000_000_000_000 + fnvChecksum("keating-basic-model");
		const deckIds = new Map(decks.map((deck) => {
			const sourceId = deck.anki?.deckId;
			const id = sourceId && Number.isSafeInteger(sourceId) && sourceId > 0 && !usedDeckIds.has(sourceId)
				? sourceId
				: stableAnkiId(deck.id, "deck", usedDeckIds);
			usedDeckIds.add(id);
			return [deck.id, id];
		}));
		const models = { [modelId]: exportModel(modelId, nowSeconds) };
		const ankiDecks = Object.fromEntries(decks.map((deck) => {
			const id = deckIds.get(deck.id)!;
			return [id, exportDeck(id, deck.title, nowSeconds)];
		}));
		const dconf = { 1: { id: 1, name: "Default", mod: nowSeconds, usn: -1, maxTaken: 60, autoplay: true, timer: 0, replayq: true, dyn: false } };
		db.run("INSERT INTO col VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [1, collectionCreatedSeconds, now, now, 18, 0, -1, 0, "{}", JSON.stringify(models), JSON.stringify(ankiDecks), JSON.stringify(dconf), "{}"]);

		const noteStatement = db.prepare("INSERT INTO notes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
		const cardStatement = db.prepare("INSERT INTO cards VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
		let cardIndex = 0;
		for (const deck of decks) {
			const did = deckIds.get(deck.id)!;
			for (const card of deck.cards) {
				const sourceNoteId = card.anki?.noteId;
				const sourceCardId = card.anki?.cardId;
				const nid = sourceNoteId && Number.isSafeInteger(sourceNoteId) && sourceNoteId > 0 && !usedNoteIds.has(sourceNoteId)
					? sourceNoteId
					: stableAnkiId(card.id, "note", usedNoteIds);
				const cid = sourceCardId && Number.isSafeInteger(sourceCardId) && sourceCardId > 0 && !usedCardIds.has(sourceCardId)
					? sourceCardId
					: stableAnkiId(card.id, "card", usedCardIds);
				usedNoteIds.add(nid);
				usedCardIds.add(cid);
				const mod = Math.floor((card.updatedAt || now) / 1000);
				const tags = card.tags?.length ? ` ${card.tags.join(" ")} ` : "";
				noteStatement.run([nid, card.anki?.noteGuid || `keating-${card.id}`, modelId, mod, -1, tags, `${card.front}${FIELD_SEPARATOR}${card.back}`, card.front, fnvChecksum(card.front), 0, ""]);
				const isNew = card.srs.reps === 0;
				const due = isNew ? cardIndex : Math.max(0, Math.round((card.srs.dueAt - collectionCreatedSeconds * 1000) / MS_PER_DAY));
				cardStatement.run([cid, nid, did, 0, mod, -1, isNew ? 0 : 2, isNew ? 0 : 2, due, Math.max(0, Math.round(card.srs.intervalDays)), Math.max(1300, Math.round(card.srs.ease * 1000)), Math.max(0, card.srs.reps), Math.max(0, card.srs.lapses), 0, 0, 0, 0, ""]);
				cardIndex += 1;
			}
		}
		noteStatement.free();
		cardStatement.free();
		return zipSync({ "collection.anki21": db.export(), media: strToU8("{}") }, { level: 6 });
	} finally {
		db.close();
	}
}

export function mergeAnkiDeck(existing: FlashcardDeck | null, incoming: FlashcardDeck): AnkiMergeResult {
	if (!existing) return { deck: incoming, added: incoming.cards.length, updated: 0, unchanged: 0 };
	const byId = new Map(existing.cards.map((card) => [card.id, card]));
	let added = 0;
	let updated = 0;
	let unchanged = 0;
	for (const card of incoming.cards) {
		const current = byId.get(card.id);
		if (!current) {
			byId.set(card.id, card);
			added += 1;
		} else if (card.updatedAt > current.updatedAt) {
			byId.set(card.id, card);
			updated += 1;
		} else {
			unchanged += 1;
		}
	}
	return {
		deck: { ...existing, title: incoming.title, topic: incoming.topic, description: incoming.description, cards: [...byId.values()], updatedAt: Math.max(existing.updatedAt, incoming.updatedAt) },
		added,
		updated,
		unchanged,
	};
}

function parseDelimitedRows(text: string, delimiter: string): string[][] {
	const rows: string[][] = [];
	let row: string[] = [];
	let field = "";
	let quoted = false;
	for (let index = 0; index < text.length; index += 1) {
		const char = text[index];
		if (char === '"') {
			if (quoted && text[index + 1] === '"') { field += '"'; index += 1; }
			else quoted = !quoted;
		} else if (char === delimiter && !quoted) {
			row.push(field); field = "";
		} else if ((char === "\n" || char === "\r") && !quoted) {
			if (char === "\r" && text[index + 1] === "\n") index += 1;
			row.push(field); field = "";
			if (row.some((cell) => cell.trim())) rows.push(row);
			row = [];
		} else field += char;
	}
	row.push(field);
	if (row.some((cell) => cell.trim())) rows.push(row);
	return rows;
}

export function parseAnkiText(text: string, filename: string, now: number = Date.now()): AnkiImportResult {
	const delimiter = filename.toLowerCase().endsWith(".csv") ? "," : "\t";
	const rows = parseDelimitedRows(text.replace(/^\uFEFF/, ""), delimiter);
	if (rows.length === 0) throw new Error("This text export has no cards.");
	const header = rows[0].map((cell) => cell.trim().toLowerCase());
	const hasHeader = header.includes("front") && header.includes("back");
	const frontIndex = hasHeader ? header.indexOf("front") : 0;
	const backIndex = hasHeader ? header.indexOf("back") : 1;
	const tagsIndex = hasHeader ? header.indexOf("tags") : 2;
	const sourceRows = hasHeader ? rows.slice(1) : rows;
	const cards = sourceRows.slice(0, MAX_IMPORTED_CARDS).flatMap((row, index): Flashcard[] => {
		const front = ankiHtmlToText(row[frontIndex] ?? "");
		const back = ankiHtmlToText(row[backIndex] ?? "");
		if (!front || !back) return [];
		return [{
			id: `anki-text-${fnvChecksum(`${front}\n${back}`)}`,
			front,
			back,
			tags: (row[tagsIndex] ?? "").split(/[ ,]+/).filter(Boolean),
			srs: { ease: 2.5, intervalDays: 0, reps: 0, lapses: 0, dueAt: now, lastReviewedAt: 0, lastRating: null },
			createdAt: now + index,
			updatedAt: now + index,
		}];
	});
	if (cards.length === 0) throw new Error("No cards with both a front and back were found.");
	const title = filename.replace(/\.(csv|tsv|txt)$/i, "").trim() || "Imported cards";
	const deck: FlashcardDeck = { id: `anki-text-deck-${fnvChecksum(title)}`, topic: title, slug: `anki-${slugify(title)}`, title, description: `Imported from ${filename}`, cards, createdAt: now, updatedAt: now };
	const skipped = sourceRows.length - cards.length;
	return { decks: [deck], cardCount: cards.length, mediaCount: 0, warnings: skipped > 0 ? [`${skipped} row${skipped === 1 ? " was" : "s were"} skipped because a front or back was empty.`] : [], collectionFormat: "text" };
}

export function buildAnkiTsv(decks: FlashcardDeck[]): string {
	const escape = (value: string) => value.replace(/\t/g, " ").replace(/\r?\n/g, "<br>");
	return ["Front\tBack\tTags\tDeck", ...decks.flatMap((deck) => deck.cards.map((card) => [escape(card.front), escape(card.back), escape((card.tags ?? []).join(" ")), escape(deck.title)].join("\t")))].join("\n");
}
