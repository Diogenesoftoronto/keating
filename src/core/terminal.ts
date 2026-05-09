import { extensionCommandSpecs, shellCommandSections, type CommandSection } from "./commands.js";

export const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

function rgb(red: number, green: number, blue: number): string {
	return `\x1b[38;2;${red};${green};${blue}m`;
}

function bgRgb(red: number, green: number, blue: number): string {
	return `\x1b[48;2;${red};${green};${blue}m`;
}

// ─── Retro palette (true-color, matches web 1:1) ───────────────────────
const PRIMARY = rgb(16, 185, 129);        // #10b981 — web primary green
const PRIMARY_BG = bgRgb(16, 185, 129) + rgb(244, 241, 234);
const GREEN_LIGHT = rgb(52, 211, 153);    // #34d399 — logo top
const GREEN_DARK = rgb(5, 150, 105);      // #059669 — logo bottom
const TERRACOTTA = rgb(212, 74, 61);      // #d44a3d — Nav version tag
const PAPER = rgb(244, 241, 234);         // #f4f1ea — background
const PARCHMENT = rgb(216, 210, 196);     // border-muted
const SEPIA = rgb(160, 150, 136);         // muted text
const COAL = rgb(50, 50, 50);             // dark borders
const NEON = rgb(0, 255, 0);              // #00ff00 — terminal glow
const INK = rgb(26, 26, 26);              // #1a1a1a — foreground

function paint(text: string, ...codes: string[]): string {
	return `${codes.join("")}${text}${RESET}`;
}

export const keatingColor = {
	primary: PRIMARY,
	terracotta: TERRACOTTA,
	paper: PAPER,
	parchment: PARCHMENT,
	sepia: SEPIA,
	coal: COAL,
	neon: NEON,
	ink: INK,
};

export function printInfo(text: string): void {
	console.log(paint(`  ${text}`, SEPIA));
}

export function printSuccess(text: string): void {
	console.log(paint(`  ✓ ${text}`, PRIMARY, BOLD));
}

export function printWarning(text: string): void {
	console.log(paint(`  ⚠ ${text}`, rgb(255, 193, 7), BOLD));
}

export function printError(text: string): void {
	console.log(paint(`  ✗ ${text}`, rgb(220, 38, 38), BOLD));
}

export function printSection(title: string): void {
	console.log("");
	console.log(paint(`◆ ${title}`, PRIMARY, BOLD));
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
	// Render logo with progressive green gradient (top-center-heavy)
	const logoColors = [GREEN_LIGHT, GREEN_LIGHT, PRIMARY, PRIMARY, GREEN_DARK, GREEN_DARK];
	for (let index = 0; index < KEATING_ASCII_LOGO.length; index += 1) {
		console.log(paint(`  ${KEATING_ASCII_LOGO[index]}`, logoColors[index], BOLD));
	}
	for (const line of subtitleLines) {
		console.log(paint(`  ${line}`, SEPIA));
	}
	console.log("");
}

export function printPanel(title: string, subtitleLines: string[] = []): void {
	const inner = 53;
	const border = "─".repeat(inner + 2);
	const renderLine = (text: string, color: string, bolded = false): string => {
		const content = text.length > inner ? `${text.slice(0, inner - 3)}...` : text;
		const codes = bolded ? `${color}${BOLD}` : color;
		return `${COAL}${BOLD}│${RESET} ${codes}${content.padEnd(inner)}${RESET} ${COAL}${BOLD}│${RESET}`;
	};

	console.log("");
	console.log(paint(`┌${border}┐`, COAL, BOLD));
	console.log(renderLine(title, PRIMARY, true));
	if (subtitleLines.length > 0) {
		console.log(paint(`├${border}┤`, COAL, BOLD));
		for (const line of subtitleLines) {
			console.log(renderLine(line, PAPER));
		}
	}
	console.log(paint(`└${border}┘`, COAL, BOLD));
	console.log("");
}

export function printCommandSections(sections: CommandSection[]): void {
	for (const section of sections) {
		printSection(section.title);
		const maxUsage = Math.max(...section.commands.map(c => c.usage.length));
		for (const cmd of section.commands) {
			const padded = cmd.usage.padEnd(maxUsage + 2);
			console.log(paint(`  ${padded}`, PRIMARY, BOLD) + paint(cmd.description, SEPIA));
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
