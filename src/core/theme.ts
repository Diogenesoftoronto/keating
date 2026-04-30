/**
 * Keating CLI Theme — ANSI color constants that mirror the warm web palette.
 */

import { extensionCommandSpecs, cliCommandSpecs } from "./commands.js";
import { KEATING_ASCII_LOGO, KEATING_SUBTITLE_LINES } from "./terminal.js";

// Warm scholarly palette (mirrors web --primary, --accent, etc.)
export const color = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",

  // Primary: warm terracotta / rust
  terracotta: "\x1b[38;5;172m",
  terracottaBg: "\x1b[48;5;172m\x1b[38;5;232m",

  // Accent: forest green
  sage: "\x1b[38;5;65m",
  sageBg: "\x1b[48;5;65m\x1b[38;5;255m",

  // Warm gold/yellow
  gold: "\x1b[38;5;220m",
  goldBg: "\x1b[48;5;220m\x1b[38;5;232m",

  // Warm neutrals
  cream: "\x1b[38;5;230m",
  parchment: "\x1b[38;5;187m",
  sepia: "\x1b[38;5;137m",

  // Deep darks
  ink: "\x1b[38;5;233m",
  coal: "\x1b[38;5;239m",

  // Standard helpers
  ok: "\x1b[38;5;65m",
  warn: "\x1b[38;5;208m",
  err: "\x1b[38;5;196m",
  info: "\x1b[38;5;67m",
};

// Convenience helpers
export function c(tag: keyof typeof color, text: string): string {
  return `${color[tag]}${text}${color.reset}`;
}

export function bold(tag: keyof typeof color, text: string): string {
  return `${color.bold}${color[tag]}${text}${color.reset}`;
}

/**
 * The Keating shell ASCII greeting — shown once per session.
 */
export const KEATING_GREETING = (() => {
  const logoColors = [
    color.terracotta,
    color.terracotta,
    color.sage,
    color.sage,
    color.cream,
    color.cream,
  ];
  const logo = KEATING_ASCII_LOGO.map(
    (line, i) => `${logoColors[i] ?? color.cream}  ${line}${color.reset}`,
  ).join("\n");
  const [title, ...quoteLines] = KEATING_SUBTITLE_LINES;
  const subtitle = [
    `${color.bold}${color.parchment}    ${title}${color.reset}`,
    ...quoteLines.map(line => `${color.dim}${color.sepia}    ${line}${color.reset}`),
  ].join("\n");
  return `\n${logo}\n\n${subtitle}\n`;
})();

/**
 * Command list formatted for the shell greeting (slash-prefixed).
 */
export function shellCommands(): string {
  const cmds = extensionCommandSpecs
    .filter(s => !s.cliOnly)
    .map(s => [`/${s.name}${s.args ? ` ${s.args}` : ""}`, s.description] as [string, string]);
  return formatCommandList(cmds);
}

/**
 * Command list formatted for the CLI help output (no slash prefix).
 */
export function cliCommands(): string {
  const cmds = cliCommandSpecs
    .map(s => [`${s.name}${s.args ? ` ${s.args}` : ""}`, s.description] as [string, string]);
  return formatCommandList(cmds);
}

function formatCommandList(cmds: [string, string][]): string {
  const lines = cmds.map(([cmd, desc]) =>
    `  ${color.bold}${color.terracotta}${cmd.padEnd(22)}${color.reset}  ${color.dim}${color.cream}${desc}${color.reset}`
  );
  return lines.join("\n");
}
