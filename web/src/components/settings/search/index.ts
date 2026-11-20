import { isCanvasFeatureEnabled } from "../../../lib/feature-flags";
import { groups } from "../groups";
import { interfaceEntries } from "./interface";
import { learningEntries, learningKeywords } from "./learning";
import { modelsKeywords, modelEntries } from "./models";
import { dataEntries, dataKeywords } from "./data";
import type { Scope } from "../ui";
const keywords = { ...learningKeywords, ...modelsKeywords, ...dataKeywords };
const scopes: Record<string, Scope> = {
	profile: "your profile",
	account: "your account",
	connections: "your account",
	jobs: "new chats",
};
export function searchSettings(query: string) {
	const entries = [
		...interfaceEntries.filter(
			(entry) => entry.section !== "layout" || isCanvasFeatureEnabled(),
		),
		...modelEntries,
		...learningEntries,
		...dataEntries,
		...groups.slice(1).flatMap((g) =>
			g.sections
				.filter((s) => !s.available || s.available())
				.map((s) => ({
					id: "st-heading",
					label: s.title,
					help: g.summary,
					scope: scopes[s.id] ?? "this device",
					group: g.id,
					section: s.id,
					keywords: keywords[s.id] ?? "",
				})),
		),
	];
	return entries
		.map((e) => {
			const group = groups.find((g) => g.id === e.group)!;
			const path =
				group.title +
				" › " +
				group.sections.find((s) => s.id === e.section)!.title;
			return { ...e, path };
		})
		.filter((e) =>
			query
				.toLowerCase()
				.trim()
				.split(/\s+/)
				.every((word) =>
					(e.label + " " + e.help + " " + e.path + " " + e.keywords)
						.toLowerCase()
						.includes(word),
				),
		);
}
