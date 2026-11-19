import { useEffect, useRef, useState } from "react";
import { KeatingGlyph } from "../design-system/glyphs";
import { DownloadPdfButton } from "./DownloadPdfButton";
import "../pages/public-pages.css";
import "../pages/legal-document.css";

type Topics = ReadonlyArray<readonly [id: string, label: string]>;

interface LegalDocumentHeaderProps {
  title: string;
  updated: string;
  glyph: "book" | "lock";
  topics: Topics;
}

export function LegalDocumentHeader({ title, updated, glyph, topics }: LegalDocumentHeaderProps) {
  const privacy = glyph === "lock";
  return (
    <header className="legal-cover">
      <div className="legal-cover-copy public-enter">
        <h1>{title}</h1>
        <div className="legal-cover-meta">
          <p className="legal-updated">Last updated: <span className="legal-date">{updated}</span></p>
          <DownloadPdfButton label={title} />
        </div>
      </div>
      <div className="legal-cover-art print-hidden" aria-hidden="true">
        {privacy ? (
          <div className="legal-envelope">
            <div className="legal-letter public-texture-paper" />
            <div className="legal-pocket public-texture-marble"><span><KeatingGlyph name="lock" size={23} /></span></div>
          </div>
        ) : (
          <div className="legal-book public-texture-marble">
            <div className="legal-book-spine" />
            <div className="legal-book-label"><KeatingGlyph name="book" size={30} /><i /></div>
          </div>
        )}
      </div>
      <nav className="legal-topics print-hidden" aria-label="Jump to a topic">
        {topics.map(([id, label]) => (
          <a key={id} href={`#${id}`}>{label}<KeatingGlyph name="down" size={14} /></a>
        ))}
      </nav>
    </header>
  );
}

export function LegalContents({ sections }: { sections: Topics }) {
  const [current, setCurrent] = useState(sections[0][0]);
  const disclosure = useRef<HTMLDetailsElement>(null);
  const sidebar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const targets = sections.map(([id]) => document.getElementById(id)).filter((el) => el !== null);
    let frame = 0;
    const update = () => {
      frame = 0;
      const line = Math.min(window.innerHeight * 0.35, 190);
      let active = targets[0];
      for (const section of targets) {
        if (section.getBoundingClientRect().top > line) break;
        active = section;
      }
      // A short final section can meet the footer before it reaches the reading line.
      if (window.scrollY > 0 && window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 1) {
        active = targets[targets.length - 1];
      }
      if (active) setCurrent(active.id);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
    update();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [sections]);

  useEffect(() => {
    const list = sidebar.current?.querySelector("ol");
    const active = list?.querySelector('[aria-current="location"]');
    if (!list || !active || !list.clientHeight) return;
    const viewport = list.getBoundingClientRect();
    const row = active.getBoundingClientRect();
    if (row.top < viewport.top) list.scrollTop += row.top - viewport.top;
    if (row.bottom > viewport.bottom) list.scrollTop += row.bottom - viewport.bottom;
  }, [current]);

  const list = (
    <ol className="legal-index-list">
      {sections.map(([id, label]) => (
        <li key={id}>
          <a href={`#${id}`} aria-current={current === id ? "location" : undefined}
            onClick={() => { if (disclosure.current) disclosure.current.open = false; }}>
            {label}
          </a>
        </li>
      ))}
    </ol>
  );
  return (
    <nav className="legal-index print-hidden" aria-label="Document contents">
      <div className="legal-index-desktop" ref={sidebar}>
        <h2 className="k-halftone k-green"><KeatingGlyph name="tree" size={17} /> Contents</h2>
        {list}
      </div>
      <details className="legal-index-phone" ref={disclosure}>
        <summary className="k-halftone k-green"><KeatingGlyph name="tree" size={16} />Contents<span>{sections.find(([id]) => id === current)?.[1]}</span><KeatingGlyph name="down" size={14} /></summary>
        {list}
      </details>
    </nav>
  );
}
