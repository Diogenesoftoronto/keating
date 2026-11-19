import { useRef, useState } from "react";
import { Button, DefinitionList, Loading, Note, Sheet, TextInput } from "../../design-system/kit";
import { loadKeatingUiSettings, type ShareLinkMode } from "../../keating/ui-settings";
import type { ShareState } from "../../pages/chat/session-sharing";
import "./export-sheet.css";
import "../workspace/materials.css";

const modes: Record<ShareLinkMode, string> = {
  "portable-short": "Portable link",
  "compressed-hash": "Compressed link",
  "local-short": "Local link",
};

export async function copySessionLink(url: string, field: HTMLInputElement | null, clipboard: Pick<Clipboard, "writeText"> | undefined) {
  try {
    if (!clipboard) throw new Error("Clipboard unavailable");
    await clipboard.writeText(url);
    return "copied" as const;
  } catch {
    field?.focus();
    field?.select();
    return "selected" as const;
  }
}

export function ShareSheet({ shareState, shareUrl, shareMessage, onConfirm, onDismiss }: {
  shareState: ShareState;
  shareUrl: string | null;
  shareMessage: string | null;
  onConfirm(): Promise<void>;
  onDismiss(): void;
}) {
  const [settings] = useState(loadKeatingUiSettings);
  const [consent, setConsent] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "selected">("idle");
  const field = useRef<HTMLInputElement>(null);
  const local = settings.shareLinkMode === "local-short";
  const busy = shareState === "sharing";
  const close = () => {
    if (!busy) onDismiss();
  };
  const copy = async () => {
    if (!shareUrl) return;
    setCopyState(await copySessionLink(shareUrl, field.current, navigator.clipboard));
  };
  return <Sheet open={shareState !== "idle"} onClose={close} title={<span className="rv-sheet-title k-halftone">Share session</span>} className="h1-share rv-export-sheet" footer={<div className="rv-export-actions">
    <Button disabled={busy} onClick={close}>{shareState === "ready" || shareState === "error" ? "Dismiss" : "Cancel"}</Button>
    {(shareState === "confirm" || busy) && <Button variant="primary" busy={busy} disabled={busy || (!local && !consent)}
      onClick={() => { if (!busy && (local || consent)) void onConfirm(); }}>{busy ? <Loading size="inline" label="Sharing…" /> : local ? "Create local link" : "Share publicly"}</Button>}
    {shareUrl && <Button glyph="copy" onClick={copy}>{copyState === "copied" ? "Copied" : "Copy"}</Button>}
  </div>}>
    {shareState === "ready" ? <>
      <p role="status">{shareMessage}</p>
      <TextInput aria-label={local ? "Local session link" : "Read-only session link"} ref={field} readOnly value={shareUrl ?? ""} onFocus={event => event.currentTarget.select()} />
      <span role="status">{copyState === "selected" ? "Link selected. Copy it using your device’s copy command." : copyState === "copied" ? "Link copied" : ""}</span>
    </> : <>
      <p>{modes[settings.shareLinkMode]}{local ? " · Stays on this device." : ""}</p>
      <details open={!settings.trajectoryShareWarningAcknowledged}>
        <summary>What the link includes</summary>
        <DefinitionList items={[
          { term: "Included", detail: "The visible conversation, safe session artifacts, and any finalized review feedback." },
          { term: "Not included", detail: "Drafts, hidden tool traffic, and unsupported or oversized artifacts." },
          { term: "Who can read it", detail: local ? "Only this browser on this device." : "Anyone with the link can read it." },
        ]}/>
      </details>
      {!local && shareState !== "error" && <label className="h1-consent"><input type="checkbox" checked={consent} disabled={busy} onChange={event => setConsent(event.target.checked)} /> I understand anyone with the link can read this</label>}
      {shareState === "error" && <Note data-glyph-host tone="warn" role="alert">{shareMessage}</Note>}
    </>}
  </Sheet>;
}
