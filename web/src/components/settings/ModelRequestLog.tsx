import { useSyncExternalStore } from "react";
import { css } from "../../../styled-system/css";
import { downloadTextFile } from "../../lib/browser-download";
import {
  clearModelRequestLog,
  getModelRequestLog,
  modelRequestLogEnabled,
  setModelRequestLogEnabled,
  subscribeModelRequestLog,
  type ModelRequestEntry,
} from "../../keating/model-request-log";
import { Toggle } from "../Toggle";

const muted = css({ fontSize: "0.75rem", color: "var(--muted-foreground)" });
const heading = css({ fontSize: "0.875rem", fontWeight: 600, color: "var(--foreground)" });
const button = css({ padding: ".375rem .625rem", border: "1px solid var(--border)", borderRadius: ".375rem", fontSize: ".75rem", cursor: "pointer" });
const pre = css({ maxHeight: "24rem", overflow: "auto", padding: ".75rem", borderRadius: ".375rem", background: "var(--muted)",
  fontSize: ".6875rem", whiteSpace: "pre-wrap", wordBreak: "break-word" });

function summary(entry: ModelRequestEntry): string {
  const time = new Date(entry.at).toLocaleTimeString();
  if (entry.kind === "judge") return `${time} · judge · ${entry.model} · ${Object.keys(entry.judgement?.questions ?? {}).length} questions`;
  const messages = entry.context?.messages.length ?? 0;
  const tools = entry.context?.tools?.length ?? 0;
  const chars = (entry.context?.systemPrompt?.length ?? 0) + JSON.stringify(entry.context?.messages ?? []).length;
  return `${time} · draft · ${entry.model} · ${messages} messages · ${tools} tools · ~${Math.ceil(chars / 4)} tokens`;
}

function Section({ title, value }: { title: string; value: unknown }) {
  if (value === undefined) return null;
  return <details>
    <summary className={muted}>{title}</summary>
    <pre className={pre}>{typeof value === "string" ? value : JSON.stringify(value, null, 2)}</pre>
  </details>;
}

/** Opt-in history of every draft and judge request, newest first. */
export function ModelRequestLog() {
  const enabled = useSyncExternalStore(subscribeModelRequestLog, modelRequestLogEnabled, () => false);
  const entries = useSyncExternalStore(subscribeModelRequestLog, getModelRequestLog, getModelRequestLog);
  return <section className={css({ display: "flex", flexDirection: "column", gap: ".75rem" })} aria-labelledby="model-request-log-heading">
    <div className={css({ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "1rem" })}>
      <div>
        <h3 id="model-request-log-heading" className={heading}>Model request log</h3>
        <p className={muted}>Records each private draft (system prompt, messages, tools and provider payload) and each review request, in memory only. Keeps the last 30. Also available in the console as <code>__keatingRequests</code>.</p>
      </div>
      <Toggle aria-label="Record model requests" checked={enabled} onChange={setModelRequestLogEnabled} />
    </div>
    {enabled && <>
      <div className={css({ display: "flex", gap: ".5rem" })}>
        <button type="button" className={button} disabled={!entries.length}
          onClick={() => downloadTextFile("keating-model-requests.json", JSON.stringify(entries, null, 2))}>Download JSON</button>
        <button type="button" className={button} disabled={!entries.length} onClick={clearModelRequestLog}>Clear</button>
      </div>
      {!entries.length && <p className={muted}>Send a message to record its requests.</p>}
      {[...entries].reverse().map(entry => <details key={entry.id}>
        <summary className={muted}>{summary(entry)}</summary>
        <div className={css({ display: "flex", flexDirection: "column", gap: ".5rem", marginTop: ".5rem", paddingLeft: ".75rem" })}>
          <Section title="System prompt" value={entry.context?.systemPrompt} />
          <Section title="Messages" value={entry.context?.messages} />
          <Section title="Tools" value={entry.context?.tools?.map(tool => ({ name: tool.name, description: tool.description, parameters: tool.parameters }))} />
          <Section title="Provider payload" value={entry.payload} />
          <Section title="Review questions and state" value={entry.judgement} />
        </div>
      </details>)}
    </>}
  </section>;
}
