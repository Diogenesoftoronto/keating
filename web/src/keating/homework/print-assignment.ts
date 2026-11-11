import type { UiTaskNode } from "@keating/learner-contracts";

/**
 * A task as a document someone can work on with a pen. Pure: returns a
 * self-contained HTML string (inline styles only, no scripts, a CSP that
 * forbids them) and a Markdown twin. Every model- and learner-supplied string
 * is escaped; the brief's markdown is reduced to paragraphs, headings and
 * lists after escaping, so no markup from the source survives.
 */
export interface AssignmentAnswers {
	submission?: string;
	/** Notes per task item id. */
	notes?: Readonly<Record<string, string>>;
}

export interface AssignmentPrintOptions {
	/** `answers` prints what the learner already wrote, followed by room to continue. */
	mode?: "blank" | "answers";
	answers?: AssignmentAnswers;
	sessionTitle?: string;
	locale?: string;
}

const KIND_LABEL: Record<UiTaskNode["kind"], string> = {
	assignment: "Assignment",
	practice: "Practice",
	draft: "Draft",
	fieldwork: "Fieldwork",
	connect: "Connect",
	person: "Person brief",
};

const ITEMS_LABEL: Record<UiTaskNode["kind"], string> = {
	assignment: "Steps",
	practice: "Exercises",
	draft: "Steps",
	fieldwork: "Collection protocol",
	connect: "Ways to share it",
	person: "Questions to ask",
};

const CRITERIA_LABEL: Partial<Record<UiTaskNode["kind"], string>> = { person: "Sources", connect: "Keep in mind" };

/** Lines of writing room per item, by what the item usually asks for. */
const ITEM_LINES: Record<UiTaskNode["kind"], number> = {
	assignment: 4,
	practice: 5,
	draft: 3,
	fieldwork: 6,
	connect: 4,
	person: 5,
};

export function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

/** Inline emphasis on already-escaped text. */
function inline(escaped: string): string {
	return escaped
		.replace(/`([^`]+)`/g, "<code>$1</code>")
		.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
		.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
		// Links print as their text followed by the address, which a reader on paper needs.
		.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, "$1 ($2)");
}

/** Markdown subset → HTML. Input is escaped line by line before any tag is added. */
export function markdownToPrintHtml(markdown: string): string {
	const out: string[] = [];
	let list: "ul" | "ol" | null = null;
	let paragraph: string[] = [];
	const flushParagraph = () => {
		if (paragraph.length) out.push(`<p>${paragraph.map((line) => inline(escapeHtml(line))).join("<br>")}</p>`);
		paragraph = [];
	};
	const closeList = () => {
		if (list) out.push(`</${list}>`);
		list = null;
	};
	for (const raw of markdown.replace(/\r\n?/g, "\n").split("\n")) {
		const line = raw.trimEnd();
		if (/^\s*```/.test(line)) continue;
		const heading = /^\s{0,3}(#{1,6})\s+(.*)$/.exec(line);
		const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
		const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
		if (!line.trim()) { flushParagraph(); closeList(); continue; }
		if (heading) {
			flushParagraph(); closeList();
			out.push(`<h3>${inline(escapeHtml(heading[2]!))}</h3>`);
			continue;
		}
		if (bullet || numbered) {
			flushParagraph();
			const type = bullet ? "ul" : "ol";
			if (list !== type) { closeList(); out.push(`<${type}>`); list = type; }
			out.push(`<li>${inline(escapeHtml((bullet ?? numbered)![1]!))}</li>`);
			continue;
		}
		closeList();
		paragraph.push(line.replace(/^\s*>\s?/, ""));
	}
	flushParagraph(); closeList();
	return out.join("\n");
}

/** Writing room for the hand-in, sized to the expected answer. */
export function submissionLines(node: UiTaskNode): number {
	const format = node.submission?.format ?? "none";
	if (format === "none") return 0;
	if (format === "link") return 1;
	const words = node.submission?.targetWords;
	if (words) return Math.min(40, Math.max(6, Math.ceil(words / 10)));
	return node.kind === "draft" ? 24 : 10;
}

function writingLines(count: number, label: string): string {
	if (count <= 0) return "";
	return `<div class="lines" role="img" aria-label="${escapeHtml(label)}">${'<div class="line"></div>'.repeat(count)}</div>`;
}

function answerBlock(text: string): string {
	return `<div class="answer">${escapeHtml(text.trim()).replace(/\n/g, "<br>")}</div>`;
}

function formatDate(iso: string | undefined, locale?: string): string | null {
	if (!iso) return null;
	const at = new Date(iso);
	if (Number.isNaN(at.getTime())) return null;
	return at.toLocaleString(locale, { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Plain-language instructions for parts that only work on screen. */
export function onScreenOnlyNotes(node: UiTaskNode): string[] {
	const notes: string[] = [];
	if (node.diagram) {
		const kinds = node.diagram.kinds?.length ? node.diagram.kinds : [...new Set(node.diagram.components.map((component) => component.kind))];
		const start = node.diagram.components.length
			? ` Start from these parts: ${node.diagram.components.map((component) => component.label).join(", ")}.`
			: "";
		const checks = node.diagram.checks.length
			? ` Make sure your drawing shows: ${node.diagram.checks.map((check) => check.label).join("; ")}.`
			: "";
		notes.push(`This task uses an interactive diagram on screen. On paper, draw each part as a labelled box${kinds.length ? ` (kinds: ${kinds.join(", ")})` : ""} and connect them with arrows labelled with the relationship.${start}${checks} Then explain your choices in a few sentences. Copy the finished diagram into Keating, or photograph it and attach the photo, to hand it in.`);
	}
	if (node.submission?.capture) {
		const kind = node.submission.capture.kind === "video" ? "a video" : "an audio recording";
		const limit = node.submission.capture.timeLimitSeconds ? ` of about ${Math.round(node.submission.capture.timeLimitSeconds / 60) || 1} minute${Math.round(node.submission.capture.timeLimitSeconds / 60) > 1 ? "s" : ""}` : "";
		notes.push(`This task asks for ${kind}${limit}. Use the space below to plan what you will say, then record it in Keating.`);
	}
	return notes;
}

const PRINT_CSS = `
@page { margin: 18mm 16mm 20mm; }
* { box-sizing: border-box; }
html { color: #111; background: #fff; }
body { margin: 0; font: 11.5pt/1.5 Georgia, "Times New Roman", serif; }
header { border-bottom: 1.5pt solid #111; padding-bottom: 6pt; margin-bottom: 10pt; }
.kind { font: 700 8.5pt/1.2 system-ui, sans-serif; letter-spacing: .08em; text-transform: uppercase; }
h1 { font-size: 18pt; line-height: 1.2; margin: 3pt 0 4pt; }
h2 { font: 700 10pt/1.3 system-ui, sans-serif; text-transform: uppercase; letter-spacing: .06em; margin: 14pt 0 4pt; break-after: avoid; page-break-after: avoid; }
h3 { font-size: 12pt; margin: 8pt 0 2pt; break-after: avoid; page-break-after: avoid; }
.meta { font: 9.5pt/1.4 system-ui, sans-serif; margin: 0; padding: 0; list-style: none; display: flex; flex-wrap: wrap; gap: 2pt 14pt; }
.identity { display: flex; gap: 18pt; margin: 8pt 0 2pt; font: 10pt/1.2 system-ui, sans-serif; }
.identity span { flex: 1; border-bottom: .75pt solid #111; padding-bottom: 14pt; }
p, li { orphans: 3; widows: 3; }
ul, ol { padding-left: 16pt; margin: 4pt 0; }
code { font-family: ui-monospace, monospace; font-size: 10pt; }
.note { border: .75pt solid #111; padding: 6pt 8pt; margin: 8pt 0; font-size: 10.5pt; break-inside: avoid; page-break-inside: avoid; }
.item { margin: 8pt 0 12pt; break-inside: avoid; page-break-inside: avoid; }
.item-title { font-weight: 700; }
.item-detail { margin: 1pt 0 2pt; }
.lines { margin-top: 4pt; }
.line { height: 22pt; border-bottom: .6pt solid #777; }
.answer { border-left: 2pt solid #111; padding: 2pt 0 2pt 8pt; margin: 4pt 0; white-space: normal; overflow-wrap: anywhere; }
.submission { break-inside: auto; }
.submission .lines .line { break-inside: avoid; page-break-inside: avoid; }
footer { margin-top: 18pt; font: 8.5pt/1.3 system-ui, sans-serif; color: #444; }
`;

/** A complete, script-free HTML document for printing one task. */
export function buildAssignmentPrintHtml(node: UiTaskNode, options: AssignmentPrintOptions = {}): string {
	const withAnswers = options.mode === "answers";
	const answers = withAnswers ? options.answers ?? {} : {};
	const kind = KIND_LABEL[node.kind];
	const due = formatDate(node.dueAt, options.locale);
	const opens = formatDate(node.availableFrom, options.locale);
	const meta = [
		due ? `<li>${node.kind === "person" ? "Meeting" : "Due"}: ${escapeHtml(due)}</li>` : "",
		opens ? `<li>Opens: ${escapeHtml(opens)}</li>` : "",
		node.estimatedMinutes !== undefined ? `<li>About ${escapeHtml(String(node.estimatedMinutes))} minutes</li>` : "",
		node.round !== undefined ? `<li>Round ${escapeHtml(String(node.round))}</li>` : "",
		options.sessionTitle ? `<li>From: ${escapeHtml(options.sessionTitle)}</li>` : "",
	].filter(Boolean).join("");
	const criteria = node.criteria?.length
		? `<section><h2>${escapeHtml(CRITERIA_LABEL[node.kind] ?? "Success criteria")}</h2><ul>${node.criteria.map((criterion) => `<li>${inline(escapeHtml(criterion))}</li>`).join("")}</ul></section>`
		: "";
	const notes = onScreenOnlyNotes(node).map((note) => `<div class="note">${escapeHtml(note)}</div>`).join("");
	const items = node.items?.length
		? `<section><h2>${escapeHtml(ITEMS_LABEL[node.kind])}</h2>${node.items.map((item, index) => {
			const written = answers.notes?.[item.id]?.trim() || (withAnswers ? item.note?.trim() : "");
			const lines = ITEM_LINES[node.kind];
			return `<div class="item"><div class="item-title">${index + 1}. ${escapeHtml(item.title)}</div>${item.detail ? `<div class="item-detail">${inline(escapeHtml(item.detail))}</div>` : ""}${written ? answerBlock(written) : ""}${writingLines(written ? Math.max(2, Math.ceil(lines / 2)) : lines, `Space to write for ${item.title}`)}</div>`;
		}).join("")}</section>`
		: "";
	const lineCount = submissionLines(node);
	const writtenSubmission = answers.submission?.trim();
	const submission = lineCount > 0
		? `<section class="submission"><h2>${escapeHtml(node.submission?.label ?? (node.submission?.format === "link" ? "Link to your work" : "Your work"))}</h2>${node.submission?.targetWords ? `<p>Aim for about ${escapeHtml(String(node.submission.targetWords))} words.</p>` : ""}${writtenSubmission ? answerBlock(writtenSubmission) : ""}${writingLines(writtenSubmission ? Math.max(3, Math.ceil(lineCount / 3)) : lineCount, "Space to write your work")}</section>`
		: "";
	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(`${kind}: ${node.title}`)}</title>
<style>${PRINT_CSS}</style>
</head>
<body>
<header>
<div class="kind">${escapeHtml(kind)}${withAnswers ? " · with my answers" : ""}</div>
<h1>${escapeHtml(node.title)}</h1>
${meta ? `<ul class="meta">${meta}</ul>` : ""}
<div class="identity"><span>Name</span><span>Date</span></div>
</header>
<main>
<section><h2>The task</h2>${markdownToPrintHtml(node.brief)}</section>
${notes}
${criteria}
${items}
${submission}
</main>
<footer>Printed from Keating. Hand your work in from the task in your session: type it in, or attach a photo or scan of these pages.</footer>
</body>
</html>`;
}

/** The same task as Markdown, for notes apps and editors. */
export function buildAssignmentMarkdown(node: UiTaskNode, options: AssignmentPrintOptions = {}): string {
	const withAnswers = options.mode === "answers";
	const answers = withAnswers ? options.answers ?? {} : {};
	const lines: string[] = [`# ${node.title}`, "", `*${KIND_LABEL[node.kind]}*`, ""];
	const due = formatDate(node.dueAt, options.locale);
	const opens = formatDate(node.availableFrom, options.locale);
	if (due) lines.push(`- ${node.kind === "person" ? "Meeting" : "Due"}: ${due}`);
	if (opens) lines.push(`- Opens: ${opens}`);
	if (node.estimatedMinutes !== undefined) lines.push(`- About ${node.estimatedMinutes} minutes`);
	if (node.round !== undefined) lines.push(`- Round ${node.round}`);
	if (options.sessionTitle) lines.push(`- From: ${options.sessionTitle}`);
	if (lines[lines.length - 1] !== "") lines.push("");
	lines.push("## The task", "", node.brief.trim(), "");
	for (const note of onScreenOnlyNotes(node)) lines.push(`> ${note}`, "");
	if (node.criteria?.length) {
		lines.push(`## ${CRITERIA_LABEL[node.kind] ?? "Success criteria"}`, "", ...node.criteria.map((criterion) => `- ${criterion}`), "");
	}
	if (node.items?.length) {
		lines.push(`## ${ITEMS_LABEL[node.kind]}`, "");
		node.items.forEach((item, index) => {
			lines.push(`${index + 1}. **${item.title}**${item.detail ? ` — ${item.detail}` : ""}`);
			const written = answers.notes?.[item.id]?.trim() || (withAnswers ? item.note?.trim() : "");
			if (written) lines.push("", ...written.split("\n").map((line) => `   > ${line}`));
			lines.push("");
		});
	}
	if (submissionLines(node) > 0) {
		lines.push(`## ${node.submission?.label ?? "Your work"}`, "");
		if (node.submission?.targetWords) lines.push(`Aim for about ${node.submission.targetWords} words.`, "");
		const written = answers.submission?.trim();
		lines.push(written || "_Write your answer here._", "");
	}
	return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

/** A safe file name for a downloaded task. */
export function assignmentFileName(node: UiTaskNode, extension: string): string {
	const slug = node.title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "assignment";
	return `${slug}.${extension}`;
}
