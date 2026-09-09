import { useMemo, useState } from "react";
import { CircleAlert, Check, ChevronDown, ExternalLink, Globe, Search } from "lucide-react";
import { resolveToolVisualState } from "./tool-lifecycle";
import { hostOf, parseWebSearchResult } from "./web-search-result";
import "./web-search.css";

export type WebSearchPartProps = {
  toolName: string;
  args?: unknown;
  result?: unknown;
  isError?: boolean;
  status?: { type: string };
};

export function WebSearchPart({ args, result, isError, status }: WebSearchPartProps) {
  const parsed = useMemo(() => parseWebSearchResult(result, args), [result, args]);
  const [expanded, setExpanded] = useState(false);
  const state = resolveToolVisualState({ result, isError, status });
  const running = state === "running";
  const failed = state === "error";
  const sites = expanded ? parsed.sites : parsed.sites.slice(0, 3);
  return (
    <section className="search-result" data-state={state} aria-label="Web search">
      <header className="search-result__header">
        <span className="search-result__icon" aria-hidden="true">{failed ? <CircleAlert size={17} /> : running ? <Search size={17} /> : <Globe size={17} />}</span>
        <div className="search-result__heading">
          <span className="search-result__status" role="status">{running ? "Searching the web" : failed ? "Search failed" : "Web sources"}</span>
          {parsed.query && <p className="search-result__query">{parsed.query}</p>}
        </div>
        {!running && !failed && <span className="search-result__count"><Check size={13} aria-hidden="true" />{parsed.sites.length} {parsed.sites.length === 1 ? "source" : "sources"}</span>}
      </header>
      {running && <div className="search-result__progress" aria-hidden="true"><span /></div>}
      {failed ? <div className="search-result__failure"><p>{parsed.text || "The search provider could not finish this request."}</p><span>Check the provider connection in Settings. Failure details can be copied from Diagnostics.</span></div> : !running && <>
        {sites.length ? <ol className="search-result__sources">{sites.map((site, index) => <li key={site.url}>
          <a href={site.url} target="_blank" rel="noopener noreferrer" className="search-result__source">
            <span className="search-result__number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
            <span className="search-result__source-body"><span className="search-result__domain">{hostOf(site.url)}</span><strong>{site.title || hostOf(site.url)}</strong>{site.snippet && <span className="search-result__snippet">{site.snippet}</span>}</span>
            <ExternalLink size={14} aria-hidden="true" />
          </a>
        </li>)}</ol> : <p className="search-result__empty">The search finished without source links.</p>}
        {parsed.sites.length > 3 && <button type="button" className="search-result__expand" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? "Show fewer sources" : `Show all ${parsed.sites.length} sources`}<ChevronDown size={14} aria-hidden="true" style={{ transform: expanded ? "rotate(180deg)" : undefined }} /></button>}
        {!parsed.sites.length && parsed.text && <details className="search-result__details"><summary>View search response</summary><pre>{parsed.text}</pre></details>}
      </>}
    </section>
  );
}
