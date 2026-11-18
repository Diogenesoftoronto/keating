import { runnableFenceLanguage, type CodePracticeLanguage } from "./judgement/code-practice-language.js";

/** Learner-facing prose only. A quoted wish, an example program or a blockquote is not the learner's request. */
export function learnerCueProse(text: string): string {
  return text.replace(/^[ \t]*>.*$/gm, " ")
    .replace(/`{3}[\s\S]*?(?:`{3}|$)|~{3}[\s\S]*?(?:~{3}|$)|`[^`\n]*`/g, " ")
    .replace(/"[^"\n]*"|“[^”]*”|‘(?:[^’]|(?<=\w)’(?=\w))*’(?!\w)|(?<!\w)'(?:[^'\n]|(?<=\w)'(?=\w))+'(?!\w)/gu, " ")
    .replace(/’/g, "'");
}

const REPORTED = /\b(?:used to (?:ask|say|want)|(?:teacher|student|learner|friend|manual|example|character|author|someone) (?:said|says|asks?|asked|wrote|writes)|(?:i|we) (?:said|asked|wrote|used to say)|(?:suppose|imagine) (?:i|someone) (?:say|ask))\b/i;
const BEFORE_ANSWER = /\bbefore (?:you (?:explain|(?:tell|show) (?:me|us)|(?:give|reveal|share) (?:me |us )?(?:the |your )?(?:answer|solution|result))|(?:the |your |an? )?(?:answer|explanation|solution|reveal))\b|\b(?:don['’]t|do not) (?:tell|show|give|reveal|explain) (?:me |us )?(?:the |your )?(?:answer|solution|result|why|yet)\b/;
const NAMED_GUESS = /\b(?:(?:can|could|may) (?:i|we)|let (?:me|us)|(?:i|we) (?:want|would like) to|(?:i|we)'d like to) (?:first )?(?:(?:make|take|have|offer) (?:my |our |a )?(?:own )?guess (?:at|about)|make (?:my |our |a )?(?:own )?prediction (?:about|of)|guess(?: at)?|predict) (?:the|a|an|its|their|this|which|what|how|whether) [\w-]+/;
const PREDICTION_DECLINED = /\b(?:don['’]t|do not|never) (?:want to |(?:ask|make|let) (?:me|us) (?:to )?)?(?:guess|predict)\b|\b(?:no|skip) (?:the |my )?predictions?\b/;

/** A sequencing request distinguishes a named lesson prediction from a generic capability question. */
export function asksForNamedPrediction(sentences: readonly string[]): boolean {
  return sentences.some((sentence, index) => {
    if (REPORTED.test(sentence) || PREDICTION_DECLINED.test(sentence) || !NAMED_GUESS.test(sentence)) return false;
    if (BEFORE_ANSWER.test(sentence) || /\b(?:first|beforehand)\b/.test(sentence)) return true;
    const adjacent = [sentences[index - 1], sentences[index + 1]];
    return adjacent.some(part => part && !REPORTED.test(part) && BEFORE_ANSWER.test(part));
  });
}

const LANGUAGE = /\b(?:python|javascript|typescript|js|ts|rust|ruby|java|kotlin|swift|scala|golang|julia|haskell|lua|dart|php|sql|csharp|cpp|c\+\+|c#)(?!\w)/gi;
const STUDY_LANGUAGE = /\b(?:i(?:'m| am)|we(?:'re| are)) (?:currently |just )?(?:learning|studying|practi[cs]ing|new to|working (?:in|with)|trying to learn) (?:to (?:code|program) in )?(?:python|javascript|typescript|js|ts)\b/;
const STARTER = /(?:^|[,]\s*)(?:please )?(?:(?:(?:can|could|would) you )?(?:give|send|show|make|write|create|provide|design)(?: (?:me|us))?|(?:i|we)(?:'d like| would like| want)) (?:a|an|another|one|some) (?:(?:short|tiny|small|new|simple|editable|buggy|broken|faulty|incorrect|incomplete|failing|debugging|python|javascript|typescript|js|ts) ){0,6}(?:code(?: example)?|function|loop|script|program|snippet|exercise|coding (?:exercise|challenge)|example)\b/;
const BUG = /\b(?:buggy|broken|faulty|incorrect|incomplete|failing|editable|bug|mistake|error|fault|debugging)\b/;
const OWN_CODE_ACTION = /\b(?:(?:i|we)(?: (?:want to|would like to|can|will)|'d like to|'ll)|(?:let|help) (?:me|us)(?: to)?|for (?:me|us) to|(?:can|could|may) (?:i|we)) (?:try (?:to )?)?(?:(?:edit|fix|debug|repair|complete|run|test|correct) (?:it|this|that|the (?:code|loop|function|program|script|snippet|exercise|bug|mistake|error))\b|(?:find|spot|locate|diagnose|identify|hunt(?: down)?|track down|figure out|work out) (?:the |its |a |that |what(?:'s| is) )?(?:bug|mistake|error|fault|issue|problem|wrong)\b)|\bto (?:debug|repair|fix|edit|complete) (?:myself|ourselves|on my own|on our own)\b/;
const EXERCISE_DETAIL = /^(?:the |its |my |our |your )?(?:expected|actual|desired) (?:result|output|answer)|^(?:it|the (?:loop|program|code|starter|example|function|snippet)) (?:should|must|is supposed to|takes?|returns?|prints?|should collect)\b|^(?:use |with |for )?(?:input|example input|test case)\b/;
const SOLO_STARTER = /^(?:(?:i|we) (?:want|would like) to|(?:i|we)'d like to|let (?:me|us)|(?:can|could|may) (?:i|we)) (?:debug|fix|repair|edit|complete) (?:a|an|some) (?:(?:small|simple|short|tiny|broken|buggy|faulty|incomplete|editable|python|javascript|typescript|js|ts) ){0,5}(?:code|function|loop|script|program|snippet|exercise)\b/;
const STARTER_TO_REPAIR = /\b(?:code|function|loop|script|program|snippet|example|exercise) (?:for (?:me|us) )?to (?:debug|repair|fix|edit|complete)\b/;
const NO_EXERCISE = /\b(?:don['’]t|do not|never) (?:want to |(?:ask|let|make) (?:me|us) (?:to )?)?(?:edit|fix|debug|repair|find|give|provide|use|run|write)\b|\b(?:instead of|rather than)\b/;

/** Bind one named study language to a requested code artifact and the learner's own nearby work. */
export function contextualExerciseLanguage(prose: string, sentences: readonly string[]): CodePracticeLanguage | null {
  if (/\b(?:compar(?:e|ing|ison)|contrast|translat(?:e|ing|ion)|convert(?:ing)?|port(?:ing)?|monty python)\b/i.test(prose)
    || /\b(?:Go|R|C)\b/.test(prose)) return null;
  const names = new Set([...prose.matchAll(LANGUAGE)].map(match => runnableFenceLanguage(match[0]) ?? "other"));
  const [language] = names;
  if (names.size !== 1 || !language || language === "other") return null;
  for (let i = 0; i < sentences.length; i++) {
    const starter = sentences[i]!;
    const solo = SOLO_STARTER.test(starter);
    if ((!STARTER.test(starter) && !solo) || REPORTED.test(starter) || NO_EXERCISE.test(starter)) continue;
    const previous = sentences[i - 1] ?? "";
    const localLanguage = /\b(?:python|javascript|typescript|js|ts)\b/.test(starter)
      || !REPORTED.test(previous) && STUDY_LANGUAGE.test(previous);
    if (!localLanguage) continue;
    const window = [starter];
    for (const next of sentences.slice(i + 1, i + 4)) {
      if (REPORTED.test(next) || NO_EXERCISE.test(next)) break;
      if (OWN_CODE_ACTION.test(next)) { window.push(next); break; }
      if (!EXERCISE_DETAIL.test(next)) break;
      window.push(next);
    }
    if (window.some(part => BUG.test(part)) && (solo || STARTER_TO_REPAIR.test(starter) || window.some(part => OWN_CODE_ACTION.test(part)))) return language;
  }
  return null;
}
