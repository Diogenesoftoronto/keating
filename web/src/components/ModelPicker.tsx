import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, Search, X } from "lucide-react";
import "./selection-library.css";

export interface PickerItem {
 id: string; name: string; group: string; summary?: string; details?: ReactNode;
}
export function ModelPicker({ open, label, items, selected, onSelect, onClose, filters, notice, loading = false, error = "" }: {
 open: boolean; label: string; items: PickerItem[]; selected: string;
 onSelect: (id: string) => void | Promise<void>; onClose: () => void;
 filters?: ReactNode; notice?: ReactNode; loading?: boolean; error?: string;
}) {
 const dialog = useRef<HTMLDialogElement>(null);
 const searchRef = useRef<HTMLInputElement>(null);
 const buttons = useRef(new Map<string, HTMLButtonElement>());
 const [query, setQuery] = useState("");
 const [busy, setBusy] = useState("");
 const [failure, setFailure] = useState("");
 useEffect(() => {
  if (!open) { dialog.current?.close(); return; }
  const previous = document.activeElement as HTMLElement | null;
  setQuery(""); setFailure("");
  dialog.current?.showModal();
  searchRef.current?.focus();
  return () => { dialog.current?.close(); previous?.focus(); };
 }, [open]);
 const matches = items.filter(item => (item.name + " " + item.group + " " + (item.summary ?? "") + " " + item.id).toLowerCase().includes(query.trim().toLowerCase()));
 const ordered = [...matches.filter(item => item.id === selected), ...matches.filter(item => item.id !== selected)];
 const focus = (index: number) => {
  const item = ordered[(index + ordered.length) % ordered.length];
  if (!item) return;
  const button = buttons.current.get(item.id);
  button?.focus(); button?.scrollIntoView({ block: "nearest" });
 };
 const choose = async (id: string) => {
  if (busy) return;
  setBusy(id); setFailure("");
  try {
   await onSelect(id);
   requestAnimationFrame(() => {
    if (dialog.current?.open) buttons.current.get(id)?.focus();
   });
  }
  catch (error) { setFailure(error instanceof Error ? error.message : "Could not select this model. Try another model."); }
  finally { setBusy(""); }
 };
 return <dialog ref={dialog} className="model-picker" aria-label={label}
  onCancel={event => { event.preventDefault(); onClose(); }}
  onClick={event => { if (event.target === event.currentTarget) {
   const bounds = event.currentTarget.getBoundingClientRect();
   if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
  } }}>
  <div className="model-picker__body">
   <div className="model-picker__toolbar">
    <label className="library-search"><Search size={18} aria-hidden="true" />
     <input ref={searchRef} aria-label={label} placeholder={label} value={query} onChange={event => setQuery(event.target.value)}
      onKeyDown={event => { if (event.key === "ArrowDown" && ordered.length) { event.preventDefault(); focus(0); } }} />
    </label>
    <button type="button" className="library-icon" aria-label="Close model picker" onClick={onClose}><X size={18}/></button>
   </div>
   {filters && <div className="model-picker__filters">{filters}</div>}
   <div className="model-picker__results" aria-label="Models" aria-busy={loading}>
    {(error || failure) && <p className="library-message" role="alert">{failure || error}</p>}
    {loading ? <p className="library-message" role="status">Finding available models…</p> :
     !ordered.length ? <p className="library-message">No matching models. Try another name or clear your filters.</p> :
     ordered.map((item, index) => <div key={item.id} className="model-picker__item">
      {(index === 0 || ordered[index - 1].group !== item.group || ordered[index - 1].id === selected) &&
       <div className="library-group">{item.id === selected ? "Selected model" : item.group}</div>}
      <button type="button" className="model-picker__option" aria-pressed={item.id === selected} aria-busy={busy === item.id}
       ref={node => { if (node) buttons.current.set(item.id, node); else buttons.current.delete(item.id); }}
       onClick={() => void choose(item.id)}
       onKeyDown={event => {
        const destination = event.key === "ArrowDown" ? index + 1 : event.key === "ArrowUp" ? index - 1 : event.key === "Home" ? 0 : event.key === "End" ? ordered.length - 1 : null;
        if (destination !== null) { event.preventDefault(); focus(destination); }
       }}>
       <span><strong>{item.name}</strong><small>{item.summary || item.group}</small></span>
       {busy === item.id ? <small>Loading…</small> : item.id === selected ? <Check size={18} aria-label="Selected"/> : null}
      </button>
      {item.details && <details className="model-picker__details"><summary>Model details</summary>{item.details}</details>}
     </div>)}
   </div>
   {notice && <details className="model-picker__notice"><summary>Models that run on this device</summary>{notice}</details>}
   <div className="model-picker__hint" role="status">↑ ↓ to browse · Enter to choose · Esc to close</div>
  </div>
 </dialog>;
}
