export type CodePracticeLanguage = "python" | "javascript" | "typescript";

const languages: Record<string, CodePracticeLanguage> = {
  python: "python", py: "python", javascript: "javascript", js: "javascript", mjs: "javascript", cjs: "javascript",
  typescript: "typescript", ts: "typescript", tsx: "typescript", jsx: "javascript",
};

export function runnableFenceLanguage(label: string): CodePracticeLanguage | null {
  return Object.hasOwn(languages, label.toLowerCase()) ? languages[label.toLowerCase()]! : null;
}

/** Only bind an explicitly named language for a learner's own coding exercise. Quoted examples and translations have no single target here. */
export function requestedCodePracticeLanguage(learnerMessage: string): CodePracticeLanguage | null {
  const prose = learnerMessage
    .replace(/^[ \t]*>.*$/gm, " ")
    .replace(/```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`/g, " ")
    .replace(/"[^"\n]*"|“[^”]*”|‘[^’]*’|(?<!\w)'[^'\n]+'(?!\w)/gu, " ");
  if (/\b(?:compar(?:e|ing|ison)|contrast|translat(?:e|ing|ion)|convert(?:ing)?|port(?:ing)?|monty\s+python)\b/i.test(prose)
    || /\b(?:Go|R|C)\b/.test(prose)) return null;
  const named = new Set(Array.from(prose.matchAll(/\b(?:python|javascript|typescript|js|ts|rust|ruby|java|kotlin|swift|scala|golang|julia|haskell|lua|dart|php|sql|csharp|cpp)\b|\b(?:C\+\+|C#)(?!\w)/gi),
    match => runnableFenceLanguage(match[0]) ?? "other"));
  if (named.size !== 1) return null;
  const [language] = named;
  if (!language || language === "other") return null;
  const action = "(?:fix|debug|write|implement|complete|edit|repair|run|execute|test|try|patch|trace|practise|practice)";
  const wantsToPractice = new RegExp("\\b(?:(?:i|we) (?:can|could|want to|would like to)|(?:let|help) (?:me|us)(?: to)?|can (?:i|we)|for (?:me|us) to)\\s+" + action + "\\b"
    + "|\\b(?:give|show) (?:me|us)\\b[^.!?]{0,120}\\bto " + action + "\\b", "i");
  const linkedLanguage = /\b(?:python|javascript|typescript|js|ts)\s+(?:code|coding|program|script|loop|function|method|snippet|example|algorithm|compiler|interpreter|implementation|challenge|exercise)\b|\b(?:in|using|with)\s+(?:python|javascript|typescript|js|ts)\b/i;
  return wantsToPractice.test(prose) && linkedLanguage.test(prose) ? language : null;
}
