export type LogoGlyphMode = "ascii" | "unicode";

/** ASCII-safe fallback generated from the checked-in brand PNG. */
const RASTER_K = [
  "+@@@@@@@@@@@@@@@@@@@%@%.",
  "%%:::::::::=@%@@@@@@@%@-",
  "%#         .@%@@@@@@@%@=       .",
  "%#         :@%@@@@@@@%@:   .-+#@",
  "%#         :@%@@@@@@@%@=-*%@@@@@",
  "%%         :@%@@@@@@@@%@@@@@@@@%",
  "%#         :@%%@@%%%%%@@@@%#+-.",
  "%#         :@%%%%@@@@@%*=-.",
  "%#         .@@@@@@#*=:",
  "%#          .....",
  "%#              ------::::.",
  "%#          =.  =#@@@@@@@@@%*-",
  "%#         :@@*:  .=#@@@%%%@@@%*",
  "%%         :@%@@#-   :*%@@%%%%@@",
  "%%         :@%%%@@%+    -*@@@%%%",
  "%%         :@%@@%%@@%.    .=#@@@",
  "%%         :@%@@@@%%@+       :+%",
  "%%         .@%@@@@@%@%.",
  "%@-::::::::=@%@@@@@@%@=",
  "+%@@@@%@@@@@%%@%%%@%%@-",
] as const;

const RASTER_KEATING = [
  "=#*   -*#-.#******-    **+   =********:+#* .**.   -#*    +*%#*-",
  "%@@. =@@# :@@@@@@@+   -@@@:  *@@@@@@@@*%@% .@@%   +@%  .#@@@@@@#",
  "*@@ =@@#  -@@*----.   %@%@#  :--#@@+-- #@# .@%@#  =@%  %@%+--*@=",
  "*@%#@@#   =@@+       =@%@%@-    =@@:   #@% .@@%@* +@% -@@+    .",
  "*@%@%@:   -@%@%%@#   #@%*%@#    +@@:   #@% :@%@@@+#@% *@@.    ..",
  "*@%@@@=   :@%@%%@#  :@@%+%%@:   *@@:   #@% =@@%%@@@@% *@%.   *@@",
  "*@%%%@@=  -@@+      *@%@@@%@*   =@@:   #@% =@@+ %@%@% -@@=   #@%",
  "*@@. %@%: +@@*---=..@@%###@@%.  =@@:   #@% =@@* .%@@%  %@%=--#@@",
  "@@@. .%@@ +@@@@@@@%#@@:   -@@*  =@@.   %@% =@@=  :@@%  :@@@@@@@%",
  "+@*   -#%=.#****#%*#%+     +**  -#*    +@* .#%.   -#*   .+%%%%=",
] as const;

/** Faithful 80x20 Braille-cell reconstruction of the complete logo lockup. */
const UNICODE_WORDMARK = [
  "⣰⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⣦⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣀⣤⣴⣶⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⣄",
  "⣿⣿⡟⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⢹⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣀⣤⣴⣶⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿",
  "⣿⣿⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣀⣠⣤⣶⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿",
  "⣿⣿⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠀⠀⠀⠀⠀⢀⣀⣤⣴⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠿⠿⠿⠿⠿⠿⠿⠿⠿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿",
  "⣿⣿⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣀⣠⣤⣶⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⠿⠟⠛⠉⠁⠀⠀⠀⠀⠀⠀⣀⣤⣶⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿",
  "⣿⣿⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡿⠟⠛⠉⠉⠀⠀⠀⠀⠀⠀⠀⠀⣀⣤⣶⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿",
  "⣿⣿⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡿⠿⠛⠋⠉⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣠⣴⣾⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿",
  "⣿⣿⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡿⠿⠛⠋⠉⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠉⠁",
  "⣿⣿⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠸⣿⣿⣿⣿⣿⣿⣿⣿⡿⠿⠟⠛⠉⠁⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣿⡆⣠⣾⠟⢰⣿⡿⠿⠿⠀⠀⣰⣿⣦⠀⠺⠿⣿⡿⠿⠂⣿⡆⢸⣷⣄⠀⣾⡇⢀⣴⡾⠿⢷⠆",
  "⣿⣿⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠉⠉⠉⠉⠉⠉⠉⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣿⣿⣿⣅⠀⢸⣿⡿⠿⠗⠀⣰⣿⣭⣿⣧⠀⠀⣿⡇⠀⠀⣿⡇⢸⣿⠻⣷⣿⡇⢸⣿⡀⠀⢰⣦",
  "⣿⣿⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⠀⠀⠀⠀⠀⠀⠀⠀⠿⠇⠈⠻⠷⠘⠿⠿⠿⠿⠲⠿⠉⠉⠉⠿⠇⠀⠿⠇⠀⠀⠿⠃⠸⠿⠀⠈⠻⠇⠀⠙⠿⠿⠿⠛",
  "⣿⣿⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⣤⣀⠀⠀⠀⠉⠛⢿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣶⣤⣀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⡀",
  "⣿⣿⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⣿⣿⣿⣦⣄⠀⠀⠀⠈⠙⠻⢿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣶⣤⣄⡀⠀⠀⠀⠀⠀⠀⠀⠉⠛⠿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡇",
  "⣿⣿⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⣿⣿⣿⣿⣿⣿⣦⣄⠀⠀⠀⠀⠉⠛⠿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⣦⣄⡀⠀⠀⠀⠀⠀⠀⠀⠉⠛⠿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡇",
  "⣿⣿⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⣿⣿⣿⣿⣿⣿⣿⣿⣿⣦⣄⠀⠀⠀⠀⠈⠙⠻⢿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⣦⣄⡀⠀⠀⠀⠀⠀⠀⠀⠉⠛⠿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷",
  "⣿⣿⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⡀⠀⠀⠀⠀⠀⠀⠈⠛⠿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⣦⣄⡀⠀⠀⠀⠀⠀⠀⠀⠉⠛⠿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿",
  "⣿⣿⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣧⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠙⠻⢿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣶⣶⣶⣶⣶⣶⣶⣶⣶⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡏",
  "⣿⣿⡇⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⢸⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡆⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠙⠿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⡇",
  "⣿⣿⣧⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣀⣸⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣷⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠉⠻⢿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣇",
  "⠙⠿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⣿⢿⣿⣿⣿⣿⣿⢿⢿⣿⣿⢿⣿⡿⠟⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠀⠈⠙⠻⠿⠿⡿⠿⠿⠿⠿⠿⠿⠿⠿⠿⠿⠿⠿⠿⠿⠿⠿⠿⠿⠿⠿⠿⠿⣿⠿⠃",
] as const;

const ASCII_WORDMARK = [...RASTER_K, "", ...RASTER_KEATING] as const;

export function keatingWordmarkLines(glyphMode: LogoGlyphMode = "unicode"): readonly string[] {
  return glyphMode === "ascii" ? ASCII_WORDMARK : UNICODE_WORDMARK;
}

/** Width of the widest wordmark row, so callers can hide it when it will wrap. */
export function keatingWordmarkWidth(glyphMode: LogoGlyphMode = "unicode"): number {
  return keatingWordmarkLines(glyphMode).reduce((widest, line) => Math.max(widest, [...line].length), 0);
}

export function keatingWordmarkHeight(glyphMode: LogoGlyphMode = "unicode"): number {
  return keatingWordmarkLines(glyphMode).length;
}

export function keatingLogoFrame(frame = 0, glyphMode: LogoGlyphMode = "unicode"): string {
  void frame;
  return keatingWordmarkLines(glyphMode).join("\n");
}

export function keatingLogoLabel(glyphMode: LogoGlyphMode = "unicode"): string {
  return glyphMode === "ascii" ? "KEATING" : "◆ KEATING";
}

export const KEATING_STEREOGRAM_WIDTH = 48;
export const KEATING_STEREOGRAM_HEIGHT = 10;

function isKeatingKPoint(x: number, y: number): boolean {
  if (x >= 0 && x <= 4 && y >= 0 && y <= 9) return true;
  if (x < 3 || x > 27) return false;
  const upperArm = 4.8 - ((x - 3) * 0.2);
  const lowerArm = 4.2 + ((x - 3) * 0.22);
  return Math.abs(y - upperArm) <= 1.15 || Math.abs(y - lowerArm) <= 1.15;
}

/**
 * Large terminal-native stereogram of Keating's K mark. Several sparse depth
 * planes are projected back-to-front; a slow bounded yaw changes their spacing
 * without ever making the mark illegible or requiring terminal graphics.
 */
export function keatingStereogramFrame(frame = 0, glyphMode: LogoGlyphMode = "unicode"): string {
  const phase = Math.abs(Math.floor(frame)) % 24;
  const yaw = Math.sin((phase / 24) * Math.PI * 2);
  const faceScale = 0.9 + (Math.cos((phase / 24) * Math.PI * 2) * 0.08);
  const glyphs = glyphMode === "ascii"
    ? [".", ":", "o", "O", "@"]
    : ["·", "⠂", "•", "●", "◆"];
  const cells = Array.from({ length: KEATING_STEREOGRAM_HEIGHT }, () =>
    Array.from({ length: KEATING_STEREOGRAM_WIDTH }, () => " "));

  for (let depth = 0; depth < glyphs.length; depth += 1) {
    const depthOffsetX = Math.round(depth * (1.15 + (yaw * 0.35)));
    const depthOffsetY = Math.round(depth * 0.18);
    for (let row = 0; row < KEATING_STEREOGRAM_HEIGHT; row += 1) {
      for (let column = 0; column < KEATING_STEREOGRAM_WIDTH; column += 1) {
        const localX = (column - 7 - depthOffsetX) / faceScale;
        const localY = row - depthOffsetY;
        if (!isKeatingKPoint(localX, localY)) continue;
        // A stable checker leaves enough negative space for the depth planes
        // to remain visible instead of collapsing into a solid raster.
        if ((column + row + depth) % 2 !== 0) continue;
        cells[row]![column] = glyphs[depth]!;
      }
    }
  }

  return cells.map((row) => row.join("").trimEnd()).join("\n");
}

/** Compatibility name for embedders of the first animated onboarding mark. */
export function keatingObjectFrame(frame = 0, glyphMode: LogoGlyphMode = "unicode"): string {
  return keatingStereogramFrame(frame, glyphMode);
}

export type KeatingSplashMode = "full" | "compact" | "hidden";

export interface KeatingSplashLayoutOptions {
  width: number;
  height: number;
  glyphMode?: LogoGlyphMode;
  shellPadding?: number;
  hintLines?: number;
  /** Optional visual rows placed above the flat wordmark, such as the WebGPU mark. */
  extraLogoRows?: number;
}

/**
 * Choose a startup treatment that fits in terminal cells without clipping.
 * The shell always reserves one header row, a three-row composer, and one
 * status row; padding consumes both outer edges. A compact label preserves a
 * clear first-run affordance when the full raster cannot fit.
 */
export function keatingSplashMode(options: KeatingSplashLayoutOptions): KeatingSplashMode {
  const glyphMode = options.glyphMode ?? "unicode";
  const width = Math.max(0, Math.floor(options.width));
  const height = Math.max(0, Math.floor(options.height));
  const shellPadding = Math.max(0, Math.floor(options.shellPadding ?? 0));
  const hintLines = Math.max(0, Math.floor(options.hintLines ?? 2));
  const extraLogoRows = Math.max(0, Math.floor(options.extraLogoRows ?? 0));
  const shellChromeRows = 5 + (shellPadding * 2);
  const contentGapRows = hintLines > 0 ? 1 : 0;
  const fullWidth = keatingWordmarkWidth(glyphMode) + (shellPadding * 2) + 4;
  const fullHeight = shellChromeRows
    + keatingWordmarkHeight(glyphMode)
    + hintLines
    + contentGapRows
    + extraLogoRows;

  if (width >= fullWidth && height >= fullHeight) return "full";

  const compactHeight = shellChromeRows + 1 + hintLines + contentGapRows;
  return width >= 20 && height >= compactHeight ? "compact" : "hidden";
}

export function shouldAnimateLogo(
  env: Readonly<Record<string, string | undefined>> = process.env,
  interactive = true,
): boolean {
  const reduced = env.KEATING_NO_MOTION === "1"
    || env.KEATING_NO_MOTION === "true"
    || env.REDUCE_MOTION === "1"
    || env.REDUCE_MOTION === "true";
  return interactive && !reduced && env.TERM !== "dumb";
}
