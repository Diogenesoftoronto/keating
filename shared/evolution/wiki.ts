import { contentDigest, validateEpisodeBenchmark } from "./benchmark.js";
import type { EpisodeBenchmark, TeachingSkill } from "./contracts.js";
import type { EvolutionStore } from "./loop.js";

export interface WikiPattern {
  id: string;
  title: string;
  summary: string;
  markdown: string;
  evidenceIds: string[];
  revision: number;
  updatedAt: string;
}
export interface WikiPatch extends Omit<WikiPattern, "revision" | "updatedAt"> {
  expectedRevision: number;
}
export interface WikiImpact {
  experimentId: string;
  skillId: string;
  patternIds: string[];
  before: TeachingSkill | null;
  after: TeachingSkill;
  status: "accepted" | "rejected" | "failed";
  validationMeanDelta: number | null;
}
export interface TeachingWiki {
  schemaVersion: 1;
  basePromptDigest: string;
  patterns: WikiPattern[];
  logs: { experimentId: string; summary: string; patternIds: string[] }[];
  impacts: WikiImpact[];
  traces: { key: string; digest: string; evidenceIds: string[] }[];
}
export interface WikiAccess {
  index: string;
  read: (path: string) => Promise<string>;
}
export type WikiMaintainer = (input: {
  wiki: WikiAccess;
  training: EpisodeBenchmark;
  signal: AbortSignal;
}) => Promise<{ summary: string; patches: WikiPatch[] }>;

const SLUG = /^[a-z][a-z0-9-]{0,63}$/;
const TRACE = /^raw\/[a-f0-9-]+-train-incumbent$/;
function text(value: unknown, limit: number): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > limit) throw new Error("invalid_wiki_text");
}
function evidence(value: unknown): asserts value is string[] {
  if (!Array.isArray(value) || !value.length || value.length > 128 || value.some(v => typeof v !== "string" || !v || v.length > 180)
    || new Set(value).size !== value.length) throw new Error("invalid_wiki_evidence");
}
export function validateWiki(wiki: TeachingWiki): void {
  if (!wiki || wiki.schemaVersion !== 1 || !/^sha256:[a-f0-9]{64}$/.test(wiki.basePromptDigest)
    || !Array.isArray(wiki.patterns) || !Array.isArray(wiki.logs) || !Array.isArray(wiki.impacts) || !Array.isArray(wiki.traces)
    || wiki.patterns.length > 128 || JSON.stringify(wiki).length > 2_000_000) throw new Error("invalid_wiki_or_budget");
  const ids = new Set<string>();
  const known = new Set<string>();
  const keys = new Set<string>();
  for (const trace of wiki.traces) {
    if (!TRACE.test(trace.key) || keys.has(trace.key) || !/^sha256:[a-f0-9]{64}$/.test(trace.digest)) throw new Error("invalid_wiki_trace");
    keys.add(trace.key); evidence(trace.evidenceIds);
    trace.evidenceIds.forEach(id => known.add(id));
  }
  for (const p of wiki.patterns) {
    if (!SLUG.test(p.id) || ids.has(p.id) || !Number.isInteger(p.revision) || p.revision < 1 || !Number.isFinite(Date.parse(p.updatedAt))) throw new Error("invalid_wiki_pattern");
    ids.add(p.id); text(p.title, 120); text(p.summary, 500); text(p.markdown, 12_000); evidence(p.evidenceIds);
    if (p.evidenceIds.some(id => !known.has(id))) throw new Error("invalid_wiki_evidence");
  }
  for (const log of wiki.logs) {
    text(log.experimentId, 80); text(log.summary, 2000);
    if (!Array.isArray(log.patternIds) || log.patternIds.some(id => !ids.has(id))) throw new Error("invalid_wiki_log");
  }
  for (const impact of wiki.impacts) {
    if (!SLUG.test(impact.skillId) || !["accepted", "rejected", "failed"].includes(impact.status)
      || !Array.isArray(impact.patternIds) || impact.patternIds.some(id => !ids.has(id))
      || impact.after?.id !== impact.skillId
      || (impact.validationMeanDelta !== null && !Number.isFinite(impact.validationMeanDelta))) throw new Error("invalid_wiki_impact");
  }
}

export async function emptyWiki(basePrompt: string): Promise<TeachingWiki> {
  return { schemaVersion: 1, basePromptDigest: await contentDigest(basePrompt), patterns: [], logs: [], impacts: [], traces: [] };
}
export async function loadWiki(store: EvolutionStore, id: string | undefined, basePrompt: string): Promise<TeachingWiki> {
  if (!id) return emptyWiki(basePrompt);
  if (!/^sha256:[a-f0-9]{64}$/.test(id)) throw new Error("invalid_wiki_revision");
  const wiki = await store.read<TeachingWiki>(`wiki/${id.slice(7)}`);
  if (!wiki || await contentDigest(wiki) !== id) throw new Error("wiki_revision_mismatch");
  validateWiki(wiki);
  return wiki.basePromptDigest === await contentDigest(basePrompt) ? wiki : emptyWiki(basePrompt);
}
export async function saveWiki(store: EvolutionStore, wiki: TeachingWiki): Promise<string> {
  validateWiki(wiki);
  const id = await contentDigest(wiki);
  await store.put(`wiki/${id.slice(7)}`, wiki);
  return id;
}

/** The only readable paths are generated here. No host filesystem or held-out records. */
export function wikiAccess(store: EvolutionStore, source: TeachingWiki): WikiAccess {
  const wiki = structuredClone(source);
  validateWiki(wiki);
  const index = JSON.stringify({
    patterns: wiki.patterns.map(p => ({ id: p.id, title: p.title, summary: p.summary, revision: p.revision, path: `wiki/patterns/${p.id}.md` })),
    logs: wiki.logs.map(l => ({ experimentId: l.experimentId, path: `wiki/logs/${l.experimentId}.json` })),
    impacts: wiki.impacts.map(i => ({ experimentId: i.experimentId, skillId: i.skillId, status: i.status, path: `wiki/impacts/${i.experimentId}.json` })),
    traces: wiki.traces,
  });
  return { index, read: async (path) => {
    if (path === "wiki/index.json") return index;
    for (const pattern of wiki.patterns) if (path === `wiki/patterns/${pattern.id}.md`) return JSON.stringify(pattern);
    for (const log of wiki.logs) if (path === `wiki/logs/${log.experimentId}.json`) return JSON.stringify(log);
    for (const impact of wiki.impacts) if (path === `wiki/impacts/${impact.experimentId}.json`) return JSON.stringify(impact);
    const trace = wiki.traces.find(t => t.key === path);
    if (trace) {
      const benchmark = await store.read<EpisodeBenchmark>(path);
      if (!benchmark || benchmark.split !== "train") throw new Error("wiki_trace_unavailable");
      if (await contentDigest(benchmark) !== trace.digest) throw new Error("wiki_trace_mismatch");
      validateEpisodeBenchmark(benchmark);
      if (JSON.stringify(benchmark.results.map(r => r.id)) !== JSON.stringify(trace.evidenceIds)) throw new Error("wiki_trace_mismatch");
      return JSON.stringify(benchmark);
    }
    throw new Error("wiki_read_not_allowed");
  } };
}

export async function registerTrainingTrace(wiki: TeachingWiki, key: string, training: EpisodeBenchmark): Promise<TeachingWiki> {
  validateEpisodeBenchmark(training);
  if (training.split !== "train" || !TRACE.test(key)) throw new Error("wiki_training_only");
  const next = structuredClone(wiki);
  if (next.traces.some(t => t.key === key)) throw new Error("wiki_trace_already_registered");
  next.traces.push({ key, digest: await contentDigest(training), evidenceIds: training.results.map(r => r.id) });
  validateWiki(next);
  return next;
}

export function applyWikiMaintenance(wiki: TeachingWiki, result: Awaited<ReturnType<WikiMaintainer>>,
  training: EpisodeBenchmark, experimentId: string, now: string): TeachingWiki {
  text(result.summary, 2000);
  if (!Array.isArray(result.patches) || result.patches.length > 16) throw new Error("wiki_patch_budget");
  const next = structuredClone(wiki);
  const current = new Set(training.results.map(r => r.id));
  const patched = new Set<string>();
  for (const patch of result.patches) {
    if (!patch || !SLUG.test(patch.id) || patched.has(patch.id)) throw new Error("invalid_wiki_patch");
    patched.add(patch.id);
    const prior = next.patterns.find(p => p.id === patch.id);
    if (patch.expectedRevision !== (prior?.revision ?? 0)) throw new Error("wiki_patch_conflict");
    evidence(patch.evidenceIds);
    if (!patch.evidenceIds.some(id => current.has(id))) throw new Error("wiki_patch_needs_fresh_evidence");
    const page: WikiPattern = { id: patch.id, title: patch.title, summary: patch.summary, markdown: patch.markdown,
      evidenceIds: [...new Set([...(prior?.evidenceIds ?? []), ...patch.evidenceIds])], revision: (prior?.revision ?? 0) + 1, updatedAt: now };
    next.patterns = next.patterns.filter(p => p.id !== patch.id).concat(page);
  }
  next.logs.push({ experimentId, summary: result.summary, patternIds: [...patched] });
  validateWiki(next);
  return next;
}

export function validatePatternLinks(skill: TeachingSkill, wiki: TeachingWiki): void {
  if (!Array.isArray(skill.patternIds) || (wiki.patterns.length > 0 && skill.patternIds.length === 0)
    || new Set(skill.patternIds).size !== skill.patternIds.length
    || skill.patternIds.some(id => !wiki.patterns.some(p => p.id === id))) throw new Error("invalid_skill_pattern_links");
}
