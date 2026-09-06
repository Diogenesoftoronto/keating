import { localRead, saveLocalAttachment, type LocalFile } from "../submissions/local-store";
import { useContext, createContext, useId, useRef, useState } from "react";
import { Check, File as FileIcon, Paperclip, RotateCcw, X } from "lucide-react";
import type { UiSubmissionAttachment } from "@keating/learner-contracts";
import "./assignment-controls.css";

// File selection is local-only. Course delivery uploads from the persisted outbox.
export const SubmissionUploadContext = createContext(saveLocalAttachment);
export function attachmentUrl(id: string, courseId?: string) {
  return `/api/submission-attachments/${encodeURIComponent(id)}${courseId ? `?courseId=${encodeURIComponent(courseId)}` : ""}`;
}
async function downloadAttachment(id: string, fallback: string) {
  const local = await localRead<LocalFile>("files", id).catch(() => undefined);
  if (!local) { window.location.assign(fallback); return; }
  const url = URL.createObjectURL(local.blob);
  const link = document.createElement("a");
  link.href = url; link.download = local.metadata.name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function AttachmentLinks({ attachments, courseId }: { attachments: UiSubmissionAttachment[]; courseId?: string }) {
  return <ul>{attachments.map((file) => <li key={file.id}><a href={attachmentUrl(file.id, courseId)} download onClick={(event) => { event.preventDefault(); void downloadAttachment(file.id, attachmentUrl(file.id, courseId)); }}>{file.name}</a> <small>({Math.ceil(file.sizeBytes / 1024)} KB)</small></li>)}</ul>;
}
export function SubmissionAttachments({ value, onChange, disabled, onBusyChange }: {
  value: UiSubmissionAttachment[]; onChange: (files: UiSubmissionAttachment[]) => void; disabled?: boolean; onBusyChange?: (busy: boolean) => void;
}) {
  const upload = useContext(SubmissionUploadContext);
  const inputId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const active = useRef(false);
  const [error, setError] = useState("");
  const [savingName, setSavingName] = useState("");
  const [retryFiles, setRetryFiles] = useState<File[]>([]);
  const limitReached = value.length >= 10;

  async function attach(files: File[]) {
    if (!files.length || active.current || disabled) return;
    if (files.length + value.length > 10) { setError("Up to 10 files per submission. Choose fewer files."); return; }
    active.current = true; setBusy(true); onBusyChange?.(true); setError(""); setRetryFiles([]);
    const uploaded = [...value];
    let index = 0;
    try {
      for (; index < files.length; index++) {
        const file = files[index];
        setSavingName(file.name);
        uploaded.push(await upload(file));
        onChange([...uploaded]);
      }
    } catch (cause) {
      setRetryFiles(files.slice(index));
      setError(`${files[index]?.name ?? "File"}: ${cause instanceof Error ? cause.message : "Could not save this file. Try again."}`);
    } finally {
      active.current = false; setBusy(false); setSavingName(""); onBusyChange?.(false);
    }
  }

  return <div className="submission-attachments">
    <div className="submission-attachments__toolbar">
      <button type="button" className="submission-attachments__button submission-attachments__add" disabled={disabled || busy || limitReached} aria-describedby={`${inputId}-limits`} onClick={() => input.current?.click()}>
        <Paperclip aria-hidden="true" />{busy ? "Attaching…" : "Attach files"}
      </button>
      <span id={`${inputId}-limits`} className="assignment-control__hint">{limitReached ? "10-file limit reached" : "Up to 10 files · 25 MB each"}</span>
      <input ref={input} id={inputId} className="submission-attachments__input" aria-label="Choose files to attach" aria-describedby={`${inputId}-limits`} type="file" multiple tabIndex={-1} disabled={disabled || busy || limitReached} onChange={(event) => {
        const files = Array.from(event.currentTarget.files ?? []);
        event.currentTarget.value = "";
        void attach(files);
      }} />
    </div>
    {value.length > 0 && <ul className="submission-attachments__files" aria-label="Attached files">{value.map((file) => <li className="submission-attachments__file" key={file.id}>
      <FileIcon className="submission-attachments__file-icon" aria-hidden="true" />
      <span className="submission-attachments__file-copy"><span className="submission-attachments__filename">{file.name}</span><span className="assignment-control__hint">{file.sizeBytes >= 1024 * 1024 ? `${(file.sizeBytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.ceil(file.sizeBytes / 1024))} KB`} <span className="submission-attachments__ready"><Check aria-hidden="true" /> Attached</span></span></span>
      <button type="button" className="submission-attachments__button submission-attachments__remove" disabled={disabled || busy} onClick={() => onChange(value.filter((item) => item.id !== file.id))} aria-label={`Remove ${file.name}`}><X aria-hidden="true" /></button>
    </li>)}</ul>}
    <div className="assignment-control__status" role="status" aria-live="polite">{busy ? <span>Saving <strong>{savingName}</strong>…</span> : value.length > 0 ? <span>{value.length} file{value.length === 1 ? "" : "s"} attached</span> : null}</div>
    {error && <div className="assignment-control__error"><p role="alert">{error}</p>{retryFiles.length > 0 && <button type="button" className="submission-attachments__button submission-attachments__retry" disabled={disabled || busy} onClick={() => void attach(retryFiles)}><RotateCcw aria-hidden="true" />Retry {retryFiles.length === 1 ? "file" : "files"}</button>}</div>}
  </div>;
}
