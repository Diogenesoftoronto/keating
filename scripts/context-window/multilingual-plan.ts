#!/usr/bin/env bun
/** Freeze localized content while preserving every original label and Choice key. */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { digest, SUITE_VERSION, type Trial } from "./cases.js";
import { buildMultilingualCatalog, type MultilingualCatalog } from "./multilingual-catalog.js";
import { judgementRequestProblem } from "../../packages/learner-contracts/src/judgement/contracts.js";
import { measureStateComposition } from "../../packages/learner-contracts/src/judgement/state-metrics.js";

export const MULTILINGUAL_VERSION = "keating-multilingual-content/v1";
export const LANGUAGES = ["en", "es", "fr", "ar", "hi", "zh-Hans"] as const;
type Language = typeof LANGUAGES[number];
interface TranslationDocument {
  language: Language; catalogSha256: string; translations: Record<string, string>;
  reviewStatus: string; reviewedEntryCount?: number; reviewedEntries?: number; translatorModel?: string;
  reviewMethod?: string; reviewCorrections?: unknown[];
}
type SourcePlan = { sha256: string; version: string; trials: Trial[]; [key: string]: unknown };
type LocalizedTrial = Trial & { language: Language; sourceTrialId: string; sourceRequestSha256: string };
const fileHash = (text: string): string => createHash("sha256").update(text).digest("hex");
const equality = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

function readPath(root: unknown, path: Array<string | number>): unknown {
  let current: any = root;
  for (const key of path) {
    if (!current || typeof current !== "object" || !Object.hasOwn(current, key)) throw Error("catalog-path-missing");
    current = current[key];
  }
  return current;
}
function writePath(root: unknown, path: Array<string | number>, value: string): void {
  if (!path.length) throw Error("catalog-root-string-not-supported");
  const parent: any = path.length === 1 ? root : readPath(root, path.slice(0, -1));
  const last = path.at(-1)!;
  if (!Object.hasOwn(parent, last) || typeof parent[last] !== "string") throw Error("catalog-path-not-string");
  parent[last] = value;
}

export function localizeTrials(source: SourcePlan, catalog: MultilingualCatalog,
  documents: Partial<Record<Language, TranslationDocument>>, allowUnreviewed = false): LocalizedTrial[] {
  if (source.version !== SUITE_VERSION || source.trials.length !== 50 || new Set(source.trials.map(row => row.id)).size !== 50) throw Error("source-must-have-50-unique-trials");
  if (catalog.parentPlanSha256 !== source.sha256 || !equality(catalog, buildMultilingualCatalog(source))) throw Error("catalog-does-not-match-reviewed-generator");
  if (new Set(source.trials.map(row => row.family)).size !== 25) throw Error("source-family-count-changed");
  const english = Object.fromEntries(catalog.translatorInput.entries.map(entry => [entry.id, entry.english]));
  const entryIds = Object.keys(english).sort();
  const languageTexts: Partial<Record<Language, Record<string, string>>> = { en: english };
  for (const language of LANGUAGES.filter(language => language !== "en")) {
    const document = documents[language];
    if (!document || document.language !== language) throw Error(`translation-missing:${language}`);
    if (!allowUnreviewed && (document.reviewStatus !== "reviewed" || (document.reviewedEntryCount ?? document.reviewedEntries) !== entryIds.length)) throw Error(`translation-not-reviewed:${language}`);
    if (!equality(Object.keys(document.translations).sort(), entryIds)) throw Error(`translation-coverage-mismatch:${language}`);
    for (const id of entryIds) {
      const value = document.translations[id];
      if (typeof value !== "string" || !value.trim()) throw Error(`translation-empty:${language}:${id}`);
      for (const literal of catalog.protectedLiterals[id]!) if (!value.includes(literal)) throw Error(`protected-literal-missing:${language}:${id}:${literal}`);
    }
    languageTexts[language] = document.translations;
  }
  const trials: LocalizedTrial[] = [];
  // Rotate the starting language so one language does not always warm a model's caches.
  for (const [sourceIndex, sourceTrial] of source.trials.entries()) for (const language of [...LANGUAGES.slice(sourceIndex % LANGUAGES.length), ...LANGUAGES.slice(0, sourceIndex % LANGUAGES.length)]) {
    const translated = languageTexts[language]!;
    const request = structuredClone(sourceTrial.request);
    const bindings = catalog.stateBindings.filter(binding => binding.trialId === sourceTrial.id);
    for (const binding of bindings) {
      const englishValue = binding.segments.map(segment => "entryId" in segment ? english[segment.entryId] : segment.literal).join("");
      if (readPath(sourceTrial.request.state, binding.path) !== englishValue) throw Error("catalog-source-text-mismatch");
      const value = binding.segments.map(segment => "entryId" in segment ? translated[segment.entryId] : segment.literal).join("");
      writePath(request.state, binding.path, value);
    }
    const evidenceBindings = catalog.evidenceBindings.filter(binding => binding.trialId === sourceTrial.id);
    for (const binding of evidenceBindings) {
      const question = request.questions[binding.questionId];
      if (!question || question.type !== "choice" || !Object.hasOwn(question.criteria, binding.sourceKey)) throw Error("evidence-choice-key-missing");
      if (binding.optionId !== binding.sourceKey) throw Error("choice-key-remapping-forbidden");
      // Evidence remains the original English sentence identifier with its original null value.
      // The localised learner sentence is a semantic match, not a changed Choice contract.
      const learnerAnswer = readPath(request.state, ["learner_answer"]);
      if (typeof learnerAnswer !== "string" || !learnerAnswer.includes(translated[binding.entryId]!)) throw Error("localized-evidence-not-verbatim");
    }
    for (const preserved of catalog.preservedStateStrings.filter(binding => binding.trialId === sourceTrial.id)) {
      if (readPath(request.state, preserved.path) !== preserved.value) throw Error("protocol-string-modified");
    }
    for (const [key, originalQuestion] of Object.entries(sourceTrial.request.questions)) {
      const question = request.questions[key]!;
      if (originalQuestion.type === "choice") {
        if (question.type !== "choice" || !equality(Object.keys(originalQuestion.criteria), Object.keys(question.criteria))) throw Error("choice-key-modified");
      }
      if (!equality(question, originalQuestion)) throw Error("english-judgement-contract-modified");
    }
    if (language === "en" && !equality(request, sourceTrial.request)) throw Error("english-control-request-changed");
    if (digest(request.questions) !== digest(sourceTrial.request.questions)) throw Error("question-contract-changed");
    const problem = judgementRequestProblem(request);
    if (problem) throw Error(`invalid-localized-request:${language}:${problem}`);
    const metrics = measureStateComposition(request, sourceTrial.after.budgetTokens);
    const requestSha256 = digest(request);
    const trial: LocalizedTrial = { ...structuredClone(sourceTrial), id: `${sourceTrial.id}/language-${language}`,
      caseId: `${sourceTrial.caseId}/language-${language}`, language, sourceTrialId: sourceTrial.id,
      sourceRequestSha256: sourceTrial.requestSha256, request, requestSha256, fullRequestSha256: requestSha256,
      contractSha256: digest(request.questions), before: metrics, after: metrics,
      targetFill: metrics.fillRatio ?? 0, turnsDropped: 0, cueRetained: true };
    if (!equality(trial.expected, sourceTrial.expected) || !equality(trial.fullExpected, sourceTrial.fullExpected)) throw Error("label-change-forbidden");
    trials.push(trial);
  }
  if (trials.length !== 300 || new Set(trials.map(row => row.family)).size !== 25) throw Error("multilingual-size-mismatch");
  return trials;
}

async function main(): Promise<void> {
  const validateOnly = process.argv.includes("--validate-only");
  const [sourcePath, catalogPath, translationsDirectory, providersPath, output] = process.argv.slice(2).filter(arg => arg !== "--validate-only");
  if (!sourcePath || !catalogPath || !translationsDirectory || !providersPath || (!output && !validateOnly)) throw Error("requires-source-plan-catalog-translations-dir-providers-output");
  const source = JSON.parse(await readFile(sourcePath, "utf8")) as SourcePlan;
  const { sha256, ...sourceBody } = source;
  if (sha256 !== digest(sourceBody) || source.trials.some(row => row.requestSha256 !== digest(row.request))) throw Error("source-plan-integrity-failed");
  const catalogText = await readFile(catalogPath, "utf8");
  const catalog = JSON.parse(catalogText) as MultilingualCatalog;
  const initialCatalogPath = catalogPath.replace(/\.json$/, ".initial.json");
  const initialCatalogText = await readFile(initialCatalogPath, "utf8");
  const initialCatalogHash = fileHash(initialCatalogText);
  const documents: Partial<Record<Language, TranslationDocument>> = {};
  const translationProvenance: Record<string, unknown> = {};
  for (const language of LANGUAGES.filter(language => language !== "en")) {
    const text = await readFile(join(translationsDirectory, `${language}.json`), "utf8");
    const document = JSON.parse(text) as TranslationDocument;
    if (document.catalogSha256 !== initialCatalogHash) throw Error(`translation-source-catalog-mismatch:${language}`);
    documents[language] = document;
    translationProvenance[language] = { fileSha256: fileHash(text), translatorModel: document.translatorModel,
      originalCatalogSha256: document.catalogSha256, reviewStatus: document.reviewStatus,
      reviewMethod: document.reviewMethod, reviewedEntryCount: document.reviewedEntryCount ?? document.reviewedEntries,
      correctionCount: document.reviewCorrections?.length ?? 0 };
  }
  const providers = JSON.parse(await readFile(providersPath, "utf8"));
  const allowedProviderKeys = new Set(["id", "kind", "model", "expectedModel", "endpoint", "keyEnv", "keyFile", "headRevision", "encoderRevision", "maxOutputTokens", "nativeProvenance"]);
  if (!Array.isArray(providers) || providers.length !== 13 || new Set(providers.map(provider => provider.id)).size !== 13) throw Error("requires-13-unique-providers");
  for (const provider of providers) {
    if (Object.keys(provider).some(key => !allowedProviderKeys.has(key)) || !["system-one", "reference"].includes(provider.kind)) throw Error("unsafe-provider-config");
    const url = new URL(provider.endpoint);
    if (url.username || url.password || url.search || url.hash) throw Error("unsafe-provider-url");
  }
  const trials = localizeTrials(source, catalog, documents, validateOnly);
  const inputTokenReservation = trials.reduce((sum, trial) => sum + trial.after.estimatedRequestTokens, 0) * providers.length;
  const body = { version: SUITE_VERSION, questionSetVersion: MULTILINGUAL_VERSION, createdAt: new Date().toISOString(),
    profile: "keating-multilingual", parentPlanSha256: sha256, languages: LANGUAGES,
    selection: "All 50 source episodes repeated across six languages; 25 shared contrastive families. Only state content is localized. Every original request.questions object and expected/fullExpected label remains byte-equivalent under JSON serialization. English judgement instructions, static rubrics and evidence sentence Choice keys/values remain unchanged. English control requests exactly match their source requests and are executed afresh. No language variant is an independent task or human-learning outcome.",
    executionOrder: "Source episode order, with language order rotated by source episode index modulo six; identical schedule for every provider.",
    translationProvenance, sourceCatalogFileSha256: initialCatalogHash, reviewedCatalogFileSha256: fileHash(catalogText),
    reviewedCatalogSemanticSha256: digest(catalog), trials, providers, maxCalls: 3900,
    maxEstimatedInputTokens: inputTokenReservation, repetitions: 1, excluded: [],
    protocolChanges: { labelsChanged: false, questionsChanged: false, choiceKeysChanged: false, evidenceCandidateDescriptionsAdded: false,
      judgementInstructionsLanguage: "English", staticRubricsLanguage: "English", sourceEnglishResultsReused: false },
  };
  if (!validateOnly) await writeFile(output!, JSON.stringify({ ...body, sha256: digest(body) }, null, 2), { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ validatedOnly: validateOnly, trials: trials.length, languages: LANGUAGES.length,
    families: 25, providers: providers.length, calls: 3900, inputTokenReservation,
    labelledQuestions: trials.reduce((sum, trial) => sum + Object.keys(trial.expected).length, 0),
    questions: trials.reduce((sum, trial) => sum + Object.keys(trial.request.questions).length, 0),
    labelsUnchanged: true, choiceKeysUnchanged: true, ...(validateOnly ? {} : { output, sha256: digest(body) }) }));
}
if (import.meta.main) main().catch(error => { console.error(error instanceof Error ? error.message : "multilingual-plan-failed"); process.exitCode = 1; });
