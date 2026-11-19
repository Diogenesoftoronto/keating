import { useId, useMemo, useState } from "react";
import { css, cx } from "../../styled-system/css";
import { useAuiState } from "@assistant-ui/react";
import { KeatingGlyph } from "../design-system/glyphs";
import { hasMeaningfulToolResult, resolveToolVisualState } from "./tool-lifecycle";
import {
  citationsFromCalls,
  hostOf,
  parseWebSearchResult,
  webSearchRuns,
  type WebSearchCall,
  type WebSearchSite,
} from "./web-search-result";
import "./web-search.css";

export type WebSearchPartProps = {
  toolName: string;
  toolCallId?: string;
  args?: unknown;
  result?: unknown;
  isError?: boolean;
  status?: { type: string };
};

const queries = (count: number) => (count === 1 ? "1 query" : `${count} queries`);

function summarize(calls: readonly WebSearchCall[]) {
  const running = calls.filter(call => call.state === "running");
  const failed = calls.filter(call => call.state === "error");
  const sources = citationsFromCalls(calls).length;
  if (running.length) {
    const current = running[running.length - 1];
    return { state: "running" as const, label: "Searching the web", detail: current.query, meta: calls.length > 1 ? queries(calls.length) : undefined };
  }
  if (failed.length === calls.length) {
    return { state: "error" as const, label: "Search failed", detail: calls.length === 1 ? calls[0].query : queries(calls.length), meta: undefined };
  }
  const detail = calls.length === 1 ? calls[0].query : queries(calls.length);
  const meta = [`${sources} ${sources === 1 ? "source" : "sources"}`, failed.length ? `${failed.length} failed` : ""].filter(Boolean).join(" · ");
  return { state: "success" as const, label: "Searched the web", detail, meta };
}

/** One compact, expandable line for one or more consecutive searches. */
export function WebSearchActivity({ calls }: { calls: readonly WebSearchCall[] }) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const summary = summarize(calls);
  const glyph = summary.state === "running" ? "spin" : summary.state === "error" ? "alert" : "globe";
  return (
    <section className="search-activity" data-state={summary.state} aria-label="Web search">
      <button type="button" className="search-activity__line" aria-expanded={expanded} aria-controls={panelId} onClick={() => setExpanded(value => !value)}>
        <KeatingGlyph name={glyph} size={14} className={glyph === "spin" ? cx("k-glyph-working", css({ flexShrink: 0, color: "var(--primary)" })) : "search-activity__icon"} />
        <span className="search-activity__label" role="status">{summary.label}</span>
        {summary.detail && <span key={summary.detail} className="search-activity__detail">{summary.detail}</span>}
        {summary.meta && <span className="search-activity__meta">{summary.meta}</span>}
        <KeatingGlyph name="chev" size={14} className="search-activity__chevron" />
      </button>
      {expanded && (
        <ol id={panelId} className="search-activity__queries">
          {calls.map(call => (
            <li key={call.id} data-state={call.state}>
              <span className={call.state === "running" ? css({ flexShrink: 0, paddingTop: ".15rem", color: "var(--primary)" }) : "search-activity__query-icon"} aria-hidden="true">
                {call.state === "running" ? <KeatingGlyph name="spin" size={12} className="k-glyph-working" /> : call.state === "error" ? <KeatingGlyph name="alert" size={12} /> : <KeatingGlyph name="check" size={12} />}
              </span>
              <span className="search-activity__query-body">
                <span className="search-activity__query">{call.query ?? "Web search"}</span>
                {call.state === "error" ? (
                  <span className="search-activity__hosts">{call.text || "The search provider could not finish this request."}</span>
                ) : call.state === "success" ? (
                  <span className="search-activity__hosts">
                    {call.sites.length ? [...new Set(call.sites.map(site => hostOf(site.url)))].slice(0, 4).join(" · ") : "No source links"}
                  </span>
                ) : null}
              </span>
              {call.state === "success" && <span className="search-activity__count">{call.sites.length}</span>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

const COLLAPSED_CITATIONS = 4;

/** Numbered source list shown once, under the finished reply. */
export function WebSearchCitations({ sites }: { sites: readonly WebSearchSite[] }) {
  const [expanded, setExpanded] = useState(false);
  if (!sites.length) return null;
  const visible = expanded ? sites : sites.slice(0, COLLAPSED_CITATIONS);
  return (
    <section className="search-citations" aria-label="Sources">
      <h3 className="search-citations__title">Sources</h3>
      <ol className="search-citations__list">
        {visible.map((site, index) => (
          <li key={site.url}>
            <a href={site.url} target="_blank" rel="noopener noreferrer" className="search-citations__link" title={site.snippet}>
              <span className="search-citations__number" aria-hidden="true">{index + 1}</span>
              <span className="search-citations__domain">{hostOf(site.url)}</span>
              {site.title && <span className="search-citations__name">{site.title}</span>}
              <KeatingGlyph name="ext" size={12} />
            </a>
          </li>
        ))}
      </ol>
      {sites.length > COLLAPSED_CITATIONS && (
        <button type="button" className="search-citations__more" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
          {expanded ? "Show fewer" : `Show all ${sites.length}`}
          <KeatingGlyph name={expanded ? "chevu" : "chev"} size={12} />
        </button>
      )}
    </section>
  );
}

function callFromProps({ toolCallId, args, result, isError, status }: WebSearchPartProps): WebSearchCall {
  return { ...parseWebSearchResult(result, args), id: toolCallId ?? "search", state: resolveToolVisualState({ result, isError, status }) };
}

/** Standalone search (outside a message): the activity line, then its sources when done. */
export function WebSearchPart(props: WebSearchPartProps) {
  const call = useMemo(() => callFromProps(props), [props.toolCallId, props.args, props.result, props.isError, props.status?.type]);
  return (
    <>
      <WebSearchActivity calls={[call]} />
      {call.state === "success" && <WebSearchCitations sites={call.sites} />}
    </>
  );
}

function useMessageSearchRuns(): WebSearchCall[][] {
  const content = useAuiState(({ message }) => message.content);
  const messageRunning = useAuiState(({ message }) => message.status?.type === "running");
  return useMemo(() => webSearchRuns(content as never, hasMeaningfulToolResult).map(run => run.map(call =>
    call.state === "running" && !messageRunning ? { ...call, state: "error" as const } : call,
  )), [content, messageRunning]);
}

/**
 * Message tool-part renderer: the first search in a run draws the line for the
 * whole run; the rest render nothing. Sources go to the message footer.
 */
export function MessageWebSearchPart(props: WebSearchPartProps) {
  const runs = useMessageSearchRuns();
  const run = runs.find(candidate => candidate.some(call => call.id === props.toolCallId));
  if (!run) return <WebSearchActivity calls={[callFromProps(props)]} />;
  return run[0].id === props.toolCallId ? <WebSearchActivity calls={run} /> : null;
}

type ThreadMessageLike = { id: string; role: string; content: readonly unknown[]; status?: { type: string } };

/** Searches from the user's message up to `end` (inclusive), across the turn's agent steps. */
export function turnSearchCalls(messages: readonly ThreadMessageLike[], end: number, running: boolean): WebSearchCall[] {
  let start = end;
  while (start > 0 && messages[start - 1]?.role !== "user") start -= 1;
  return messages.slice(start, end + 1).flatMap(message => message.role !== "assistant" ? [] :
    webSearchRuns(message.content as never, hasMeaningfulToolResult).flat().map(call =>
      call.state === "running" && !running ? { ...call, state: "error" as const } : call));
}

/** The current turn's searches: ending at this message, or at the end of the thread. */
export function useTurnSearchCalls(scope: "message" | "thread"): WebSearchCall[] {
  const messages = useAuiState(({ thread }) => thread.messages) as unknown as readonly ThreadMessageLike[];
  const running = useAuiState(({ thread }) => thread.isRunning);
  const ownId = useAuiState(state => scope === "message" ? state.message.id : undefined);
  return useMemo(() => {
    const end = ownId === undefined ? messages.length - 1 : messages.findIndex(message => message.id === ownId);
    const turnRunning = running && !messages.slice(end + 1).some(message => message.role === "user");
    return end < 0 ? [] : turnSearchCalls(messages, end, turnRunning);
  }, [messages, running, ownId]);
}

/** Every source the turn's searches found, once, under the turn's last reply after it finishes. */
export function MessageSearchCitations() {
  const calls = useTurnSearchCalls("message");
  const lastOfTurn = useAuiState(({ thread, message }) => {
    const index = thread.messages.findIndex(candidate => candidate.id === message.id);
    const next = thread.messages[index + 1];
    return index >= 0 && (!next || next.role === "user");
  });
  const running = useAuiState(({ thread, message }) => thread.isRunning && thread.messages.at(-1)?.id === message.id);
  const sites = useMemo(() => citationsFromCalls(calls), [calls]);
  if (running || !lastOfTurn) return null;
  return <WebSearchCitations sites={sites} />;
}
