import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { connectKnowledge, getKnowledgeReview, knowledgeClient, knowledgeSetupUrl, knowledgeVersion, subscribeKnowledge, type KnowledgeResource } from "../../notorganic-provider/knowledge";
import "./knowledge-sources.css";

/** Compact, account-owned selections: turning on a source never turns on its remote tools. */
export function KnowledgeSources() {
  useSyncExternalStore(subscribeKnowledge, knowledgeVersion, () => 0);
  const client = knowledgeClient();
  const [, tick] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [resources, setResources] = useState<Record<string, KnowledgeResource[]>>({});
  const [reading, setReading] = useState<string>();
  const [content, setContent] = useState<string>();
  const alive = useRef(true);
  const account = useRef<string | undefined>(undefined);
  const operation = useRef(0);
  const state = client?.snapshot();
  const toolPermission = client?.transport.getSession()?.scope.split(/\s+/).includes("knowledge:tools") === true;
  const selectId = useId();
  const refresh = async () => {
    if (!client) return;
    const epoch = ++operation.current;
    setBusy(true); setError(undefined); setContent(undefined); setResources({});
    try { await client.refresh(); }
    catch (error) { if (alive.current && epoch === operation.current) setError(error instanceof Error ? error.message : "Could not load sources."); }
    finally { if (alive.current && epoch === operation.current) { setBusy(false); tick(v => v + 1); } }
  };
  useEffect(() => {
    alive.current = true;
    const sync = () => {
      const id = client?.transport.getSession()?.id;
      if (id !== account.current) { account.current = id; operation.current++; client?.snapshot(); setResources({}); setContent(undefined); setReading(undefined); setError(undefined); setBusy(false); tick(v => v + 1); if (client?.snapshot().status === "ready") void refresh(); }
    };
    sync();
    const timer = setInterval(sync, 2_000);
    window.addEventListener("focus", sync); window.addEventListener("storage", sync);
    return () => { alive.current = false; operation.current++; clearInterval(timer); window.removeEventListener("focus", sync); window.removeEventListener("storage", sync); };
  }, [client]);
  const action = async (work: () => Promise<void>) => {
    const epoch = ++operation.current;
    setBusy(true); setError(undefined);
    try { await work(); }
    catch (error) { if (alive.current && epoch === operation.current) setError(error instanceof Error ? error.message : "Could not complete the request."); }
    finally { if (alive.current && epoch === operation.current) { setBusy(false); tick(v => v + 1); } }
  };
  const setup = knowledgeSetupUrl();
  return <section className="knowledge-sources" aria-label="Knowledge sources">
    <header><div><h3>Your sources</h3><p>Bring account knowledge into this conversation. Choose each source and the tools you want Keating to use.</p></div><button type="button" onClick={() => void refresh()} disabled={!client || busy || state?.status === "signed-out" || state?.status === "permission"}>Refresh</button></header>
    {!client ? <p>Not Organic connections are not configured on this Keating deployment.</p> : state?.status === "signed-out" || state?.status === "permission" ? <div className="knowledge-sources-notice"><p>{state.status === "signed-out" ? "Connect your Not Organic account to bring your sources with you." : "Your account is connected. Allow knowledge access to use shared sources here."}</p><button type="button" disabled={busy} onClick={() => void action(connectKnowledge)}>{state.status === "signed-out" ? "Connect account & sources" : "Allow knowledge access"}</button></div> : <>
      {busy && <p role="status">Loading sources…</p>}
      {!busy && state?.status === "ready" && !state.sources.length && <p>No sources are shared with this Keating app yet. Add a remote MCP connection in Not Organic and review Keating’s access.</p>}
      {state?.sources.map(source => {
        const selected = !!state.selected[source.id];
        return <div className="knowledge-source" key={source.id}><label className="knowledge-source-toggle"><input type="checkbox" checked={selected} disabled={busy} onChange={event => { client?.selectSource(source.id, event.target.checked); setResources({}); setContent(undefined); }} /><span><strong>{source.label}</strong><small>Remote MCP · {source.resources_allowed ? "Resources shared" : "Resources not shared"} · {source.tools.length} permitted tools</small></span></label>
          {selected && <div className="knowledge-source-details">{source.tools.length > 0 && <fieldset><legend>Allow tools in Keating</legend><p>Each call will ask you to review its arguments before running.</p>{!toolPermission && <button type="button" disabled={busy} onClick={() => void action(connectKnowledge)}>Allow tool access</button>}{source.tools.map(tool => <label key={tool.name}><input type="checkbox" checked={!!state.selected[source.id]?.tools[tool.name]} disabled={busy || !toolPermission} onChange={event => client?.selectTool(source.id, tool.name, event.target.checked)} /><span>{tool.name}{tool.description && <small>{tool.description.slice(0, 240)}</small>}</span></label>)}</fieldset>}
            {source.resources_allowed && <><button type="button" disabled={busy} onClick={() => void action(async () => { const found = await client!.resources(source.id); if (alive.current && client!.snapshot().selected[source.id]) setResources(previous => ({ ...previous, [source.id]: found })); })}>Browse resources</button>{resources[source.id] && (resources[source.id].length ? <><label htmlFor={`${selectId}-${source.id}`}>Read a resource</label><select id={`${selectId}-${source.id}`} value={reading?.startsWith(`${source.id}\n`) ? reading.split("\n")[1] : ""} onChange={event => setReading(`${source.id}\n${event.target.value}`)}><option value="">Choose a resource…</option>{resources[source.id].map(resource => <option key={resource.uri} value={resource.uri}>{resource.name}</option>)}</select><button type="button" disabled={busy || !reading?.startsWith(`${source.id}\n`) || !reading.split("\n")[1]} onClick={() => void action(async () => { const result = await client!.read(source.id, reading!.split("\n")[1]); if (alive.current) setContent(result); })}>Read</button></> : <p>This source has no listed resources. Enable a permitted search tool if it provides one.</p>)}</>}
          </div>}
        </div>;
      })}
    </>}
    {(error || state?.error) && <p role="alert" className="knowledge-sources-error">{error ?? state?.error}</p>}
    {content && <details open><summary>Source content · untrusted evidence</summary><pre className="knowledge-source-content">{content}</pre></details>}
    {setup && <a href={setup} target="_blank" rel="noopener noreferrer">Add connections or review sharing in Not Organic ↗</a>}
    <footer><strong>Google Drive</strong><span>Coming soon</span><p>Start with a remote MCP server. Google sign-in connections are on the way.</p></footer>
  </section>;
}

export function KnowledgeSourcesButton() {
  useSyncExternalStore(subscribeKnowledge, knowledgeVersion, () => 0);
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const state = knowledgeClient()?.snapshot();
  const count = Object.keys(state?.selected ?? {}).length;
  useEffect(() => { const timer = setInterval(() => { knowledgeClient()?.snapshot(); }, 2_000); return () => clearInterval(timer); }, []);
  useEffect(() => { if (open) dialog.current?.showModal(); else dialog.current?.close(); }, [open]);
  return <><button type="button" className="knowledge-sources-button" onClick={() => setOpen(true)} aria-label={`Choose knowledge sources. ${count} selected.`}>Sources · {count}</button><dialog ref={dialog} className="knowledge-sources-dialog" aria-label="Choose your sources" onCancel={() => setOpen(false)} onClick={event => { if (event.target === event.currentTarget) setOpen(false); }}><button className="knowledge-sources-close" type="button" onClick={() => setOpen(false)} aria-label="Close sources">×</button>{open && <KnowledgeSources />}</dialog></>;
}
export function KnowledgeToolReview() {
  useSyncExternalStore(subscribeKnowledge, knowledgeVersion, () => 0);
  const review = getKnowledgeReview();
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (review) dialog.current?.showModal(); else dialog.current?.close(); }, [review?.id]);
  useEffect(() => () => { getKnowledgeReview()?.settle(false); }, []);
  return <dialog ref={dialog} className="knowledge-sources-dialog" aria-label="Review remote tool call" onCancel={event => { event.preventDefault(); review?.settle(false); }}><h3>Run this source tool?</h3><p><strong>{review?.source}</strong> · {review?.tool}</p><p>This remote tool may change external data. Review exactly what will be sent.</p><pre className="knowledge-source-content">{review?.args}</pre><div className="knowledge-sources-actions"><button type="button" autoFocus onClick={() => review?.settle(false)}>Cancel</button><button type="button" onClick={() => review?.settle(true)}>Run once</button></div></dialog>;
}
