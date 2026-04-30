import { extensionCommandSpecs, shellCommandSections, type CommandSection } from "./commands.js";

export const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

function rgb(red: number, green: number, blue: number): string {
	return `\x1b[38;2;${red};${green};${blue}m`;
}

const TERRACOTTA = rgb(194, 120, 92);
const SAGE = rgb(167, 192, 128);
const CREAM = rgb(230, 218, 192);
const PARCHMENT = rgb(187, 178, 150);
const SEPIA = rgb(137, 126, 109);
const DARK_STONE = rgb(92, 86, 78);

function paint(text: string, ...codes: string[]): string {
	return `${codes.join("")}${text}${RESET}`;
}

export const keatingColor = {
	terracotta: TERRACOTTA,
	sage: SAGE,
	cream: CREAM,
	parchment: PARCHMENT,
	sepia: SEPIA,
	darkStone: DARK_STONE,
};

export function printInfo(text: string): void {
	console.log(paint(`  ${text}`, SEPIA));
}

export function printSuccess(text: string): void {
	console.log(paint(`  ✓ ${text}`, SAGE, BOLD));
}

export function printWarning(text: string): void {
	console.log(paint(`  ⚠ ${text}`, PARCHMENT, BOLD));
}

export function printError(text: string): void {
	console.log(paint(`  ✗ ${text}`, TERRACOTTA, BOLD));
}

export function printSection(title: string): void {
	console.log("");
	console.log(paint(`◆ ${title}`, SAGE, BOLD));
}

export const KEATING_ASCII_LOGO = [
	"██╗  ██╗███████╗ █████╗ ████████╗██╗███╗   ██╗ ██████╗ ",
	"██║ ██╔╝██╔════╝██╔══██╗╚══██╔══╝██║████╗  ██║██╔════╝ ",
	"█████╔╝ █████╗  ███████║   ██║   ██║██╔██╗ ██║██║  ███╗",
	"██╔═██╗ ██╔══╝  ██╔══██║   ██║   ██║██║╚██╗██║██║   ██║",
	"██║  ██╗███████╗██║  ██║   ██║   ██║██║ ╚████║╚██████╔╝",
	"╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚═╝╚═╝  ╚═══╝ ╚═════╝ ",
];

export const KEATING_SUBTITLE_LINES = [
	"THE HYPERTEACHER — Cognitive Empowerment",
	'"That the powerful play goes on, and you may contribute a verse."',
	"                                                          — Whitman",
];

export function printAsciiHeader(subtitleLines: string[] = []): void {
	console.log("");
	for (const line of KEATING_ASCII_LOGO) {
		console.log(paint(`  ${line}`, TERRACOTTA, BOLD));
	}
	for (const line of subtitleLines) {
		console.log(paint(`  ${line}`, SEPIA));
	}
	console.log("");
}

export function printPanel(title: string, subtitleLines: string[] = []): void {
	const inner = 53;
	const border = "─".repeat(inner + 2);
	const renderLine = (text: string, color: string, bold = false): string => {
		const content = text.length > inner ? `${text.slice(0, inner - 3)}...` : text;
		const codes = bold ? `${color}${BOLD}` : color;
		return `${DARK_STONE}${BOLD}│${RESET} ${codes}${content.padEnd(inner)}${RESET} ${DARK_STONE}${BOLD}│${RESET}`;
	};

	console.log("");
	console.log(paint(`┌${border}┐`, DARK_STONE, BOLD));
	console.log(renderLine(title, SAGE, true));
	if (subtitleLines.length > 0) {
		console.log(paint(`├${border}┤`, DARK_STONE, BOLD));
		for (const line of subtitleLines) {
			console.log(renderLine(line, CREAM));
		}
	}
	console.log(paint(`└${border}┘`, DARK_STONE, BOLD));
	console.log("");
}

export function printCommandSections(sections: CommandSection[]): void {
	for (const section of sections) {
		printSection(section.title);
		const maxUsage = Math.max(...section.commands.map(c => c.usage.length));
		for (const cmd of section.commands) {
			const padded = cmd.usage.padEnd(maxUsage + 2);
			console.log(paint(`  ${padded}`, TERRACOTTA, BOLD) + paint(cmd.description, SEPIA));
		}
	}
}

export function printShellGreeting(): void {
	printAsciiHeader([
		paint("THE HYPERTEACHER — Cognitive Empowerment!", PARCHMENT, BOLD),
		paint('"That the powerful play goes on, and you may contribute a verse."', SEPIA, DIM),
		paint("                                                          — Whitman", SEPIA, DIM),
	]);

	const sections = shellCommandSections();
	printCommandSections(sections);

	console.log(paint('\n  Type "/help" any time for usage hints.', SEPIA, DIM));
	console.log("");
}
