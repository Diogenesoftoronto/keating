# Keating web UI kit

Import these components from `@/design-system/kit`. Each accepts a root DOM ref and `className`.
Selection controls are controlled. Give each tab a document-unique ID and reuse it for its panel.

| Component | Example |
| --- | --- |
| Button | `<Button variant="accent" glyph="save" busy={saving}>Save</Button>` |
| ButtonLink | `<ButtonLink to="/courses">Courses</ButtonLink>` |
| IconButton | `<IconButton glyph="book" label="Pin reading" pressed={pinned} onClick={pin}/>` |
| Chip | `<Chip as="button" selected={saved} count={3} onClick={toggle}>Saved</Chip>` |
| Segmented | `<Segmented label="View" options={[{value:"all", label:"All", hint:"Every passage"}]} value={view} onChange={setView}/>` |
| Tabs | `<Tabs label="Workshop" items={[{id:"notes", label:"Notes"}]} value={tab} onChange={setTab}/>` |
| TabPanel | `<TabPanel id="notes" active={tab === "notes"}>{notes}</TabPanel>` |
| AppBar | `<AppBar title="Workshop" back={{label:"Courses", to:"/courses"}}/>` |
| AppMenu | `<AppMenu/>` |
| SubBar | `<SubBar><span data-grow>Week one</span><Chip>Draft</Chip></SubBar>` |
| Card | `<Card as="article" tone="hard">{lesson}</Card>` |
| Eyebrow | `<Eyebrow muted>Assigned reading</Eyebrow>` |
| Field | `<Field label="Title" hint="Use a short phrase"><TextInput/></Field>` |
| TextInput | `<TextInput aria-label="Course title" name="title"/>` |
| TextArea | `<TextArea aria-label="Reading notes" rows={3}/>` |
| SearchField | `<SearchField label="Search notes" placeholder="Search notes" value={query} onChange={setQuery}/>` |
| Avatar | `<Avatar name="Ada" size="lg"/>` |
| AvatarStack | `<AvatarStack names={["Ada", "Lee", "Sam"]} max={2}/>` |
| StatusDot | `<StatusDot tone="ok" label="Available"/>` |
| Note | `<Note tone="warn">This reading is due tomorrow.</Note>` |
| Meter | `<Meter label="Passages read" value={2} max={3}/>` |
| Kbd | `<Kbd>Esc</Kbd>` |
| Prose | `<Prose><p>{passage}</p></Prose>` |
| DefinitionList | `<DefinitionList items={[{term:"Author", detail:"Ada"}]}/>` |
| Sheet | `<Sheet open={open} onClose={close} title="Edit note">{editor}</Sheet>` |
| Menu | `<Menu label="Note actions" trigger={<Button>Actions</Button>} items={[{id:"edit", label:"Edit", onSelect:edit}]}/>` |
| Loading | `<Loading label="Loading sessions"/>` (marbled ink under a caption; `size="inline"` in a row, `size="page"` for a route) |
| EmptyState | `<EmptyState heading="No rooms yet" glyph="people" actions={<Button variant="primary">Create a room</Button>}>Rooms are where you study with other people.</EmptyState>` |

## Texture and effect classes

Rules and the owner's brief: `docs/design/2026-11-19-review-chat-mockups/src/tools/texture-rules.md`.

| Class | What it does |
| --- | --- |
| `k-bloom` | Halftone bloom behind a quiet icon button on hover or focus. `IconButton` has it built in. |
| `k-lift` | Filled or hard-edged action rises on hover and seats on press. Primary and accent `Button`s have it built in; `--k-lift-shadow` sets the shadow colour. |
| `k-halftone` | Print dots fading across a panel, rail head or hero. `k-green` for green ink; `--k-halftone-angle` points at the clear side; `--k-halftone-strength` 0 to 1. |
| `k-grid` | The 10px drawing grid, for previews, diagram stages and drop zones. |
