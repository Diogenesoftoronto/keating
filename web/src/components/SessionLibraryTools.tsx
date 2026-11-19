import { useMemo, useState, type Ref } from "react";
import { Chip, Kbd } from "../design-system/kit";
import { KeatingGlyph } from "../design-system/glyphs";
import type { UseSessionsResult } from "../hooks/use-sessions";
import type { SessionMetadata } from "../types/session";
import { categorize, type CategoryKey, type CategoryMeta } from "./session-card-visuals";
import { useSessionLibrarySections } from "./use-session-library-sections";

export function shortSubject(subject: CategoryMeta) {
  return subject.key === "cs" ? "CS" : subject.label;
}

export function countSessionSubjects(items: SessionMetadata[]) {
  const counts = new Map<CategoryKey, { subject: CategoryMeta; count: number }>();
  for (const session of items) {
    const subject = categorize(session.title);
    const entry = counts.get(subject.key);
    if (entry) entry.count++;
    else counts.set(subject.key, { subject, count: 1 });
  }
  return Array.from(counts.values()).sort((a, b) => a.subject.label.localeCompare(b.subject.label));
}

export function sessionsInSubject(store: Pick<UseSessionsResult, "flatResults" | "items">, subject: CategoryKey | null) {
  return subject === null ? store.flatResults
    : (store.flatResults ?? store.items).filter(session => categorize(session.title).key === subject);
}

export function useSubjectLibrary(store: UseSessionsResult, activeSessionId?: string) {
  const [selection, select] = useState<CategoryKey | null>(null);
  const subjects = useMemo(() => countSessionSubjects(store.items), [store.items]);
  const subject = subjects.some(entry => entry.subject.key === selection) ? selection : null;
  const flatResults = useMemo(() => sessionsInSubject(store, subject), [store.flatResults, store.items, subject]);
  const library = useSessionLibrarySections({ ...store, flatResults }, activeSessionId);
  return {
    ...library,
    searching: library.searching || subject !== null,
    subjects, subject, select,
    resetFilters: () => { select(null); store.setQuery(""); },
  };
}

type SubjectControls = Pick<ReturnType<typeof useSubjectLibrary>, "subjects" | "subject" | "select">;
export function SessionSubjectChips({ library, total }: { library: SubjectControls; total: number }) {
  if (!total) return null;
  return <div className="session-subjects" role="group" aria-label="Filter sessions by subject">
    <Chip as="button" count={total} selected={library.subject === null} onClick={() => library.select(null)}>All</Chip>
    {library.subjects.map(({ subject, count }) =>
      <Chip as="button" key={subject.key} title={subject.label} count={count} selected={library.subject === subject.key} onClick={() => library.select(subject.key)}>
        <span className="session-entry__category-dot" style={{ background: subject.accent }} aria-hidden="true" />
        {shortSubject(subject)}
      </Chip>)}
  </div>;
}

export function SessionSearch({ store, desktop, inputRef }: {
  store: Pick<UseSessionsResult, "query" | "setQuery">;
  desktop?: boolean;
  inputRef?: Ref<HTMLInputElement>;
}) {
  return <div className={desktop ? "session-panel__search" : "session-library__search"} data-glyph-host>
    <KeatingGlyph name="search" size={18} />
    <input ref={inputRef} type="search" aria-label="Search sessions" placeholder="Find a session"
      aria-keyshortcuts={desktop ? "/" : undefined} value={store.query} onChange={event => store.setQuery(event.target.value)} />
    {desktop && (store.query
      ? <button type="button" className="session-panel__icon k-bloom" aria-label="Clear search" title="Clear search" onClick={() => store.setQuery("")}><KeatingGlyph name="x" size={18}/></button>
      : <Kbd aria-hidden="true">/</Kbd>)}
  </div>;
}

export function SessionLibraryEmpty({ desktop, filtering, resetFilters }: { desktop?: boolean; filtering: boolean; resetFilters: () => void }) {
  return <div className={desktop ? "session-panel__empty" : "session-library__empty"}>
    <KeatingGlyph name={filtering ? "search" : "fork"} size={28} />
    <h3>{filtering ? "No sessions found" : "A place to pick up again"}</h3>
    <p>{filtering ? "Try another subject, word or phrase." : "Your conversations and their forks will live here."}</p>
    {filtering && <button type="button" onClick={resetFilters}>Clear filters</button>}
  </div>;
}
