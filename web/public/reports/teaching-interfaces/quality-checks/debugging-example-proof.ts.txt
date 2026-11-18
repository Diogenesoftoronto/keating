import type { TeachingPolicyCheck, TeachingPolicyReply, TeachingPolicyTurn } from "./teaching-policy-types.js";

/** Content-free facts about the authored examples. An interactive page's future behavior is never inferred. */
export interface DebuggingExampleProof {
  readonly reference: "all-even-integers" | "all-odd-integers";
  readonly suppliedInput: "masked" | "observable";
  readonly otherExamples: "witness" | "none" | "unverified";
  readonly nativeDescriptionGivesDiagnosis: boolean;
}

const identifier = "[A-Za-z_][A-Za-z0-9_]{0,39}";
const unavailableNames = new Set("False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield __debug__ range len print".split(" "));
const assignment = new RegExp("^("+identifier+")\\s*=\\s*(\\[[^\\[\\]]{1,600}\\])$");
const accumulator = new RegExp("^("+identifier+")\\s*=\\s*\\[\\s*\\]$");
const indexed = new RegExp("^for ("+identifier+") in range\\(\\s*1\\s*,\\s*len\\(\\s*("+identifier+")\\s*\\)\\s*\\)\\s*:$");
const predicate = new RegExp("^( +)if ("+identifier+")\\[("+identifier+")\\]\\s*%\\s*2\\s*==\\s*([01])\\s*:$");
const collect = new RegExp("^( +)("+identifier+")\\.append\\(\\s*("+identifier+")\\[("+identifier+")\\]\\s*\\)$");
const display = new RegExp("^print\\(\\s*(?:(?:\"([a-zA-Z :]{1,64})\"|'([a-zA-Z :]{1,64})')\\s*,\\s*)?("+identifier+")\\s*\\)$");
const newExercise = /\b(?:(?:give|make|write|create|show|design|provide|invent|send|prepare)\b[^.!?\n]{0,160}\b(?:bug(?:gy)?|broken|debug|fix|repair|faulty)|(?:new|another|fresh)\s+(?:debugging|buggy)\s+(?:exercise|challenge|example))\b/iu;
const learnerOwns = /\b(?:myself|ourselves|for (?:me|us) to (?:find|fix|debug|repair)|to (?:debug|fix|repair)(?:\s+(?:on my own|independently))?\b|(?:let|leave)\b[^.!?\n]{0,70}\b(?:me|us)|(?:i|we) (?:can|will|want to) (?:edit|fix|debug|repair|find))\b/iu;
const requestedHelp = /\b(?:hints?|clues?|solutions?|walkthroughs?|walk (?:me|us) through|tell (?:me|us) (?:where|why|how)|(?:show|give) (?:me|us) the fix|fix (?:it|this) for me|explain (?:the|a) (?:bug|fix|error))\b/iu;
const helpNoun = String.raw`(?:(?:a|an|any|the|your)\s+)?(?:hints?|clues?|solutions?|walkthroughs?|spoilers?|answers?|fix|help)\b`;
const declinedHelp = new RegExp(String.raw`\b(?:no(?: more)?|without|skip|avoid|not|(?:do not|don['’]t) (?:want|(?:give|show|send|offer)(?: (?:me|us))?|include|provide))\s+${helpNoun}(?:\s*(?:,\s*(?:or |and )?|\s+(?:or|and)\s+)${helpNoun})*`, "giu");

// Remove the stated opt-out only. An affirmative request in the next clause must still count.
function requestsDebuggingHelp(text: string): boolean {
  if (/\b(?:do not|don['’]t|never) (?:skip|withhold|avoid|omit)|\bnot without\b/iu.test(text) && requestedHelp.test(text)) return true;
  return requestedHelp.test(text.replace(declinedHelp, " ").replace(/\b(?:do not|don['’]t) (?:walk (?:me|us) through|tell (?:me|us) (?:where|why|how)|explain (?:the|a) (?:bug|fix|error))\b/giu, " "));
}
// This full-string request accepts no input literals, diagrams, or free-form examples.
const requestWithoutExamples = /^(?:please\s+)?(?:give|make|write|create|show|design|provide|invent|send|prepare)(?:\s+(?:me|us))?\s+(?:a|an|another)\s+(?:(?:small|short|simple|new|fresh|buggy|broken|faulty|python|debugging)\s+){0,8}(?:loop|function|script|program|exercise|challenge|example)(?:\s+with\s+a\s+(?:small\s+)?bug)?(?:\s+(?:(?:for (?:me|us) to|to)\s+(?:find and fix|fix|debug|repair)(?:\s+(?:myself|ourselves|independently|on my own))?|that (?:i|we) can (?:edit|fix|repair|debug) (?:myself|ourselves)))?[.!?]?$/iu;

function integers(value: string): number[] | null {
  if (!/^\[\s*-?(?:0|[1-9]\d{0,5})(?:\s*,\s*-?(?:0|[1-9]\d{0,5})){0,63}\s*\]$/u.test(value)) return null;
  return value.slice(1, -1).split(",").map(Number);
}

function parityProgram(body: string): {values: number[]; odd: boolean} | null {
  // The entire program must belong to this six-statement subset.
  if (!/^[\x20-\x7e\r\n]+$/u.test(body) || /\r(?!\n)/u.test(body)) return null;
  const lines = body.split(/\r?\n/u).map(line => line.trimEnd()).filter(line => line.trim());
  if (lines.length !== 6) return null;
  const valuesLine = assignment.exec(lines[0]!);
  const resultLine = accumulator.exec(lines[1]!);
  const loop = indexed.exec(lines[2]!);
  const condition = predicate.exec(lines[3]!);
  const append = collect.exec(lines[4]!);
  const output = display.exec(lines[5]!);
  if (!valuesLine || !resultLine || !loop || !condition || !append || !output) return null;
  const [list, result, index] = [valuesLine[1]!, resultLine[1]!, loop[1]!];
  if (new Set([list, result, index]).size !== 3 || [list, result, index].some(name => unavailableNames.has(name))
    || ![loop[2], condition[2], append[3]].every(name => name === list)
    || ![condition[3], append[4]].every(name => name === index)
    || append[2] !== result || output[3] !== result || append[1]!.length <= condition[1]!.length) return null;
  const odd = condition[4] === "1";
  const label = (output[1] ?? output[2] ?? "").trim().toLowerCase().replace(/:$/u, "").trim();
  if (!["", "result", "output", odd ? "odd numbers" : "even numbers"].includes(label)) return null;
  const values = integers(valuesLine[2]!);
  return values ? {values, odd} : null;
}

function pointsAtProvenFault(text: string): boolean {
  return text.split(/[.!?\n]/u).some(sentence => /\b(?:(?:the |intended )?(?:bug|fault|error|mistake|problem)\s+(?:is|lies)|fix (?:it|this) by)\b/iu.test(sentence)
    && /\b(?:start(?:s|ing)?|begin(?:s|ning)?)\s+(?:at|from|with)\s+(?:index\s+)?(?:1|one)\b/iu.test(sentence)
    && /\b(?:skip(?:s|ping)?|miss(?:es|ing)?)\s+(?:over\s+)?(?:the\s+)?first\s+(?:element|item|value|number)\b/iu.test(sentence)
    && !/\b(?:possibly|whether|might|maybe|not|unless)\b/iu.test(sentence));
}

/** An explicit alternate can establish a witness. Only a short, fully recognized task can establish its absence. */
function otherExamples(prose: string, turn: TeachingPolicyTurn, reply: TeachingPolicyReply, retained: (value: number) => boolean): DebuggingExampleProof["otherExamples"] {
  const statedInput = /\b(?:try|use|check|test|input|run (?:it )?(?:on|with))\s*[:=]?\s*(\[[^\[\]\n]{1,600}\])/giu;
  let unverified = false;
  const combined = turn.learnerMessage + "\n" + prose;
  for (const match of combined.matchAll(statedInput)) {
    const input = integers(match[1]!);
    if (!input) unverified = true;
    else if (retained(input[0]!)) return "witness";
  }
  if (unverified || turn.conversation.length || turn.learnerEvidence.length || turn.sources.length || turn.toolResults.length
    || reply.toolCalls.length) return "unverified";
  // Free-form prose may specify inputs in words, a diagram, or another representation.
  // It can state the primary goal but cannot establish the absence of a counterexample.
  const goalOnly = /^(?:(?:the (?:goal|task) is to|(?:the|this) (?:loop|program|code|function) (?:should|must))\s+)?(?:print|collect|return|keep|include|output|display|list)\s+(?:every|each|all(?: of the)?)\s+(?:even|odd)\s+(?:integers?|numbers?|values?|items?)(?:\s+(?:in|from) (?:the|this) (?:list|input))?[.!]?\s*$/iu;
  if (!goalOnly.test(prose.replace(statedInput, "").trim())) return "unverified";
  // A standalone "No hints, please." supplies no alternate example. Free-form qualifications stay unknown.
  const request = turn.learnerMessage.replace(declinedHelp, "").replace(/(?:[.,;!?]\s*)+(?:(?:please)\s*[.!]?)?$/iu, "").trim();
  return requestWithoutExamples.test(request) ? "none" : "unverified";
}

/** Compare this specific supplied list with an explicitly requested all-items result, without running Python or a page. */
export function proveDebuggingExample(turn: TeachingPolicyTurn, reply: TeachingPolicyReply): DebuggingExampleProof | null {
  const learner = turn.learnerMessage;
  if (turn.assessment === "assessed" || turn.pendingSubmissions?.length || turn.activeWork?.focus?.evidence.pendingGrade
    || !newExercise.test(learner) || !learnerOwns.test(learner) || requestsDebuggingHelp(learner)
    || turn.conversation.some(message => message.role === "user" && requestsDebuggingHelp(message.content))
    || /[`~]{3}|^\s*>/mu.test(learner) || reply.text.length > 24_000) return null;
  let body: string | undefined;
  let unsupported = false;
  const prose = reply.text.replace(/^```([^\n]*)\r?\n([\s\S]*?)^```[ \t]*\r?$/gmu, (_f, lang: string, source: string) => {
    if (/^python\s*$/iu.test(lang) && body === undefined) body = source;
    else if (!/^openui(?:\s|$)/u.test(lang) || source.trim()) unsupported = true;
    return "";
  });
  if (!body || unsupported || /[`~]{3}/u.test(prose)) return null;
  const program = parityProgram(body);
  if (!program) return null;
  const goals = learner + "\n" + prose;
  const targets = [...goals.matchAll(/\b(?:prints?|collects?|returns?|keeps?|includes?|outputs?|displays?|lists?)\s+(?:every|all(?: of the)?|each)\s+(even|odd)\s+(?:integers?|numbers?|values?|items?)\b/giu)];
  if (!targets.length || targets.some(match => match[1]!.toLowerCase() !== (program.odd ? "odd" : "even"))
    || /\b(?:except|excluding|only when|only if|ignore the first|after the first|from the second|not (?:print|collect|every|each|all))\b/iu.test(goals)) return null;
  const retained = (n: number) => Math.abs(n % 2) === (program.odd ? 1 : 0);
  const nativeDescriptionGivesDiagnosis = reply.toolCalls.some(call => {
    if (call.name !== "interactive_page" || !call.arguments || typeof call.arguments !== "object") return false;
    const fields = call.arguments as Record<string,unknown>;
    return ["title", "description"].some(key => typeof fields[key] === "string" && pointsAtProvenFault(fields[key]));
  });
  return { reference: program.odd ? "all-odd-integers" : "all-even-integers", suppliedInput: retained(program.values[0]!) ? "observable" : "masked",
    otherExamples: otherExamples(prose, turn, reply, retained), nativeDescriptionGivesDiagnosis };
}

export function provenDebuggingFailures(proof: DebuggingExampleProof | null): TeachingPolicyCheck[] {
  if (!proof) return [];
  const ids: string[] = [];
  if (proof.suppliedInput === "masked" && proof.otherExamples === "none") ids.push("debug_static_example_masked");
  if (proof.nativeDescriptionGivesDiagnosis) ids.push("debug_native_fix_disclosed");
  return ids.map(id => ({id, source: "deterministic", severity: "major", status: "fail", probability: 1}));
}
