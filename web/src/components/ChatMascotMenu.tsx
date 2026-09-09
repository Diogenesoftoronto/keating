import { useComposerRuntime } from "@assistant-ui/react";
import { createPortal } from "react-dom";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { KeatingBot, type KeatingBotState } from "./KeatingBot";

const STUDY_CHOICES = [
  ["Explain another way", "Explain the current topic another way, with a concrete example."],
  ["Quiz me", "Quiz me on the current topic, one question at a time."],
  ["Make flashcards", "Make flashcards to help me review the current topic."],
] as const;

export function ChatMascotMenu({ state, busy }: { state: KeatingBotState; busy: boolean }) {
  const composer = useComposerRuntime();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [open, setOpen] = useState(false);
  const [gesture, setGesture] = useState<"waving" | "flipping" | null>(null);
  const [position, setPosition] = useState({ left: 8, bottom: 8 });
  useEffect(() => {
    if (!gesture) return;
    const timer = window.setTimeout(() => setGesture(null), gesture === "flipping" ? 1400 : 3200);
    return () => window.clearTimeout(timer);
  }, [gesture]);
  useEffect(() => { if (busy) setGesture(null); }, [busy]);
  useLayoutEffect(() => {
    if (!open) return;
    const positionMenu = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (rect) setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - 248)), bottom: Math.max(8, Math.min(window.innerHeight - rect.top + 6, window.innerHeight - Math.min(menu.current?.scrollHeight ?? 300, window.innerHeight - 24) - 8)) });
    };
    positionMenu();
    menu.current?.querySelector<HTMLButtonElement>("button")?.focus();
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    return () => { window.removeEventListener("resize", positionMenu); window.removeEventListener("scroll", positionMenu, true); };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!menu.current?.contains(event.target as Node) && !trigger.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  const addDraft = (prompt: string) => {
    const draft = composer.getState().text;
    composer.setText(draft.trim() ? `${draft}\n\n${prompt}` : prompt);
    close();
    trigger.current?.closest(".chat-mascot-perch")?.nextElementSibling?.querySelector<HTMLTextAreaElement>("textarea")?.focus();
  };
  const displayedState = busy ? state : gesture ?? state;
  return <div className="chat-mascot-perch">
    <button ref={trigger} type="button" className="chat-mascot-perch__bot" aria-label="Study with Keating" title="Study with Keating" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined} onClick={() => setOpen(value => !value)} onKeyDown={event => {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); }
    }}>
      <KeatingBot variant="body" state={displayedState} size={72} label="" />
      <span className="chat-mascot-perch__hint" aria-hidden="true">+</span>
    </button>
    {open && createPortal(<div ref={menu} id={menuId} role="menu" aria-label="Study with Keating" className="chat-mascot-menu" style={position} onBlur={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node)) setOpen(false);
    }} onKeyDown={event => {
      if (event.key === "Tab") { close(); return; }
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); return; }
      const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")];
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      const next = event.key === "ArrowDown" ? (index + 1) % items.length : event.key === "ArrowUp" ? (index - 1 + items.length) % items.length : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : -1;
      if (next >= 0) { event.preventDefault(); items[next]?.focus(); }
    }}>
      <p className="chat-mascot-menu__caption">Add to your message</p>
      {STUDY_CHOICES.map(([label, prompt]) => <button key={label} type="button" role="menuitem" onClick={() => addDraft(prompt)}>{label}</button>)}
      <div className="chat-mascot-menu__divider" role="separator" />
      <button type="button" role="menuitem" disabled={busy} onClick={() => { setGesture("waving"); close(); }}>Give me a wave</button>
      <button type="button" role="menuitem" disabled={busy} onClick={() => { setGesture("flipping"); close(); }}>Do a flip</button>
    </div>, document.body)}
  </div>;
}
