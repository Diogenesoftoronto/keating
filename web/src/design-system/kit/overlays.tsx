import { cloneElement, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { appNavLinks } from "../../components/Nav";
import { ThemeToggle } from "../../components/ThemeToggle";
import { applicationRootHref, hostedNavigationHref } from "../../lib/hosted-navigation";
import { KeatingGlyph, type GlyphName } from "../glyphs";
import { Button, ButtonLink, classes, IconButton, type Native } from "./primitives";
import { moveFocus } from "./selection";

type Entry = { id: string; label: ReactNode; description?: ReactNode; glyph?: GlyphName; disabled?: boolean; onSelect(): void };
type MenuProps = Native<"div"> & { label: string; trigger: ReactElement; items: readonly (Entry | "separator")[] };
function Popup({ trigger, label, render, className, ref, ...props }: Native<"div"> & { label: string; trigger: ReactElement; render(close: ()=>void): ReactNode }) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const [open,setOpen] = useState(false);
  const last = useRef(false);
  useImperativeHandle(ref,()=>root.current!,[]);
  const triggerNode = () => root.current?.querySelector<HTMLElement>('[aria-haspopup="menu"]');
  const close = () => { setOpen(false); triggerNode()?.focus(); };
  const entries = () => Array.from(root.current?.querySelectorAll<HTMLElement>(".k-menu :is(button:not(:disabled),a[href])") ?? []);
  useLayoutEffect(()=>{
    if (!open) return;
    const options = entries();
    options[last.current ? options.length-1 : 0]?.focus();
  },[open]);
  useEffect(()=>{
    if (!open) return;
    const outside = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) { event.preventDefault(); close(); } };
    document.addEventListener("mousedown",outside);
    return ()=>document.removeEventListener("mousedown",outside);
  },[open]);
  const button = trigger as ReactElement<Native<"button">>;
  return <div {...props} ref={root} className={classes("k-popup",className)} onBlur={e=>{
    props.onBlur?.(e); if (e.relatedTarget && !e.currentTarget.contains(e.relatedTarget)) setOpen(false);
  }} onKeyDown={e => {
    props.onKeyDown?.(e);
    if (!open || e.defaultPrevented) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
    } else if (e.key === "Tab") {
      close();
    }
  }}>
    {cloneElement(button,{ "aria-haspopup":"menu","aria-expanded":open,"aria-controls":open ? id : undefined,
      onClick:e=>{button.props.onClick?.(e); if(!e.defaultPrevented){ last.current=false; setOpen(!open); }},
      onKeyDown:e=>{button.props.onKeyDown?.(e); if(!e.defaultPrevented && ["ArrowDown","ArrowUp"].includes(e.key)){e.preventDefault();last.current=e.key==="ArrowUp";setOpen(true);}}
    })}
    {open && <div id={id} className="k-menu" role="menu" aria-label={label} onKeyDown={e=>{
      moveFocus(e,entries(),true);
    }}>{render(close)}</div>}
  </div>;
}
export function Menu({ items, ...props }: MenuProps) {
  return <Popup {...props} render={close=>items.map((item,i)=>item==="separator" ? <hr role="separator" key={i}/> :
    <button role="menuitem" type="button" key={item.id} disabled={item.disabled} tabIndex={-1} onClick={()=>{close();item.onSelect();}}>
      {item.glyph && <KeatingGlyph name={item.glyph}/>}<span><b>{item.label}</b>{item.description && <small>{item.description}</small>}</span>
    </button>)}/>;
}
export function AppMenu(props: Native<"div">) {
  const hostname = typeof window === "undefined" ? "" : window.location?.hostname ?? "";
  const appOnly = import.meta.env?.KEATING_WEB_BUILD_TARGET === "app";
  const chat = appNavLinks.chat(applicationRootHref(hostname, appOnly));
  const destinations = [
    chat, appNavLinks.courses, appNavLinks.rooms,
    [appNavLinks.activity[0], "Learning activity"],
    [appNavLinks.reviews[0], "Reviews"],
    [chat[0] + "?settings=start", "Settings"],
  ];
  return <Popup {...props} trigger={<IconButton label="More" glyph="more"/>} label="More" render={close=><>
    {destinations.map(([to,label])=><a role="menuitem" tabIndex={-1} key={to} href={hostedNavigationHref(to,hostname,appOnly)} onClick={close}>{label}</a>)}
    <hr role="separator"/><div role="none" ref={node => {
      // ThemeToggle owns its button and only exposes variant and onToggled.
      const toggle = node?.querySelector("button");
      toggle?.setAttribute("role", "menuitem");
      if (toggle) toggle.tabIndex = -1;
    }}><ThemeToggle variant="menu" onToggled={close}/></div>
  </>}/>;
}
export function AppBar({ back, title, subtitle, start, children, menu = true, className, ...props }: Omit<Native<"header">,"title"> & {
  back?: { label: string; to?: string; onClick?(): void }; title: ReactNode; subtitle?: ReactNode; start?: ReactNode; menu?: boolean;
}) {
  return <header {...props} className={classes("k-top",className)}>
    {back && (back.to ? <ButtonLink to={back.to} variant="ghost" glyph="left" onClick={back.onClick}>{back.label}</ButtonLink> : <Button variant="ghost" glyph="left" onClick={back.onClick}>{back.label}</Button>)}
    {start}<div className="k-title"><b>{title}</b>{subtitle != null && <span>{subtitle}</span>}</div>
    <div className="k-actions">{children}{menu && <AppMenu/>}</div>
  </header>;
}
export function Sheet({ open, onClose, title, description, footer, side = "center", children, className, ref, onCancel, onClick, ...props }: Omit<Native<"dialog">,"title" | "onClose" | "open"> & {
  open: boolean; onClose(): void; title: ReactNode; description?: ReactNode; footer?: ReactNode; side?: "center" | "right" | "bottom";
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  useImperativeHandle(ref,()=>dialog.current!,[]);
  useLayoutEffect(()=>{
    const node = dialog.current;
    if (!open || !node) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    node.showModal();
    node.focus();
    return ()=>{node.close();previous?.focus();};
  },[open]);
  return <dialog {...props} ref={dialog} tabIndex={-1} className={classes("k-sheet","k-"+side,className)} aria-labelledby={id} aria-describedby={description != null ? id+"-desc" : props["aria-describedby"]}
    onCancel={e=>{onCancel?.(e);if(!e.defaultPrevented){e.preventDefault();onClose();}}}
    onClick={e=>{onClick?.(e);if(e.defaultPrevented || e.target !== e.currentTarget) return;
      const bounds=e.currentTarget.getBoundingClientRect();
      if(e.clientX<bounds.left || e.clientX>bounds.right || e.clientY<bounds.top || e.clientY>bounds.bottom) onClose();
    }}>
    <header><h2 id={id}>{title}</h2><IconButton label="Close" glyph="x" onClick={onClose}/></header>
    {description != null && <p id={id+"-desc"}>{description}</p>}<div className="k-sheet-body">{children}</div>{footer != null && <footer>{footer}</footer>}
  </dialog>;
}
