import type { Context } from "@earendil-works/pi-ai";
import type { TeachingPolicyReply, TeachingPolicyTurn } from "@keating/learner-contracts";
import { isWebSearchToolName, parseWebSearchResult, webUrlsInText, type WebSearchSite } from "../../components/web-search-result";

const MAX_SEARCH_SOURCES = 16;
/** The smallest compact evidence set. A reviewer with more room is given more; see `compactSources`. */
export const MAX_SEARCH_SOURCE_CHARS = 12_000;
const COMPACT_SNIPPET_CHARS = 240;
// A cited passage can expand this far in the smallest compact set; larger sets scale it.
const FULL_SNIPPET_CHARS = 2_000;

/** One key per page, so a draft citing `…/post/` or `…/post?utm_source=x` still selects `…/post`. */
function citationKey(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const name of [...url.searchParams.keys()]) if (/^(utm_|ref$|ref_src$|fbclid$|gclid$)/i.test(name)) url.searchParams.delete(name);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : "";
    return `${host}${path}${url.search}`;
  } catch {
    return value;
  }
}

type ObservedSite = WebSearchSite & { id: string; passages: Set<string> };
type Source = TeachingPolicyTurn["sources"][number];

/** Multiple text blocks may mix readable results and structured provider data. */
function observedSearchOutput(content: Extract<Context["messages"][number], { role: "toolResult" }>["content"]) {
  const parts = typeof content === "string" ? [content] : content.filter(part => part.type === "text").map(part => part.text);
  const combined = parseWebSearchResult(content, undefined, "complete");
  if (parts.length < 2 || !combined.proseResult && combined.sites.length) {
    return { sites: combined.sites, prose: combined.proseResult ? parts.join("\n") : "" };
  }
  const blocks = parts.map(text => ({ text, parsed: parseWebSearchResult(text, undefined, "complete") }));
  const sites = blocks.flatMap(block => block.parsed.sites);
  // A broken envelope can span blocks. Keep its contents private unless the blocks yield canonical records.
  const prose = combined.proseResult || sites.length ? blocks.filter(block => block.parsed.proseResult).map(block => block.text).join("\n") : "";
  return { sites, prose };
}

function passage(site: WebSearchSite, snippetChars?: number): string {
  const title = snippetChars === undefined ? site.title : site.title?.slice(0, 160);
  return [title, site.snippet?.slice(0, snippetChars)].filter(Boolean).join(" — ");
}

/** Every passage observed for a cited page: a supporting sentence may be in any of its results. */
function citedPassage(site: ObservedSite, limit: number): string {
  const passages = site.passages.size ? [...site.passages] : [passage(site, limit)];
  return passages.join("\n\n").slice(0, limit);
}

/** Keep a compact passage per selected URL before spending spare space on cited evidence. */
function searchSources(sites: ReadonlyMap<string, ObservedSite>, citedUrls: readonly string[], maxChars = MAX_SEARCH_SOURCE_CHARS): Source[] {
  const byKey = new Map<string, ObservedSite>();
  for (const site of sites.values()) if (!byKey.has(citationKey(site.url))) byKey.set(citationKey(site.url), site);
  const cited = new Set<ObservedSite>();
  for (const url of citedUrls) {
    const site = sites.get(url) ?? byKey.get(citationKey(url));
    if (site) cited.add(site);
  }
  const scale = Math.max(1, maxChars / MAX_SEARCH_SOURCE_CHARS);
  const maxSources = Math.ceil(MAX_SEARCH_SOURCES * scale);
  const fullSnippetChars = Math.ceil(FULL_SNIPPET_CHARS * scale);
  const selected = new Map<string, { id: string; url: string; text: string }>();
  // Each entry pays for its comma or closing bracket below.
  let remaining = maxChars - 1;
  for (const group of [cited.values(), sites.values()]) {
    for (const site of group) {
      if (selected.size === maxSources) break;
      if (selected.has(site.url)) continue;
      const source = { id: site.id, url: site.url, text: passage(site, COMPACT_SNIPPET_CHARS) };
      const size = JSON.stringify(source).length + 1;
      if (size > remaining) continue;
      selected.set(site.url, source);
      remaining -= size;
    }
  }

  const citedSites = [...cited].filter(site => selected.has(site.url));
  for (const [index, site] of citedSites.entries()) {
    const source = selected.get(site.url)!;
    const allowance = Math.floor(remaining / (citedSites.length - index));
    const originalSize = JSON.stringify(source.text).length;
    let expanded = citedPassage(site, fullSnippetChars).slice(0, source.text.length + allowance);
    // Escaped characters also count against the serialized review budget.
    const overflow = JSON.stringify(expanded).length - originalSize - allowance;
    if (overflow > 0) expanded = expanded.slice(0, expanded.length - overflow);
    if (expanded.length > source.text.length) {
      remaining -= JSON.stringify(expanded).length - originalSize;
      source.text = expanded;
    }
  }
  return [...selected.values()];
}

/** Index only returned search results. A candidate URL can select evidence but cannot create it. */
export function projectWebSearchEvidence(messages: Context["messages"], supplied: TeachingPolicyTurn["sources"]) {
  const suppliedSources = supplied.map(({ id, url, text }) => ({ id, url, text }));
  const suppliedUrls = new Set(suppliedSources.map(source => source.url));
  const suppliedAdditions = new Map<string, Set<string>>();
  const suppliedIds = new Set(suppliedSources.map(source => source.id));
  let nextId = 1;
  const sites = new Map<string, ObservedSite>();
  const outcomes: TeachingPolicyTurn["toolResults"][number][] = [];
  const summarized = new Set<string>();
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index]!;
    if (message.role !== "toolResult" || !isWebSearchToolName(message.toolName)) continue;
    const status = message.isError ? "error" : "success";
    const key = `${message.toolName}:${status}`;
    if (message.isError) {
      if (!summarized.has(key)) outcomes.push({ name: message.toolName, status, content: "Web search failed." });
      summarized.add(key);
      continue;
    }
    const result = observedSearchOutput(message.content);
    if (result.prose) {
      outcomes.push({ name: message.toolName, status, content: result.prose });
    } else if (!summarized.has(key)) {
      outcomes.push({ name: message.toolName, status,
        content: result.sites.length ? "Web search completed. See the supplied sources." : "Web search completed." });
      summarized.add(key);
    }
    for (const site of result.sites) {
      const observed = passage(site);
      if (suppliedUrls.has(site.url)) {
        const additions = suppliedAdditions.get(site.url) ?? new Set<string>();
        if (observed) additions.add(observed);
        suppliedAdditions.set(site.url, additions);
        continue;
      }
      let entry = sites.get(site.url);
      if (!entry) {
        while (suppliedIds.has(`web-${nextId}`)) nextId++;
        entry = { ...site, id: `web-${nextId++}`, passages: new Set() };
        sites.set(site.url, entry);
      } else if (!entry.snippet && site.snippet) {
        entry.snippet = site.snippet;
        entry.title = site.title ?? entry.title;
      }
      if (observed) entry.passages.add(observed);
    }
  }
  const sources = [
    ...suppliedSources.map(source => {
      const additions = suppliedAdditions.get(source.url);
      return additions?.size ? { ...source, text: [...new Set([source.text, ...additions])].filter(Boolean).join("\n\n") } : source;
    }),
    ...Array.from(sites.values(), site => ({ id: site.id, url: site.url, text: [...site.passages].join("\n\n") })),
  ];
  return {
    sources,
    toolResults: outcomes.reverse(),
    /** `maxChars` lets the reviewer's actual spare room decide how much evidence it keeps. */
    compactSources(replies: readonly TeachingPolicyReply[], maxChars = MAX_SEARCH_SOURCE_CHARS) {
      return [...suppliedSources, ...searchSources(sites, replies.flatMap(reply => webUrlsInText(reply.text)), maxChars)];
    },
    reviewResearch(reply: TeachingPolicyReply) {
      return {
        sources,
        searchOnly: reply.toolCalls.length > 0 && reply.toolCalls.every(call => isWebSearchToolName(call.name)),
      };
    },
  };
}
