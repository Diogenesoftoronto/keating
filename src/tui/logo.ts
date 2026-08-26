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

export function shouldAnimateLogo(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  return env.KEATING_NO_MOTION !== "1" && env.KEATING_NO_MOTION !== "true" && env.TERM !== "dumb";
}
