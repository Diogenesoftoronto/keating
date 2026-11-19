/**
 * One reply, recorded under two document ids.
 *
 * A document's id is derived from the id of the message that carries it. Moments after a reply finishes, the chat
 * can swap the live row for the stored one, which has a different message id, so the same node is presented again
 * under a second document id. The later id is the one the chat keeps rendering, and the one learner actions use.
 */
interface PresentationIdentity {
	id: string;
	documentId: string;
	nodeId: string;
	component: string;
	sessionId?: string;
	createdAt: number;
}

/** The swap happens within a second. Two separate replies cannot finish this close together. */
const TWIN_WINDOW_MS = 5_000;

/** `openui-<scope hash>-<declared id>` or `openui-<scope hash>`: what is left once the message-dependent part is gone. */
const declaredPart = (documentId: string): string => documentId.replace(/^openui-[a-z0-9]+-?/, "");

const family = (record: PresentationIdentity): string =>
	[record.sessionId, record.component, record.nodeId, declaredPart(record.documentId)].join("\0");

export function isPresentationTwin(a: PresentationIdentity, b: PresentationIdentity): boolean {
	return Boolean(a.sessionId) && a.documentId !== b.documentId && family(a) === family(b)
		&& Math.abs(a.createdAt - b.createdAt) <= TWIN_WINDOW_MS;
}

const supersedes = (later: PresentationIdentity, earlier: PresentationIdentity): boolean =>
	later.createdAt > earlier.createdAt || (later.createdAt === earlier.createdAt && later.id > earlier.id);

/** Records with each earlier twin removed. Order is kept. */
export function withoutPresentationTwins<T extends PresentationIdentity>(records: readonly T[]): T[] {
	const families = new Map<string, T[]>();
	for (const record of records) {
		if (!record.sessionId) continue;
		const key = family(record);
		const group = families.get(key);
		if (group) group.push(record);
		else families.set(key, [record]);
	}
	return records.filter((record) => {
		const group = record.sessionId ? families.get(family(record)) : undefined;
		return !group || group.length < 2
			|| !group.some((other) => other !== record && isPresentationTwin(record, other) && supersedes(other, record));
	});
}
