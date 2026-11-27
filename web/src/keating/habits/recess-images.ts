import type { RecessQuestion, RecessQuestionImage } from "../../components/recess/types";
import type { HabitLesson, HabitLessonImage } from "./lesson";

/**
 * One rule for every Recess question, whoever wrote it and whether or not Jev
 * reads it: a question that needs a picture is shown with that exact picture,
 * or it is not asked.
 */

/** Wording that only makes sense with the picture in view. */
const NEEDS_PICTURE = /\b(?:the|this|that|these|those|your|my|our|each|every)\s+(?:(?:labell?ed|attached|shaded|highlighted|first|second|third|left|right|top|bottom)\s+)?(?:diagrams?|images?|pictures?|photos?|photographs?|illustrations?|screenshots?|drawings?|sketch(?:es)?|figures?|infographics?)\b|\b(?:shown|pictured|drawn|labell?ed|highlighted|circled)\s+(?:above|below|here|in (?:the|this|your) (?:picture|image|diagram|figure|photo))\b|\bfig(?:ure)?\.?\s*\d+\b|\b(?:in|on|from) (?:the )?(?:picture|image|diagram|photo|screenshot)\b/i;
/** Wording that may point at a picture or may not ("the graph" in graph theory, "the map" in code). */
const MAY_NEED_PICTURE = /\b(?:the|this|that|these|those|your)\s+(?:graphs?|charts?|plots?|maps?|tables?)\s+(?:above|below|shown|here|on the (?:left|right))\b|\b(?:this|that|these|those|your)\s+(?:graphs?|charts?|plots?)\b|\b(?:arrows?|labels?|shaded (?:area|region)|curves?)\s+(?:in|on)\s+(?:the|this)\b/i;

export type PictureNeed = "needs" | "maybe" | null;

export function pictureNeed(question: Pick<RecessQuestion, "q" | "a">): PictureNeed {
	const text = [question.q, ...question.a].join("\n");
	if (NEEDS_PICTURE.test(text)) return "needs";
	return MAY_NEED_PICTURE.test(text) ? "maybe" : null;
}

const words = (text: string) => new Set((text.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? []));
function closest(images: readonly HabitLessonImage[], question: Pick<RecessQuestion, "q" | "a">): HabitLessonImage | undefined {
	if (images.length <= 1) return images[0];
	const wanted = words([question.q, ...question.a].join(" "));
	let best = images[0], score = -1;
	for (const image of images) {
		const overlap = [...words(image.alt)].filter(word => wanted.has(word)).length;
		if (overlap > score) { best = image; score = overlap; }
	}
	return best;
}

/** The pictures the source turn showed, then those the learner sent just before it. */
function nearbyImages(lesson: HabitLesson, turn: number): HabitLessonImage[] {
	const found = [...(lesson[turn]?.images ?? [])];
	for (let index = turn - 1; index >= 0 && lesson[index]?.role === "learner"; index--) found.push(...(lesson[index]?.images ?? []));
	return found;
}

/**
 * The picture this question is shown with, `undefined` for none, or `null` when it
 * needs one and none can be found, so it must not be asked. A model that saw the
 * pictures names one by id; an id the lesson does not hold is ignored.
 */
export function pictureFor(question: Pick<RecessQuestion, "q" | "a" | "source"> & { image?: { id: string } | string }, lesson: HabitLesson): HabitLessonImage | undefined | null {
	const all = lesson.flatMap(turn => turn.images ?? []);
	const named = typeof question.image === "string" ? question.image : question.image?.id;
	const chosen = named ? all.find(image => image.id === named) : undefined;
	if (chosen) return chosen;
	const need = pictureNeed(question);
	if (!need) return undefined;
	const nearby = question.source ? nearbyImages(lesson, question.source.turn) : [];
	const unique = [...new Map(all.map(image => [image.id, image])).values()];
	const image = closest(nearby, question) ?? (unique.length === 1 ? unique[0] : undefined);
	if (image) return image;
	return need === "needs" ? null : undefined;
}

/** Applies the rule to a list: attaches pictures, drops what cannot be shown. */
type Pictured<Q> = Omit<Q, "image"> & { image?: RecessQuestionImage };
export function withQuestionPictures<Q extends Omit<RecessQuestion, "image"> & { image?: RecessQuestionImage | string }>(questions: readonly Q[], lesson: HabitLesson): Pictured<Q>[] {
	return questions.flatMap(question => {
		const image = pictureFor(question, lesson);
		if (image === null) return [];
		const { image: _named, ...rest } = question;
		return [image ? { ...rest, image: { id: image.id, alt: image.alt, src: image.src } } : rest];
	});
}

/** Questions whose picture failed to load are swapped out before takeoff, never during play. */
export function withoutPictures<T extends RecessQuestion>(questions: readonly T[], failed: ReadonlySet<string>): T[] {
	return questions.filter(question => !question.image || !failed.has(question.image.id));
}

/** Resolves with the ids of pictures that would not load or decode. */
export async function unloadablePictures(images: readonly { id: string; src: string }[], timeoutMs = 8000): Promise<Set<string>> {
	const failed = new Set<string>();
	await Promise.all(images.map(async image => {
		try {
			const element = new Image();
			element.decoding = "async";
			element.src = image.src;
			await Promise.race([
				element.decode(),
				new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs)),
			]);
			if (!element.naturalWidth) throw new Error("empty");
		} catch { failed.add(image.id); }
	}));
	return failed;
}

/** Every picture a pack would show. */
export function packPictures(pack: { gates: readonly RecessQuestion[]; revive?: readonly RecessQuestion[] }): RecessQuestionImage[] {
	const all = [...pack.gates, ...(pack.revive ?? [])].flatMap(question => question.image ? [question.image] : []);
	return [...new Map(all.map(image => [image.id, image])).values()];
}

/**
 * The pack with each question whose picture failed swapped for an unused one from the pool
 * that shows fine (or needs no picture). Gates keep their count when the pool allows.
 */
export function swapUnloadedPictures<P extends { gates: readonly RecessQuestion[]; revive?: readonly RecessQuestion[] }>(pack: P, failed: ReadonlySet<string>, pool: readonly RecessQuestion[]): P {
	if (!failed.size) return pack;
	const key = (question: RecessQuestion) => question.id ?? `${question.q}|${question.a[0]}`;
	const gates = withoutPictures(pack.gates, failed), revive = withoutPictures(pack.revive ?? [], failed);
	const used = new Set([...gates, ...revive].map(key));
	const spare = withoutPictures(pool, failed).filter(question => !used.has(key(question)));
	while (gates.length < pack.gates.length && spare.length) gates.push(spare.shift()!);
	while (revive.length < (pack.revive?.length ?? 0) && spare.length) revive.push(spare.shift()!);
	return { ...pack, gates, revive };
}
