# Keating glyphs

Import `KeatingGlyph`, `GlyphName`, and `playGlyph` from `@/design-system/glyphs`.

```tsx
<button data-glyph-surface="inverse"><KeatingGlyph name="send" />Send</button>
```

`name` selects the drawing. Change it at any time, including during playback.
`size` sets width and height in pixels (15 by default). `strokeWidth` overrides
the size-specific weight. `className` styles the SVG. Add `label` for a named
image. Omit it when the control already supplies an accessible name.

Hover, focus-visible, and press follow the closest button, link, summary, tab,
menuitem, option, or `[data-glyph-host]`. A standalone glyph hosts itself.
`active` or a host with aria-selected, aria-current, or aria-pressed set to
true keeps the accent lit. Put `data-glyph-surface="inverse"` on a dark surface
to use phosphor green. Both OS and learner reduced-motion settings apply.

Call `playGlyph(svgElement)` on the mounted SVG for one-shot feedback, e.g.
after changing a copy glyph to check. Import shared springs, easing, durations,
and motion preference helpers from `@/design-system/motion`.

| Group | Names |
| --- | --- |
| Direction | left, right, down, send, chev, chevr, ext |
| Basics | plus, x, check, more, menu, search, filter, refresh |
| Chat | clip, mic, wave, copy, quote, up, dn, fork, bulb, book, layers, panel, panelr, play |
| Review | pen, edit, feather, ruler, compass, pattern, route, eye, lock, save, export, trash |
| Status and mark | shield, alert, kmark |
