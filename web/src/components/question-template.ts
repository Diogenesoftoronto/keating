export interface QuestionTemplatePart {
	text: string;
	isBlank: boolean;
	index: number;
}

/** Split a fill-in-the-blank template into text and blank positions. */
export function parseQuestionTemplate(template: string): QuestionTemplatePart[] {
	const parts: QuestionTemplatePart[] = [];
	const blankPattern = /_{3,}|\{\{blank\}\}/g;
	let lastIndex = 0;
	let blankIndex = 0;
	let match: RegExpExecArray | null;

	while ((match = blankPattern.exec(template)) !== null) {
		if (match.index > lastIndex) {
			parts.push({ text: template.slice(lastIndex, match.index), isBlank: false, index: -1 });
		}
		parts.push({ text: match[0], isBlank: true, index: blankIndex++ });
		lastIndex = match.index + match[0].length;
	}

	if (lastIndex < template.length) {
		parts.push({ text: template.slice(lastIndex), isBlank: false, index: -1 });
	}

	return parts;
}
