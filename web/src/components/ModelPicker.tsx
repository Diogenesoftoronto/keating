import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { KeatingGlyph } from "../design-system/glyphs";
import { placeAgainstAnchor } from "./trajectory/anchor-position";
import "./selection-library.css";

export interface PickerItem {
 id: string; name: string; group: string; summary?: string; details?: ReactNode;
 action?: ReactNode;
 providerStatus?: "connected" | "setup-required";
 pinnedLabel?: string;
 /** Used recently; listed under its own heading after the selection while nothing is searched. */
 recent?: boolean;
}

export function orderedPickerItems(items: PickerItem[], query: string, selected: string): PickerItem[] {
 const search = query.trim().toLowerCase();
 const matches = items.filter(item => !item.pinnedLabel &&
  (item.name + " " + item.group + " " + (item.summary ?? "") + " " + item.id).toLowerCase().includes(search));
 // Keep the provider default available while searching, without restoring items
 // already excluded by the caller's provider/capability filters.
 const rest = matches.filter(item => item.id !== selected);
 const recent = search ? [] : rest.filter(item => item.recent);
 return [...items.filter(item => item.pinnedLabel), ...matches.filter(item => item.id === selected), ...recent, ...rest.filter(item => !recent.includes(item))];
}

function pickerItemHeading(item: PickerItem, selected: string, query = ""): string {
 return item.pinnedLabel ?? (item.id === selected ? "Selected model" : item.recent && !query.trim() ? "Recently used" : item.group);
}

function ProviderSetupHelp({ id, provider }: { id: string; provider: string }) {
 const trigger = useRef<HTMLButtonElement>(null);
 const tooltip = useRef<HTMLSpanElement>(null);

 function show() {
  const anchor = trigger.current;
  const bubble = tooltip.current;
  if (!anchor || !bubble?.showPopover) return;
  bubble.showPopover();
  const { left, top } = placeAgainstAnchor(anchor.getBoundingClientRect(), {
   width: bubble.offsetWidth, height: bubble.offsetHeight,
  }, { width: document.documentElement.clientWidth, height: window.innerHeight }, { offset: 0 });
  Object.assign(bubble.style, { left: `${left}px`, top: `${top}px` });
 }

 return <div className="model-picker__setup-help" onPointerLeave={event => {
  if (event.pointerType === "mouse" && !trigger.current?.matches(":focus-visible")) tooltip.current?.hidePopover?.();
 }}>
  <button ref={trigger} type="button" className="model-picker__setup-trigger" aria-label={`${provider} setup help`} aria-describedby={id}
   onPointerEnter={event => { if (event.pointerType === "mouse") show(); }}
   onFocus={event => { if (event.currentTarget.matches(":focus-visible")) show(); }}
   onBlur={() => tooltip.current?.hidePopover?.()} onClick={show}>
   <KeatingGlyph name="help" size={17} />
  </button>
  <span ref={tooltip} id={id} popover="auto" role="tooltip" className="model-picker__setup-tooltip">
   Connect {provider} to use this model. Choose the model to add a key or sign in.
  </span>
 </div>;
}

export function ModelPicker({ open, label, items, selected, onSelect, onClose, filters, controls, notice, noticeLabel = "Models that run on this device", loading = false, error = "", errorAction }: {
 open: boolean; label: string; items: PickerItem[]; selected: string;
 onSelect: (id: string) => void | Promise<void>; onClose: () => void;
 filters?: ReactNode;
 /** Settings for the current choice (the chat's thinking level), shown above the list so they are not missed. */
 controls?: ReactNode;
 notice?: ReactNode; noticeLabel?: string; loading?: boolean; error?: string; errorAction?: ReactNode;
}) {
 const dialog = useRef<HTMLDialogElement>(null);
 const setupId = useId();
 const searchRef = useRef<HTMLInputElement>(null);
 const buttons = useRef(new Map<string, HTMLButtonElement>());
 const [query, setQuery] = useState("");
 const [busy, setBusy] = useState("");
 const [failure, setFailure] = useState("");
 useEffect(() => {
  if (!open) { dialog.current?.close(); return; }
  const previous = document.activeElement as HTMLElement | null;
  setQuery(""); setFailure("");
  const picker = dialog.current;
  const dismissSetupHelp = () => {
   if (typeof HTMLElement.prototype.hidePopover === "function") {
    picker?.querySelector<HTMLElement>(".model-picker__setup-tooltip:popover-open")?.hidePopover();
   }
  };
  picker?.showModal();
  searchRef.current?.focus();
  window.addEventListener("resize", dismissSetupHelp);
  picker?.addEventListener("scroll", dismissSetupHelp, true);
  return () => {
   window.removeEventListener("resize", dismissSetupHelp);
   picker?.removeEventListener("scroll", dismissSetupHelp, true);
   dismissSetupHelp();
   picker?.close();
   previous?.focus();
  };
 }, [open]);
 const ordered = orderedPickerItems(items, query, selected);
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
    <label className="library-search"><KeatingGlyph name="search" size={18} />
     <input ref={searchRef} aria-label={label} placeholder={label} value={query} onChange={event => setQuery(event.target.value)}
      onKeyDown={event => { if (event.key === "ArrowDown" && ordered.length) { event.preventDefault(); focus(0); } }} />
    </label>
    <button type="button" className="library-icon" aria-label="Close model picker" onClick={onClose}><KeatingGlyph name="x" size={18}/></button>
   </div>
   {controls && <div className="model-picker__controls">{controls}</div>}
   {filters && <div className="model-picker__filters">{filters}</div>}
   <div className="model-picker__results" aria-label="Models" aria-busy={loading}>
    {(error || failure) && <>
     <p className="library-message" role="alert">{failure || error}</p>
     {errorAction && <div className="model-picker__error-action">{errorAction}</div>}
    </>}
    {loading ? <p className="library-message" role="status">Finding available models…</p> :
     !ordered.length ? <p className="library-message">No matching models. Try another name or clear your filters.</p> :
     ordered.map((item, index) => <div key={item.id} className="model-picker__item">
      {(index === 0 || pickerItemHeading(ordered[index - 1], selected, query) !== pickerItemHeading(item, selected, query)) &&
       <div className="library-group">{pickerItemHeading(item, selected, query)}</div>}
      <div className="model-picker__row" data-provider-status={item.providerStatus}>
       <button type="button" className="model-picker__option" aria-pressed={item.id === selected} aria-busy={busy === item.id}
       aria-describedby={item.providerStatus === "setup-required" ? `${setupId}-${index}` : undefined}
       ref={node => { if (node) buttons.current.set(item.id, node); else buttons.current.delete(item.id); }}
       onClick={() => void choose(item.id)}
       onKeyDown={event => {
        const destination = event.key === "ArrowDown" ? index + 1 : event.key === "ArrowUp" ? index - 1 : event.key === "Home" ? 0 : event.key === "End" ? ordered.length - 1 : null;
        if (destination !== null) { event.preventDefault(); focus(destination); }
       }}>
       <span><strong>{item.name}</strong><small>{item.summary || item.group}</small></span>
       {busy === item.id ? <small>Loading…</small> : item.id === selected ? <KeatingGlyph name="check" size={18} label="Selected"/> : null}
       </button>
       {item.providerStatus === "setup-required" && <ProviderSetupHelp id={`${setupId}-${index}`} provider={item.group} />}
      </div>
      {item.details && <details className="model-picker__details"><summary>Model details</summary>{item.details}</details>}
      {item.action && <div className="model-picker__item-action">{item.action}</div>}
     </div>)}
   </div>
   {notice && <details className="model-picker__notice"><summary>{noticeLabel}</summary>{notice}</details>}
   <div className="model-picker__hint" role="status"><KeatingGlyph name="rise" size={13} label="Up arrow" /> <KeatingGlyph name="down" size={13} label="Down arrow" /> to browse · Enter to choose · Esc to close</div>
  </div>
 </dialog>;
}
