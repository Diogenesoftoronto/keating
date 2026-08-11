import {
  UI_CONTRACT_VERSION,
  validateUiDocument,
  type UiDeckCard,
  type UiDocument,
  type UiDocumentNode,
  type UiDocumentRetention,
  type UiOption,
  type UiQuestion,
  type UiQuestionLevel,
  type UiQuestionType,
  type UiStudyPlanItem,
  type UiStudyPlanLink,
} from "./ui.js";
import { WEB_OPENUI_COMPONENTS } from "./rendering.js";

export interface CompileSharedOpenUIOptions {
  documentId: string;
  revision?: number;
  createdAt?: string;
  updatedAt?: string;
  retention?: UiDocumentRetention;
}

export type OpenUISourceFailureKind = "partial" | "invalid" | "unsafe" | "unsupported";

export type OpenUISourceCompileResult =
  | { ok: true; document: UiDocument }
  | { ok: false; kind: OpenUISourceFailureKind; message: string; source: string };

export const SHARED_OPENUI_COMPONENT_MAPPERS = [
  "LearningSurface", "Explanation", "Callout", "Question", "Quiz", "Flashcards",
  "StudyPlan", "ConceptMap", "LearningImage", "LearningAnimation", "SharedNotes",
] as const satisfies typeof WEB_OPENUI_COMPONENTS;

const COMPONENTS = new Set<string>(SHARED_OPENUI_COMPONENT_MAPPERS);
const MAX_SOURCE_LENGTH = 131_072;
const MAX_STATEMENTS = 64;
const MAX_COLLECTION_LENGTH = 512;
const MAX_DEPTH = 24;
const FORBIDDEN_IDENTIFIERS = new Set([
  "eval", "Function", "globalThis", "window", "document", "process", "require",
  "import", "export", "fetch", "XMLHttpRequest", "WebSocket", "constructor", "prototype", "__proto__",
]);

interface ReferenceValue { kind: "reference"; name: string }
type SourceValue = string | number | boolean | null | ReferenceValue | SourceValue[] | { [key: string]: SourceValue };
interface SourceElement { kind: "element"; typeName: string; statementId: string; props: Record<string, unknown> }
interface ParsedStatement { id: string; component: string; args: SourceValue[] }

class OpenUISourceError extends Error {
  constructor(readonly kind: OpenUISourceFailureKind, message: string) {
    super(message);
    this.name = "OpenUISourceError";
  }
}

class SourceParser {
  private index = 0;

  constructor(private readonly source: string) {}

  parse(): ParsedStatement[] {
    const statements: ParsedStatement[] = [];
    this.skipSpace();
    while (!this.done()) {
      if (statements.length >= MAX_STATEMENTS) this.fail("invalid", "OpenUI source contains too many statements.");
      statements.push(this.statement());
      const space = this.skipSpace();
      if (!this.done() && space === 0) this.fail("invalid", "OpenUI statements must be separated by whitespace.");
    }
    return statements;
  }

  private statement(): ParsedStatement {
    const id = this.identifier("binding name");
    this.rejectIdentifier(id);
    this.skipSpace();
    this.expect("=", "assignment");
    this.skipSpace();
    const component = this.identifier("component name");
    this.rejectIdentifier(component);
    if (!COMPONENTS.has(component)) this.fail("unsupported", `OpenUI component ${component} is not supported by this contract version.`);
    this.skipSpace();
    this.expect("(", "component arguments");
    const args: SourceValue[] = [];
    this.skipSpace();
    if (this.peek() !== ")") {
      while (true) {
        if (args.length >= 16) this.fail("invalid", "OpenUI component contains too many arguments.");
        args.push(this.value(0));
        this.skipSpace();
        if (this.peek() !== ",") break;
        this.index += 1;
        this.skipSpace();
        if (this.peek() === ")") this.fail("invalid", "Trailing commas are not accepted in OpenUI component arguments.");
      }
    }
    this.expect(")", "component arguments");
    return { id, component, args };
  }

  private value(depth: number): SourceValue {
    if (depth > MAX_DEPTH) this.fail("invalid", "OpenUI source is nested too deeply.");
    this.skipSpace();
    const next = this.peek();
    if (next === undefined) this.fail("partial", "OpenUI source ends inside a value.");
    if (next === '"') return this.string();
    if (next === "[") return this.array(depth + 1);
    if (next === "{") return this.object(depth + 1);
    if (next === "-" || /[0-9]/.test(next)) return this.number();
    if (/[A-Za-z_$]/.test(next)) {
      const identifier = this.identifier("value");
      if (identifier === "true") return true;
      if (identifier === "false") return false;
      if (identifier === "null") return null;
      this.rejectIdentifier(identifier);
      return { kind: "reference", name: identifier };
    }
    if (next === "@") this.fail("unsafe", "OpenUI directives are not allowed.");
    this.fail("invalid", `Unexpected token ${JSON.stringify(next)} in OpenUI source.`);
  }

  private array(depth: number): SourceValue[] {
    this.index += 1;
    const result: SourceValue[] = [];
    this.skipSpace();
    if (this.peek() === "]") {
      this.index += 1;
      return result;
    }
    while (true) {
      if (result.length >= MAX_COLLECTION_LENGTH) this.fail("invalid", "OpenUI array is too large.");
      result.push(this.value(depth));
      this.skipSpace();
      const next = this.peek();
      if (next === "]") {
        this.index += 1;
        return result;
      }
      this.expect(",", "array");
      this.skipSpace();
      if (this.peek() === "]") this.fail("invalid", "Trailing commas are not accepted in OpenUI arrays.");
    }
  }

  private object(depth: number): { [key: string]: SourceValue } {
    this.index += 1;
    const result: { [key: string]: SourceValue } = Object.create(null) as { [key: string]: SourceValue };
    let count = 0;
    this.skipSpace();
    if (this.peek() === "}") {
      this.index += 1;
      return result;
    }
    while (true) {
      if (count >= MAX_COLLECTION_LENGTH) this.fail("invalid", "OpenUI object has too many fields.");
      const key = this.peek() === '"' ? this.string() : this.identifier("object key");
      if (FORBIDDEN_IDENTIFIERS.has(key) || Object.prototype.hasOwnProperty.call(result, key)) {
        this.fail(FORBIDDEN_IDENTIFIERS.has(key) ? "unsafe" : "invalid", `OpenUI object field ${key} is not allowed.`);
      }
      this.skipSpace();
      this.expect(":", "object field");
      result[key] = this.value(depth);
      count += 1;
      this.skipSpace();
      const next = this.peek();
      if (next === "}") {
        this.index += 1;
        return result;
      }
      this.expect(",", "object");
      this.skipSpace();
      if (this.peek() === "}") this.fail("invalid", "Trailing commas are not accepted in OpenUI objects.");
    }
  }

  private string(): string {
    const start = this.index;
    this.index += 1;
    let escaped = false;
    while (!this.done()) {
      const character = this.source[this.index++]!;
      if (escaped) {
        escaped = false;
        continue;
      }
      if (character === "\\") {
        escaped = true;
        continue;
      }
      if (character === '"') {
        try {
          return JSON.parse(this.source.slice(start, this.index)) as string;
        } catch {
          this.fail("invalid", "OpenUI string contains an invalid escape sequence.");
        }
      }
      if (character === "\n" || character === "\r" || character.charCodeAt(0) < 0x20) {
        this.fail("invalid", "OpenUI strings must use escaped control characters.");
      }
    }
    this.fail("partial", "OpenUI source ends inside a string.");
  }

  private number(): number {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(this.source.slice(this.index));
    if (!match) this.fail("invalid", "OpenUI number is invalid.");
    this.index += match[0].length;
    const result = Number(match[0]);
    if (!Number.isFinite(result)) this.fail("invalid", "OpenUI number must be finite.");
    return result;
  }

  private identifier(context: string): string {
    const match = /^[A-Za-z_$][A-Za-z0-9_$-]*/.exec(this.source.slice(this.index));
    if (!match) {
      if (this.done()) this.fail("partial", `OpenUI source ends before the ${context}.`);
      this.fail("invalid", `OpenUI ${context} is invalid.`);
    }
    this.index += match[0].length;
    return match[0];
  }

  private rejectIdentifier(identifier: string): void {
    if (FORBIDDEN_IDENTIFIERS.has(identifier)) this.fail("unsafe", `OpenUI identifier ${identifier} is not allowed.`);
  }

  private expect(expected: string, context: string): void {
    if (this.peek() === expected) {
      this.index += 1;
      return;
    }
    if (this.done()) this.fail("partial", `OpenUI source ends inside ${context}.`);
    this.fail("invalid", `OpenUI ${context} is malformed.`);
  }

  private skipSpace(): number {
    const start = this.index;
    while (!this.done() && /\s/.test(this.source[this.index]!)) this.index += 1;
    return this.index - start;
  }

  private peek(): string | undefined { return this.source[this.index]; }
  private done(): boolean { return this.index >= this.source.length; }
  private fail(kind: OpenUISourceFailureKind, message: string): never { throw new OpenUISourceError(kind, message); }
}

const POSITIONAL_FIELDS: Readonly<Record<string, readonly string[]>> = {
  LearningSurface: ["content", "title", "description", "lifecycle"],
  Explanation: ["markdown", "title"],
  Callout: ["markdown", "tone", "title"],
  Question: ["questions", "lifecycle", "topic", "intro"],
  Quiz: ["id", "topic", "questions", "lifecycle"],
  Flashcards: ["id", "topic", "title", "cards", "lifecycle", "description"],
  StudyPlan: ["id", "title", "items", "lifecycle", "overview", "relatedPlans"],
  ConceptMap: ["code", "lifecycle", "title"],
  LearningImage: ["src", "alt", "lifecycle", "title", "caption"],
  LearningAnimation: ["topic", "html", "lifecycle", "summary"],
  SharedNotes: ["id", "title", "lifecycle", "initialValue", "placeholder"],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isReference(value: unknown): value is ReferenceValue {
  return isRecord(value) && value.kind === "reference" && typeof value.name === "string";
}

function propsFor(statement: ParsedStatement): Record<string, SourceValue> {
  if (statement.args.length === 1 && isRecord(statement.args[0]) && !isReference(statement.args[0])) {
    return statement.args[0] as Record<string, SourceValue>;
  }
  const fields = POSITIONAL_FIELDS[statement.component];
  if (!fields || statement.args.length > fields.length) throw new OpenUISourceError("invalid", `${statement.component} has too many arguments.`);
  return Object.fromEntries(statement.args.map((value, index) => [fields[index]!, value]));
}

function buildElements(statements: ParsedStatement[]): SourceElement {
  const definitions = new Map<string, ParsedStatement>();
  for (const statement of statements) {
    if (definitions.has(statement.id)) throw new OpenUISourceError("invalid", `OpenUI binding ${statement.id} is duplicated.`);
    definitions.set(statement.id, statement);
  }
  const cache = new Map<string, SourceElement>();
  const active = new Set<string>();
  const resolveValue = (value: SourceValue): unknown => {
    if (Array.isArray(value)) return value.map(resolveValue);
    if (isRecord(value)) {
      if (isReference(value)) return resolveElement(value.name);
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, resolveValue(child as SourceValue)]));
    }
    return value;
  };
  const resolveElement = (id: string): SourceElement => {
    const cached = cache.get(id);
    if (cached) return cached;
    const statement = definitions.get(id);
    if (!statement) throw new OpenUISourceError("invalid", `OpenUI binding ${id} is unresolved.`);
    if (active.has(id)) throw new OpenUISourceError("invalid", `OpenUI binding ${id} is recursive.`);
    active.add(id);
    const element: SourceElement = {
      kind: "element",
      typeName: statement.component,
      statementId: statement.id,
      props: Object.fromEntries(Object.entries(propsFor(statement)).map(([key, value]) => [key, resolveValue(value)])),
    };
    active.delete(id);
    cache.set(id, element);
    return element;
  };
  const root = resolveElement("root");
  if (root.typeName !== "LearningSurface") throw new OpenUISourceError("invalid", "OpenUI source has no LearningSurface root.");
  return root;
}

function record(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function text(value: unknown, fallback = ""): string { return typeof value === "string" ? value : fallback; }
function optionalText(value: unknown): string | undefined { return typeof value === "string" ? value : undefined; }
function textArray(value: unknown): string[] | undefined { return Array.isArray(value) && value.every((entry) => typeof entry === "string") ? value : undefined; }
function numberValue(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }
function booleanValue(value: unknown): boolean | undefined { return typeof value === "boolean" ? value : undefined; }
function retentionValue(value: unknown): UiDocumentRetention | undefined { return value === "ephemeral" || value === "resumable" || value === "workspace" ? value : undefined; }

function contractId(value: string, fallback: string): string {
  const normalized = value.normalize("NFKD").replace(/[^a-zA-Z0-9._:-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 128);
  return normalized || fallback;
}

function childId(parent: string, kind: string, index?: number): string {
  return contractId(`${parent}-${kind}${index === undefined ? "" : `-${index + 1}`}`, `${kind}-${(index ?? 0) + 1}`);
}

function elementId(element: SourceElement, fallback: string): string { return contractId(element.statementId || fallback, fallback); }
function choices(parent: string, value: unknown): UiOption[] | undefined { return textArray(value)?.map((label, index) => ({ id: childId(parent, "choice", index), label })); }

function normalizeChoiceAnswer(value: string, mappedChoices: readonly UiOption[] | undefined, field: string): string {
  if (!mappedChoices) return value;
  const byId = mappedChoices.find((choice) => choice.id === value);
  if (byId) return byId.id;
  const exact = mappedChoices.filter((choice) => choice.label === value);
  if (exact.length === 1) return exact[0]!.id;
  if (exact.length > 1) throw new OpenUISourceError("invalid", `${field} label ${JSON.stringify(value)} is ambiguous.`);
  const folded = mappedChoices.filter((choice) => choice.label.toLocaleLowerCase() === value.toLocaleLowerCase());
  if (folded.length === 1) return folded[0]!.id;
  if (folded.length > 1) throw new OpenUISourceError("invalid", `${field} label ${JSON.stringify(value)} is ambiguous.`);
  throw new OpenUISourceError("invalid", `${field} value ${JSON.stringify(value)} does not match a choice.`);
}

function blanks(value: unknown): UiQuestion["blanks"] {
  if (!Array.isArray(value)) return undefined;
  return value.map((entry) => {
    const item = record(entry);
    return { ...(optionalText(item.placeholder) !== undefined ? { placeholder: text(item.placeholder) } : {}), ...(optionalText(item.hint) !== undefined ? { hint: text(item.hint) } : {}) };
  });
}

function question(parent: string, value: unknown, index: number, quiz = false): UiQuestion {
  const item = record(value);
  const fallbackId = childId(parent, "question", index);
  const id = quiz ? contractId(`${parent}-${text(item.id, `question-${index + 1}`)}`, fallbackId) : fallbackId;
  const rawKind = text(item.type, quiz ? "short_answer" : "choice") as UiQuestionType;
  const mappedChoices = choices(id, quiz ? item.options : item.choices)
    ?? (rawKind === "true_false" ? [{ id: childId(id, "true"), label: "True" }, { id: childId(id, "false"), label: "False" }] : undefined);
  const rawCorrectMatches = textArray(item.correctMatches);
  const rawCorrectAnswers = textArray(item.correctAnswers);
  const rawCorrectAnswer = optionalText(item.correctAnswer);
  return {
    id,
    prompt: text(item.question, "Question"),
    kind: rawKind,
    ...(optionalText(item.header) !== undefined ? { header: text(item.header) } : {}),
    ...(mappedChoices ? { choices: mappedChoices } : {}),
    ...(textArray(item.items) ? { items: textArray(item.items) } : {}),
    ...(blanks(item.blanks) ? { blanks: blanks(item.blanks) } : {}),
    ...(optionalText(item.hint) !== undefined ? { hint: text(item.hint) } : {}),
    ...(booleanValue(item.allowText) !== undefined ? { allowText: booleanValue(item.allowText) } : {}),
    ...(booleanValue(item.multiSelect) !== undefined || rawKind === "multi_select" ? { multiSelect: booleanValue(item.multiSelect) ?? true } : {}),
    ...(booleanValue(item.requireReasons) !== undefined ? { requireReasons: booleanValue(item.requireReasons) } : {}),
    ...(optionalText(item.itemLabel) !== undefined ? { itemLabel: text(item.itemLabel) } : {}),
    ...(optionalText(item.choiceLabel) !== undefined ? { choiceLabel: text(item.choiceLabel) } : {}),
    ...(optionalText(item.reasonLabel) !== undefined ? { reasonLabel: text(item.reasonLabel) } : {}),
    ...(booleanValue(item.uniqueMatches) !== undefined ? { uniqueMatches: booleanValue(item.uniqueMatches) } : {}),
    ...(rawCorrectMatches ? { correctMatches: rawCorrectMatches.map((answer) => normalizeChoiceAnswer(answer, mappedChoices, "correctMatches")) } : {}),
    ...(optionalText(item.level) !== undefined ? { level: text(item.level) as UiQuestionLevel } : {}),
    ...(rawCorrectAnswer !== undefined ? { correctAnswer: normalizeChoiceAnswer(rawCorrectAnswer, mappedChoices, "correctAnswer") } : {}),
    ...(rawCorrectAnswers ? { correctAnswers: rawCorrectAnswers.map((answer) => normalizeChoiceAnswer(answer, mappedChoices, "correctAnswers")) } : {}),
    ...(optionalText(item.explanation) !== undefined ? { explanation: text(item.explanation) } : {}),
    ...(optionalText(item.rubric) !== undefined ? { rubric: text(item.rubric) } : {}),
    ...(numberValue(item.timeLimit) !== undefined ? { timeLimit: numberValue(item.timeLimit) } : {}),
    ...(numberValue(item.min) !== undefined ? { min: numberValue(item.min) } : {}),
    ...(numberValue(item.max) !== undefined ? { max: numberValue(item.max) } : {}),
    ...(numberValue(item.step) !== undefined ? { step: numberValue(item.step) } : {}),
  };
}

function planItem(value: unknown, index: number, parent = "plan"): UiStudyPlanItem {
  const item = record(value);
  const id = contractId(text(item.id, childId(parent, "item", index)), childId(parent, "item", index));
  const children = Array.isArray(item.children) ? item.children.map((child, childIndex) => planItem(child, childIndex, id)) : undefined;
  return {
    id,
    title: text(item.title, "Study item"),
    ...(optionalText(item.detail) !== undefined ? { detail: text(item.detail) } : {}),
    ...(textArray(item.dependsOn) ? { dependsOn: textArray(item.dependsOn)?.map((dependency) => contractId(dependency, "dependency")) } : {}),
    ...(numberValue(item.estimatedMinutes) !== undefined ? { estimatedMinutes: numberValue(item.estimatedMinutes) } : {}),
    ...(textArray(item.outcomes) ? { outcomes: textArray(item.outcomes) } : {}),
    status: "not_started",
    ...(children?.length ? { children } : {}),
  };
}

function planLink(value: unknown, index: number): UiStudyPlanLink {
  const link = record(value);
  const relation = optionalText(link.relation);
  return {
    planId: contractId(text(link.planId, `related-plan-${index + 1}`), `related-plan-${index + 1}`),
    title: text(link.title, "Related plan"),
    ...(relation === "prerequisite" || relation === "follow-up" || relation === "related" ? { relation } : {}),
    ...(optionalText(link.detail) !== undefined ? { detail: text(link.detail) } : {}),
  };
}

function mapElement(element: SourceElement, index: number): UiDocumentNode[] {
  const id = elementId(element, `openui-node-${index + 1}`);
  const props = element.props;
  switch (element.typeName) {
    case "Explanation": {
      const title = optionalText(props.title);
      return [{ type: "markdown", id, markdown: `${title ? `### ${title}\n\n` : ""}${text(props.markdown)}` }];
    }
    case "Callout": return [{ type: "callout", id, markdown: text(props.markdown), tone: text(props.tone, "info") as "info" | "hint" | "check" | "warning", ...(optionalText(props.title) ? { title: text(props.title) } : {}) }];
    case "Question": return [{ type: "question-group", id, ...(optionalText(props.topic) !== undefined ? { topic: text(props.topic) } : {}), ...(optionalText(props.intro) !== undefined ? { intro: text(props.intro) } : {}), questions: Array.isArray(props.questions) ? props.questions.map((entry, questionIndex) => question(id, entry, questionIndex)) : [] }];
    case "Quiz": return [{ type: "quiz", id: contractId(text(props.id, id), id), title: text(props.topic, "Quiz"), questions: Array.isArray(props.questions) ? props.questions.map((entry, questionIndex) => question(id, entry, questionIndex, true)) : [] }];
    case "Flashcards": return [{
      type: "deck", id: contractId(text(props.id, id), id), title: text(props.title, "Flashcards"), topic: text(props.topic, "Study"),
      ...(optionalText(props.description) !== undefined ? { description: text(props.description) } : {}),
      cards: Array.isArray(props.cards) ? props.cards.map((entry, cardIndex): UiDeckCard => {
        const card = record(entry);
        return { id: contractId(text(card.id, childId(id, "card", cardIndex)), childId(id, "card", cardIndex)), front: text(card.front, "Front"), back: text(card.back, "Back"), ...(textArray(card.tags) ? { tags: textArray(card.tags) } : {}) };
      }) : [],
    }];
    case "StudyPlan": return [{
      type: "study-plan", id: contractId(text(props.id, id), id), title: text(props.title, "Study plan"),
      ...(optionalText(props.overview) ? { overview: text(props.overview) } : {}),
      items: Array.isArray(props.items) ? props.items.map((entry, itemIndex) => planItem(entry, itemIndex, id)) : [],
      ...(Array.isArray(props.relatedPlans) ? { relatedPlans: props.relatedPlans.map(planLink) } : {}),
    }];
    case "ConceptMap": return [{ type: "concept-map", id, source: text(props.code), ...(optionalText(props.title) ? { title: text(props.title) } : {}) }];
    case "LearningImage": return [{ type: "image", id, alt: text(props.alt, "Learning image"), resource: { id: childId(id, "resource"), title: text(props.title, "Learning image"), format: "uri", uri: text(props.src) } }];
    case "LearningAnimation": return [{ type: "handoff", id, target: "web", reason: text(props.summary, `Open the ${text(props.topic, "learning")} animation in Keating web`), context: "The source interaction contains executable HTML, so the portable learner contract records an explicit trusted-surface handoff instead of embedding or executing it." }];
    case "SharedNotes": return [{ type: "notes", id: contractId(text(props.id, id), id), title: text(props.title, "Learner notes"), value: text(props.initialValue), ...(optionalText(props.placeholder) ? { placeholder: text(props.placeholder) } : {}) }];
    default: throw new OpenUISourceError("unsupported", `OpenUI component ${element.typeName} has no shared semantic mapping.`);
  }
}

function compile(source: string, options: CompileSharedOpenUIOptions): UiDocument {
  if (!source.trim()) throw new OpenUISourceError("partial", "OpenUI source is empty.");
  if (source.length > MAX_SOURCE_LENGTH) throw new OpenUISourceError("invalid", "OpenUI source exceeds the shared size limit.");
  if (/[^\x09\x0a\x0d\x20-\uffff]/u.test(source)) throw new OpenUISourceError("unsafe", "OpenUI source contains unsupported control characters.");
  if (/^\s*@/mu.test(source)) throw new OpenUISourceError("unsafe", "OpenUI directives are not allowed.");
  const root = buildElements(new SourceParser(source).parse());
  const content = root.props.content;
  if (!Array.isArray(content) || !content.every((entry) => isRecord(entry) && entry.kind === "element")) {
    throw new OpenUISourceError("invalid", "OpenUI LearningSurface content is invalid.");
  }
  const at = options.updatedAt ?? options.createdAt ?? new Date().toISOString();
  const document: UiDocument = {
    schemaVersion: UI_CONTRACT_VERSION,
    id: contractId(options.documentId, "openui-document"),
    revision: options.revision ?? 0,
    lifecycle: "ready",
    retention: options.retention ?? retentionValue(root.props.lifecycle) ?? "ephemeral",
    supportedSurfaces: ["web", "desktop", "mobile", "terminal"],
    ...(optionalText(root.props.title) ? { title: text(root.props.title) } : {}),
    ...(optionalText(root.props.description) ? { description: text(root.props.description) } : {}),
    nodes: content.flatMap((entry, index) => mapElement(entry as unknown as SourceElement, index)),
    createdAt: options.createdAt ?? at,
    updatedAt: at,
  };
  if (!validateUiDocument(document)) throw new OpenUISourceError("invalid", "Compiled OpenUI document does not satisfy the shared learner contract.");
  return document;
}

/** Compile inert OpenUI data syntax into the canonical contract without evaluating JavaScript or HTML. */
export function tryCompileOpenUISourceToSharedDocument(source: string, options: CompileSharedOpenUIOptions): OpenUISourceCompileResult {
  try {
    return { ok: true, document: compile(source, options) };
  } catch (error) {
    if (error instanceof OpenUISourceError) return { ok: false, kind: error.kind, message: error.message, source };
    return { ok: false, kind: "invalid", message: "OpenUI source could not be compiled safely.", source };
  }
}

/** Compatibility wrapper for consumers that already use a throwing compiler API. */
export function compileOpenUISourceToSharedDocument(source: string, options: CompileSharedOpenUIOptions): UiDocument {
  const result = tryCompileOpenUISourceToSharedDocument(source, options);
  if (!result.ok) throw new Error(result.message);
  return result.document;
}
