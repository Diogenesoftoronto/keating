import { cloneElement, Fragment, isValidElement, useId, useState, type ComponentPropsWithRef, type ElementType, type ReactElement, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { KeatingGlyph, type GlyphName } from "../glyphs";
import { ShaderSurface } from "../shaders";
export { Meter } from "../charts/Meter";

export type Native<T extends ElementType> = ComponentPropsWithRef<T>;
export const classes = (...parts: (string | false | undefined)[]) => parts.filter(Boolean).join(" ");
type ButtonLook = { variant?: "outline" | "primary" | "accent" | "ghost" | "line"; size?: "sm" | "md"; busy?: boolean; glyph?: GlyphName };
const buttonClass = (variant = "outline", size = "md", custom?: string) => classes("k-button", "k-"+variant, "k-"+size, custom);

export function Button({ variant, size, busy, glyph, children, className, type = "button", disabled, ...props }: Native<"button"> & ButtonLook) {
  return <button {...props} type={type} className={buttonClass(variant,size,className)} disabled={busy || disabled} aria-busy={busy} data-glyph-surface={variant === "primary" ? "inverse" : undefined}>
    {glyph && <KeatingGlyph name={glyph}/>}<span>{children}</span>
  </button>;
}
export function ButtonLink({ variant, size, busy, glyph, children, className, to, href, ...props }: Native<"a"> & ButtonLook & { to?: string }) {
  const attrs = { ...props, className: buttonClass(variant,size,className), "aria-busy": busy, "aria-disabled": busy, "data-glyph-surface": variant === "primary" ? "inverse" : undefined };
  const content = <>{glyph && <KeatingGlyph name={glyph}/>}<span>{children}</span></>;
  if (busy) return <a {...attrs} role="link" tabIndex={-1} onClick={event => event.preventDefault()}>{content}</a>;
  return to ? <Link {...attrs} to={to}>{content}</Link> : <a {...attrs} href={href}>{content}</a>;
}
export function IconButton({ label, glyph, size = "md", bordered, pressed, className, type = "button", ...props }: Native<"button"> & { label: string; glyph: GlyphName; size?: "sm" | "md"; bordered?: boolean; pressed?: boolean }) {
  return <button {...props} type={type} aria-label={label} title={label} aria-pressed={pressed} className={classes("k-icon", "k-"+size, bordered && "k-bordered", className)}><KeatingGlyph name={glyph}/></button>;
}
type ChipLook = { selected?: boolean; count?: number | string; tone?: "neutral" | "inverse" };
export function Chip({ as, selected, tone, count, children, className, ...props }: ChipLook & ((Native<"span"> & { as?: "span" }) | (Native<"button"> & { as: "button" }))) {
  const content = <>{children}{count != null && <b>{count}</b>}</>;
  const style = classes("k-chip",(selected || tone === "inverse") && "k-inverse",className);
  return as === "button" ? <button type="button" {...props as Native<"button">} className={style} aria-pressed={selected}>{content}</button> : <span {...props as Native<"span">} className={style}>{content}</span>;
}
export function Card<T extends ElementType = "div">({ as, tone = "plain", className, ...props }: { as?: T; tone?: "plain" | "hard" | "dashed" | "wash"; className?: string } & Omit<Native<T>, "as" | "tone" | "className">) {
  const Root: ElementType = as ?? "div";
  return <Root {...props} className={classes("k-card","k-"+tone,className)}/>;
}
export function Eyebrow({ muted, className, ...props }: Native<"span"> & { muted?: boolean }) {
  return <span {...props} className={classes("k-eyebrow",muted && "k-muted",className)}/>;
}
export function Field({ label, hint, error, htmlFor, children, className, ...props }: Native<"div"> & { label: ReactNode; hint?: ReactNode; error?: ReactNode; htmlFor?: string }) {
  const uid = useId();
  const child = isValidElement(children) ? children as ReactElement<Native<"input">> : undefined;
  const id = htmlFor ?? child?.props.id ?? uid;
  const describedBy = classes(child?.props["aria-describedby"], hint != null && uid+"-hint", error != null && uid+"-error");
  return <div {...props} className={classes("k-field",className)}><label htmlFor={id}>{label}</label>
    {child ? cloneElement(child,{ id, "aria-invalid": error != null || child.props["aria-invalid"], "aria-describedby": describedBy || undefined }) : children}
    {hint != null && <small id={uid+"-hint"}>{hint}</small>}{error != null && <small role="alert" id={uid+"-error"}>{error}</small>}
  </div>;
}
export function TextInput({ className, ...props }: Native<"input">) { return <input {...props} className={classes("k-input",className)}/>; }
export function TextArea({ className, ...props }: Native<"textarea">) { return <textarea {...props} className={classes("k-input",className)}/>; }
export function SearchField({ value, onChange, placeholder, label, shortcut, className, ...props }: Omit<Native<"label">,"onChange"> & { value: string; onChange(value: string): void; placeholder?: string; label: string; shortcut?: string }) {
  return <label {...props} className={classes("k-find",className)}><KeatingGlyph name="search"/><input type="search" aria-label={label} placeholder={placeholder} value={value} onChange={e=>onChange(e.currentTarget.value)}/>{shortcut && <Kbd>{shortcut}</Kbd>}</label>;
}
export function Avatar({ name, size = "md", src, className, ...props }: Native<"span"> & { name: string; size?: "sm" | "md" | "lg" | "xl"; src?: string }) {
  const [failed,setFailed] = useState<string>();
  return <span {...props} className={classes("k-avatar","k-"+size,className)} role="img" aria-label={name} title={name}>
    {src && src !== failed ? <img src={src} alt="" onError={()=>setFailed(src)}/> : Array.from(name.trim())[0]?.toLocaleUpperCase()}
  </span>;
}
export function AvatarStack({ names, max = 3, className, ...props }: Native<"span"> & { names: string[]; max?: number }) {
  const shown = names.slice(0,Math.max(0,max));
  return <span {...props} className={classes("k-stack",className)}>{shown.map((name,i)=><Avatar name={name} key={i}/>)}{names.length>shown.length && <span title={names.slice(shown.length).join(", ")}>+{names.length-shown.length}</span>}</span>;
}
export function StatusDot({ tone, label, className, ...props }: Native<"span"> & { tone: "ok" | "warn" | "idle" | "bad"; label?: string }) {
  return <span {...props} className={classes("k-dot","k-"+tone,className)}>{label && <span className="k-sr">{label}</span>}</span>;
}
export function Note({ glyph, tone = "info", className, children, ...props }: Native<"div"> & { glyph?: GlyphName; tone?: "info" | "warn" }) {
  return <div {...props} className={classes("k-note","k-"+tone,className)}><KeatingGlyph name={glyph ?? (tone === "warn" ? "alert" : "bulb")}/><div>{children}</div></div>;
}
export function Kbd({ className, ...props }: Native<"kbd">) { return <kbd {...props} className={classes("k-kbd",className)}/>; }
export function Prose({ className, ...props }: Native<"div">) { return <div {...props} className={classes("k-prose",className)}/>; }
export function SubBar({ className, ...props }: Native<"div">) { return <div {...props} className={classes("k-sub",className)}/>; }
export function DefinitionList({ items, className, ...props }: Native<"dl"> & { items: { term: ReactNode; detail: ReactNode }[] }) {
  return <dl {...props} className={classes("k-dlist",className)}>{items.map(({term,detail},i)=><Fragment key={i}><dt>{term}</dt><dd>{detail}</dd></Fragment>)}</dl>;
}
/** Anything that is waiting: marbled ink under a caption. `inline` sits in a row, `page` fills a route. */
export function Loading({ label = "Loading", size = "block", className, ...props }: Native<"div"> & { label?: string; size?: "block" | "inline" | "page" }) {
  return <div {...props} role="status" className={classes("k-busy", "k-busy-"+size, className)}>{size !== "inline" && <ShaderSurface effect="ink"/>}<span className="k-busy-label"><span className="k-busy-dots" aria-hidden="true"><i/><i/><i/></span>{label}</span></div>;
}
/** Nothing here yet: the study-object field (it follows the pointer) under a title, one sentence and the next action. */
export function EmptyState({ heading, glyph, children, actions, className, ...props }: Native<"div"> & { heading: ReactNode; glyph?: GlyphName; actions?: ReactNode }) {
  return <div {...props} className={classes("k-empty", className)} data-glyph-host><ShaderSurface effect="field"/>{glyph && <KeatingGlyph name={glyph} size={20}/>}<b>{heading}</b>{children && <p>{children}</p>}{actions && <div className="k-empty-actions">{actions}</div>}</div>;
}
