# Settings shell

The chat dialogs mount SettingsDialog. A native modal contains the four groups. Phone navigation starts at the outline and opens a section page. Search and explicit deep links open the matching section directly.

## Registry and links

Add a group or section in `groups.tsx`. A group has a stable id, title, glyph, search summary, currentSummary function for the phone outline, and ordered sections. A section has a unique id, title, component and aliases. Optional fields are `aside`, `available`, `anchor` (a legacy DOM id), `supplement` and `useStatus` (a hook returning short status text). Availability must reflect the same capability as the editor. Keep prior ids when renaming.

Use `/chat?settings=models.jobs`, a bare section such as `judgement`, or an older prefix such as `models-custom-providers`. Unknown routes open Models. Both window events accept `{tab, section}`, with section taking precedence. Use `keating:open-settings` outside the dialog and `keating:settings-tab` inside. String details on the latter remain supported.

## Rows

```tsx
<SettingsSection title="Motion and effects">
  <SettingRow id="effects" label="Visual effects" help="Paper grain and animated ink." scope="this device">
    <Switch labelledBy="effects-label" checked={settings.visualEffects} onChange={setEffects}/>
  </SettingRow>
  <SavedHint/>
</SettingsSection>
```

Row ids must be unique, stable and focusable. The visible label gets `id + "-label"`. Optional `why` describes a disabled control or consequence. Scopes are `this device`, `your profile`, `your account`, `this chat`, and `new chats`. Use `StatusLine` with a kit status tone and visible words. For drafts use `UnsavedBar count={count} onDiscard={discard} onSave={save}` and `useSectionStatus(sectionId, {count, save})`. Pass a stable save callback that synchronously commits to the existing store. The shell totals reported counts by group. A section reporting a draft must remain mounted while it is dirty. Discard on close unmounts the dialog. Immediate-write sections use SavedHint instead.

## Search

Each group owns a module under `search/`. Interface entries define label, help, id (DOM focus target), scope, group, section and legacy keywords. Other groups begin with section-level entries generated from the registry and keywords indexed by section id. Add row-level entries as sections split. Results match all query words across label, help, path and keywords.

## Transitional mounts

- LearningTab stays mounted after its first visit. Profile subanchors, persona, speech and recall use the original editors. The shell reads the profile save bar and persona save button for draft counts and invokes their own save actions. Replace this bridge with useSectionStatus when those editors split. Reconcile concurrent profile accessibility writes with any pending profile draft at field level.
- ModelsProvidersTab contains KnowledgeSources, ProvidersModelsTab and ProxyTab. Jobs, providers, sources, checking, offline and build point into that composite. Account mounts the existing account card (including signed-in chat sync) and the device avatar editor. ProviderConnectPanel still includes its original account card until the Models lane splits it. Unify provider/voice/image writer behavior in the owning lane.
- DiagnosticsTab mounts YourDataSection unchanged under Your data. Health and Developer tools still reach the composite. Keep the existing export lifecycle and add room transcript export to Your data in the data lane. Extracted sharing, image, reasoning, teaching and developer controls retain their existing writers.
- The existing reply typeface styling reaches chat prose. Lesson reading and review transcripts still need their surfaces to consume the preference. The shared settings store accepts serif, sans and mono.
