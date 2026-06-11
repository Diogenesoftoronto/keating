/**
 * In-browser Keating TUI for the landing hero CRT monitor.
 *
 * Faithful front-end port of the CLI banner, palette and command surface
 * (src/core/terminal.ts, src/core/theme.ts, src/core/commands.ts). The
 * AI-backed commands can't run without a runtime/API key, so they hand
 * off to the web shell at /chat instead.
 */
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const rgb = (r: number, g: number, b: number) => `\x1b[38;2;${r};${g};${b}m`;

// Retro palette — mirrors src/core/terminal.ts 1:1
const PRIMARY = rgb(16, 185, 129); // #10b981
const GREEN_LIGHT = rgb(52, 211, 153); // #34d399
const GREEN_DARK = rgb(5, 150, 105); // #059669
const PARCHMENT = rgb(216, 210, 196);
const SEPIA = rgb(160, 150, 136);
const NEON = rgb(0, 255, 0);
const RED = rgb(220, 38, 38);
const AMBER = rgb(255, 193, 7);

// KEATING_ASCII_LOGO from src/core/terminal.ts
const LOGO = [
  "██╗  ██╗███████╗ █████╗ ████████╗██╗███╗   ██╗ ██████╗ ",
  "██║ ██╔╝██╔════╝██╔══██╗╚══██╔══╝██║████╗  ██║██╔════╝ ",
  "█████╔╝ █████╗  ███████║   ██║   ██║██╔██╗ ██║██║  ███╗",
  "██╔═██╗ ██╔══╝  ██╔══██║   ██║   ██║██║╚██╗██║██║   ██║",
  "██║  ██╗███████╗██║  ██║   ██║   ██║██║ ╚████║╚██████╔╝",
  "╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝   ╚═╝   ╚═╝╚═╝  ╚═══╝ ╚═════╝ ",
];
const LOGO_COLORS = [GREEN_LIGHT, GREEN_LIGHT, PRIMARY, PRIMARY, GREEN_DARK, GREEN_DARK];

const SUBTITLE = [
  "THE HYPERTEACHER — Cognitive Empowerment",
  '"That the powerful play goes on, and you may contribute a verse."',
  "                                                          — Whitman",
];

// keating CLI command surface (src/core/commands.ts), trimmed to what the
// landing demo can speak to. AI-backed ones hand off to /chat.
const COMMANDS: Array<{ usage: string; description: string; ai?: boolean }> = [
  { usage: "shell [prompt]", description: "Launch the AI-powered hyperteacher shell.", ai: true },
  { usage: "learn <topic>", description: "Start a Socratic teaching session.", ai: true },
  { usage: "diagnose <topic>", description: "Map prerequisites and knowledge gaps.", ai: true },
  { usage: "plan <topic>", description: "Generate a deterministic lesson plan artifact.", ai: true },
  { usage: "map <topic>", description: "Generate a Mermaid concept map.", ai: true },
  { usage: "quiz <topic>", description: "Generate retrieval practice questions.", ai: true },
  { usage: "verify <topic>", description: "Generate a fact-checking checklist.", ai: true },
  { usage: "doctor", description: "Inspect AI runtime availability." },
  { usage: "version", description: "Show the Keating version number." },
  { usage: "install", description: "Show how to install the real CLI." },
  { usage: "clear", description: "Clear the screen." },
];

const PROMPT = `${BOLD}${PRIMARY}keating@web${RESET}${SEPIA}:~$${RESET} `;

export interface HeroTuiOptions {
  navigate: (to: string) => void;
  version?: string;
}

export interface HeroTui {
  attach: (el: HTMLElement) => void;
  dispose: () => void;
}

export function createHeroTui({ navigate, version = "dev" }: HeroTuiOptions): HeroTui {
  const term = new Terminal({
    cols: 64,
    rows: 17,
    fontSize: 12,
    lineHeight: 1.15,
    fontFamily: '"JetBrains Mono", "Space Mono", ui-monospace, monospace',
    cursorBlink: true,
    cursorStyle: "block",
    scrollback: 400,
    theme: {
      background: "#0c1510",
      foreground: "#cfe3cf",
      cursor: "#4be388",
      cursorAccent: "#0c1510",
      selectionBackground: "#2e9a5c",
      black: "#1b2a1f",
      green: "#1e9b50",
      brightGreen: "#4be388",
    },
  });

  let buffer = "";
  const history: string[] = [];
  let historyIndex = -1;

  const writeln = (s = "") => term.writeln(s);

  function banner() {
    writeln("");
    LOGO.forEach((line, i) => writeln(`  ${LOGO_COLORS[i]}${BOLD}${line}${RESET}`));
    SUBTITLE.forEach((line) => writeln(`  ${SEPIA}${line}${RESET}`));
    writeln("");
    writeln(`  ${BOLD}${PRIMARY}Keating CLI${RESET}  ${DIM}${SEPIA}v${version} // live web demo${RESET}`);
    writeln(`  ${PARCHMENT}type ${RESET}${NEON}help${RESET}${PARCHMENT} to see commands.${RESET}`);
    writeln("");
  }

  function usage() {
    writeln("");
    writeln(`  ${BOLD}${PRIMARY}Commands${RESET}`);
    for (const c of COMMANDS) {
      writeln(`  ${BOLD}${PRIMARY}${c.usage.padEnd(20)}${RESET}  ${DIM}${SEPIA}${c.description}${RESET}`);
    }
    writeln("");
    writeln(`  ${DIM}${SEPIA}the "keating" prefix is optional here.${RESET}`);
    writeln("");
  }

  function handoff(cmd: string, topic: string) {
    writeln("");
    writeln(`  ${AMBER}⚠ the landing demo has no AI runtime attached.${RESET}`);
    const what = topic ? `${cmd} ${topic}` : cmd;
    writeln(`  ${PARCHMENT}opening the web shell so ${BOLD}${what}${RESET}${PARCHMENT} can run for real…${RESET}`);
    writeln("");
    window.setTimeout(() => navigate("/chat"), 900);
  }

  function doctor() {
    writeln("");
    writeln(`  ${PRIMARY}${BOLD}✓${RESET} browser runtime          ${DIM}${SEPIA}${navigator.userAgent.includes("Firefox") ? "gecko" : "chromium-ish"}${RESET}`);
    writeln(`  ${PRIMARY}${BOLD}✓${RESET} phosphor                 ${DIM}${SEPIA}glowing${RESET}`);
    writeln(`  ${PRIMARY}${BOLD}✓${RESET} socratic method          ${DIM}${SEPIA}loaded${RESET}`);
    writeln(`  ${RED}${BOLD}✗${RESET} local AI runtime          ${DIM}${SEPIA}install the CLI for the full TUI${RESET}`);
    writeln("");
  }

  function run(raw: string) {
    const input = raw.trim().replace(/^keating\s+/, "");
    if (!input) return;
    const [cmd, ...rest] = input.split(/\s+/);
    const topic = rest.join(" ");
    switch (cmd) {
      case "help":
      case "--help":
      case "-h":
      case "usage":
        usage();
        break;
      case "shell":
      case "learn":
      case "diagnose":
      case "plan":
      case "map":
      case "quiz":
      case "verify":
        handoff(cmd, topic);
        break;
      case "doctor":
        doctor();
        break;
      case "version":
      case "--version":
      case "-v":
        writeln(`  ${PRIMARY}${BOLD}keating${RESET} ${SEPIA}v${version}${RESET}`);
        break;
      case "install":
      case "npm":
        writeln("");
        writeln(`  ${NEON}$ npm install -g keating${RESET}`);
        writeln(`  ${DIM}${SEPIA}# or: bun add -g keating${RESET}`);
        writeln("");
        break;
      case "whoami":
        writeln(`  ${PARCHMENT}visitor ${DIM}${SEPIA}(cognitive sovereignty intact)${RESET}`);
        break;
      case "echo":
        writeln(`  ${PARCHMENT}${topic}${RESET}`);
        break;
      case "clear":
        term.clear();
        break;
      case "exit":
      case "quit":
        writeln(`  ${SEPIA}carpe diem. there is no exit — only the install command.${RESET}`);
        break;
      default:
        writeln(`  ${RED}${BOLD}✗${RESET} ${RED}unknown command: ${cmd}${RESET}  ${DIM}${SEPIA}(try "help")${RESET}`);
    }
  }

  const onData = term.onData((data) => {
    // escape sequences (arrows etc.) — never feed these into the line buffer
    if (data.startsWith("\x1b")) {
      if (data === "\x1b[A" || data === "\x1b[B") {
        if (history.length === 0) return;
        historyIndex =
          data === "\x1b[A" ? Math.max(0, historyIndex - 1) : Math.min(history.length, historyIndex + 1);
        const next = history[historyIndex] ?? "";
        term.write(`\r\x1b[K${PROMPT}${next}`);
        buffer = next;
      }
      return;
    }
    for (const ch of data) {
      if (ch === "\r") {
        term.write("\r\n");
        if (buffer.trim()) {
          history.push(buffer);
          run(buffer);
        }
        historyIndex = history.length;
        buffer = "";
        term.write(PROMPT);
      } else if (ch === "\x7f") {
        if (buffer.length > 0) {
          buffer = buffer.slice(0, -1);
          term.write("\b \b");
        }
      } else if (ch === "\x03") {
        term.write("^C\r\n");
        buffer = "";
        term.write(PROMPT);
      } else if (ch >= " ") {
        buffer += ch;
        term.write(ch);
      }
    }
  });

  return {
    attach(el: HTMLElement) {
      term.open(el);
      banner();
      term.write(PROMPT);
    },
    dispose() {
      onData.dispose();
      term.dispose();
    },
  };
}
