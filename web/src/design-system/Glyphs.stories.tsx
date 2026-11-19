import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState, type CSSProperties } from "react";
import { GLYPHS, GROUPS, KeatingGlyph, LABELS } from "./glyphs";

const meta = { title: "Design System/Glyphs", parameters: { layout: "padded" } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
const control: CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: "0.38rem", padding: "0.38rem 0.58rem",
  border: "1px solid var(--line)", borderRadius: "0.19rem", background: "var(--card)", color: "var(--ink)",
};

export const AllGlyphs: Story = {
  render: () => <main>{GROUPS.map(([group, names]) => <section key={group}>
    <h2>{group}</h2>
    <ul style={{ display: "grid", gap: "0.58rem", gridTemplateColumns: "repeat(auto-fit,minmax(min(100%,10rem),1fr))" }}>
      {names.map(name => <li key={name} data-glyph-host tabIndex={0} style={{
        ...control, flexDirection: "column", alignItems: "flex-start", padding: "0.77rem",
      }}>
        <span style={{ display: "flex", alignItems: "center", gap: "0.48rem" }}>
          {[40, 15, 13].map(size => <KeatingGlyph key={size} name={name} size={size} />)}
        </span>
        <strong>{LABELS[name]}</strong>
        <span>{GLYPHS[name].note}</span>
      </li>)}
    </ul>
  </section>)}</main>,
};

function Controls() {
  const [recording, setRecording] = useState(false);
  const [tab, setTab] = useState(0);
  const tabs = [["book", "Sources"], ["layers", "Materials"]] as const;
  return <section style={{ display: "grid", gap: "0.77rem", justifyItems: "start" }}>
    <div style={{ display: "flex", gap: "0.38rem" }}>
      <button type="button" style={control} aria-pressed={recording} onClick={() => setRecording(!recording)}>
        <KeatingGlyph name="mic" />Record
      </button>
      <button type="button" style={{ ...control, background: "var(--crt)", color: "var(--phosphor)" }} data-glyph-surface="inverse">
        <KeatingGlyph name="send" />Send
      </button>
    </div>
    <div role="tablist" aria-label="Reference panels">
      {tabs.map(([glyph, label], index) => <button type="button" key={glyph} style={control}
        role="tab" id={`tab-${glyph}`} aria-controls={`panel-${glyph}`} aria-selected={index === tab}
        tabIndex={index === tab ? 0 : -1} onClick={() => setTab(index)} onKeyDown={event => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : 1 - index;
          setTab(next);
          event.currentTarget.parentElement?.querySelectorAll("button")[next]?.focus();
        }}><KeatingGlyph name={glyph} />{label}</button>)}
    </div>
    {tabs.map(([glyph, label], index) => <div key={glyph} role="tabpanel" tabIndex={0}
      id={`panel-${glyph}`} aria-labelledby={`tab-${glyph}`} hidden={tab !== index}>{label}</div>)}
  </section>;
}

export const InControls: Story = { render: () => <Controls /> };
