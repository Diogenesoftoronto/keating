import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import * as Kit from "./kit";

const meta = {
  title: "Design System/Kit",
  parameters: { layout: "padded", docs: { story: { inline: false } } },
} satisfies Meta;
export default meta;

function Workshop({ dark }: { dark: boolean }) {
  const [filter, setFilter] = useState("all");
  const [panel, setPanel] = useState("reading");
  const [query, setQuery] = useState("");
  const [pinned, setPinned] = useState(false);
  const [sheet, setSheet] = useState(false);
  useEffect(() => {
    const root = document.documentElement;
    const priorDark = root.classList.contains("dark");
    const priorTheme = localStorage.getItem("theme");
    root.classList.toggle("dark", dark);
    return () => {
      root.classList.toggle("dark", priorDark);
      if (priorTheme === null) localStorage.removeItem("theme");
      else localStorage.setItem("theme", priorTheme);
    };
  }, [dark]);
  return <main style={{ display: "grid", gap: ".6rem", background: "var(--paper)", color: "var(--ink)" }}>
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Literata:ital,wght@0,400;0,600;0,700;1,400&display=swap"/>
    <Kit.AppBar title="Reading workshop" subtitle="Course workspace" menu={false}>
      <Kit.IconButton glyph="book" label="Pin reading" pressed={pinned} onClick={() => setPinned(!pinned)}/>
      <Kit.AppMenu/>
    </Kit.AppBar>
    <Kit.SubBar>
      <Kit.SearchField data-grow label="Search readings" placeholder="Search readings" value={query} onChange={setQuery} shortcut="/"/>
      <Kit.Menu label="Reading actions" trigger={<Kit.Button>Actions</Kit.Button>} items={[
        { id: "edit", label: "Edit note", onSelect: () => setSheet(true) },
        "separator",
        { id: "archive", label: "Archive", disabled: true, onSelect: () => {} },
        { id: "pin", label: "Pin reading", onSelect: () => setPinned(true) },
      ]}/>
    </Kit.SubBar>
    <Kit.Card tone="hard">
      <Kit.Eyebrow>Assigned reading</Kit.Eyebrow>
      <Kit.Segmented label="Readings" value={filter} onChange={setFilter} options={[
        { value: "all", label: "All" }, { value: "saved", label: "Saved", hint: "Readings you pinned." },
      ]}/>
      <Kit.Tabs label="Workshop" value={panel} onChange={setPanel} items={[
        { id: "reading", label: "Reading", glyph: "book" }, { id: "notes", label: "Notes", count: 2 },
        { id: "group", label: "Group" },
      ]}/>
      <Kit.TabPanel id="reading" active={panel === "reading"}>
        <Kit.Prose><p>Read the opening paragraph aloud. Where does the narrator pause?</p></Kit.Prose>
        <Kit.ButtonLink href="#reading">Return to passage</Kit.ButtonLink>
      </Kit.TabPanel>
      <Kit.TabPanel id="notes" active={panel === "notes"}><Kit.Note>Mark the sentence where the pacing changes.</Kit.Note></Kit.TabPanel>
      <Kit.TabPanel id="group" active={panel === "group"}><Kit.AvatarStack names={["Ada", "Lee", "Sam"]}/></Kit.TabPanel>
      <div><Kit.Avatar name="Ada"/> <Kit.StatusDot tone="ok" label="Available"/> Ada</div>
      <Kit.DefinitionList items={[{ term: "Progress", detail: "2 of 3 passages" }]}/>
      <Kit.Meter value={2} max={3} label="Passages read"/>
      <div><Kit.Chip as="button" selected={pinned} onClick={() => setPinned(!pinned)}>Pinned</Kit.Chip></div>
      <Kit.Note>Use <Kit.Kbd>←</Kit.Kbd> and <Kit.Kbd>→</Kit.Kbd> to switch tabs.</Kit.Note>
      <div><Kit.Button size="sm" variant="accent" onClick={() => setSheet(true)}>Add note</Kit.Button> <Kit.Button busy>Saving</Kit.Button></div>
    </Kit.Card>
    <Kit.Sheet open={sheet} onClose={() => setSheet(false)} title="Reading note" description="Record a passage to discuss."
      footer={<Kit.Button onClick={() => setSheet(false)}>Done</Kit.Button>}>
      <Kit.Field label="Passage"><Kit.TextInput/></Kit.Field>
      <Kit.Field label="Note"><Kit.TextArea/></Kit.Field>
    </Kit.Sheet>
  </main>;
}

export const Light: StoryObj<typeof meta> = { render: () => <Workshop dark={false}/> };
export const Dark: StoryObj<typeof meta> = { render: () => <Workshop dark/> };
