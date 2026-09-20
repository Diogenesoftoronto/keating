/**
 * Recognise Strudel patterns arriving as chat code fences.
 *
 * Strudel source is JavaScript-shaped but has no runtime in NodePod, so a
 * pattern run as a Node script fails with "ReferenceError: note is not
 * defined". Detection here is deliberately conservative: it only claims a
 * fence when the code shows Strudel-specific calls and none of the ordinary
 * program constructs, so a genuine application snippet is never hijacked.
 */

const STRUDEL_SOURCE_LANGUAGES = new Set(["js", "javascript", "mjs", "cjs", "strudel"]);

const PROGRAM_CONSTRUCT =
	/(?:=>|\b(?:function|import|export|require|class|await|async|return|throw|process|console|document|window|Promise|fetch|setTimeout|setInterval)\b|\bnew\s+[A-Z])/;

const STRUDEL_ENTRY =
	/(?:^|[\s(,[{])(?:note|n|s|sound|stack|freq|chord|setcpm|setcps|samples|arp|voicing)\s*\(/m;

const STRUDEL_METHOD =
	/\.(?:s|sound|note|n|freq|lpf|hpf|bpf|gain|velocity|attack|decay|sustain|release|fast|slow|rev|palindrome|sometimes|sometimesBy|every|when|off|jux|pan|room|delay|orbit|vowel|crush|coarse|shape|distort|clip|legato|cutoff|resonance|fm|fmh|add|sub|mul|div|range|segment|struct|mask|euclid|degrade|degradeBy|ribbon|filter|phaser|chorus|tremolo|postgain|analyze)\s*\(/;

const MINI_NOTATION = /["'`][^"'`\n]*[*~,<>][^"'`\n]*["'`]/;
const NOTE_TOKEN = /["'`][^"'`\n]*\b[a-gA-G][#b♯♭]?\d\b[^"'`\n]*["'`]/;
const DRUM_TOKEN =
	/["'`][^"'`\n]*\b(?:bd|sd|hh|oh|cp|rim|lt|mt|ht|rd|cr|cy|sh|cb|clap|snare|kick|hat)\b[^"'`\n]*["'`]/;

export function isStrudelSourceLanguage(language: string): boolean {
	return STRUDEL_SOURCE_LANGUAGES.has(language.trim().toLowerCase());
}

export function isStrudelPattern(code: string): boolean {
	const source = code.trim();
	if (!source) return false;
	if (PROGRAM_CONSTRUCT.test(source)) return false;
	if (/\bsetcp[ms]\s*\(/.test(source)) return true;
	if (!STRUDEL_ENTRY.test(source)) return false;
	return MINI_NOTATION.test(source) || NOTE_TOKEN.test(source) || DRUM_TOKEN.test(source) || STRUDEL_METHOD.test(source);
}

export function isStrudelBlock(language: string, code: string): boolean {
	if (!isStrudelSourceLanguage(language)) return false;
	return isStrudelPattern(code);
}