/**
 * Keating CLI Theme — ANSI color constants that mirror the retro web palette.
 *
 * Uses 24-bit true-color (38;2;R;G;B) so the CLI matches the web hex values
 * exactly on modern terminals. Falls back gracefully on 256-color terminals.
 */

import { extensionCommandSpecs, cliCommandSpecs } from "./commands.js";
import { KEATING_ASCII_LOGO, KEATING_SUBTITLE_LINES } from "./terminal.js";

// ─── True-color helpers ─────────────────────────────────────────────
function fg(r: number, g: number, b: number): string {
  return `\x1b[38;2;${r};${g};${b}m`;
}
function bg(r: number, g: number, b: number): string {
  return `\x1b[48;2;${r};${g};${b}m`;
}

// ─── Retro palette (matches web/src/app.css & web/src/styles/retro.css) ─
export const color = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",

  // Primary green — matches web --primary #10b981
  primary: fg(16, 185, 129),
  primaryBg: bg(16, 185, 129) + fg(244, 241, 234),

  // Logo gradient (mirrors web ChatIntro gradient)
  greenLight: fg(52, 211, 153),   // #34d399
  greenMid: fg(16, 185, 129),     // #10b981
  greenDark: fg(5, 150, 105),     // #059669

  // Retro terracotta — matches web Nav version tag #d44a3d
  terracotta: fg(212, 74, 61),
  terracottaBg: bg(212, 74, 61) + fg(244, 241, 234),

  // Neon glow — terminal green for dark-mode feel
  neon: fg(0, 255, 0),            // #00ff00

  // Warm paper neutrals (mirrors web --background #f4f1ea)
  cream: fg(244, 241, 234),
  parchment: fg(216, 210, 196),   // softer than web muted, terminal-friendly
  sepia: fg(160, 150, 136),       // warm dim text

  // Compatibility aliases (old 256-color names → new true-color)
  sage: fg(16, 185, 129),        // same as primary, kept for compat
  gold: fg(16, 185, 129),        // was 220 yellow, now primary green

  // Deep darks
  ink: fg(26, 26, 26),
  coal: fg(50, 50, 50),           // border/dark neutral
  coalBg: bg(50, 50, 50),

  // Semantic helpers (mirrors web intent)
  ok: fg(16, 185, 129),           // success → primary green
  warn: fg(255, 193, 7),          // amber warning
  err: fg(220, 38, 38),           // true red error
  info: fg(100, 180, 255),        // soft blue info
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
 *
 * Logo renders with a progressive green gradient (top-to-bottom) that mirrors
 * the web ChatIntro CSS: #34d399 → #10b981 → #059669.
 */
export const KEATING_GREETING = (() => {
  const logoColors = [
    color.greenLight,
    color.greenLight,
    color.greenMid,
    color.greenMid,
    color.greenDark,
    color.greenDark,
  ];
  const logo = KEATING_ASCII_LOGO.map(
    (line, i) => `${logoColors[i] ?? color.greenMid}  ${line}${color.reset}`,
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
    `  ${color.bold}${color.primary}${cmd.padEnd(22)}${color.reset}  ${color.dim}${color.sepia}${desc}${color.reset}`
  );
  return lines.join("\n");
}
