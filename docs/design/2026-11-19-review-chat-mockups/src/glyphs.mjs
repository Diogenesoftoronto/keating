// Keating glyphs: one source for the drawings and their motion.
//
// Grammar
//   - 24 x 24 grid, 3 units of clear space, drawn with strokes only.
//   - Every segment runs at 0, 45 or 90 degrees. Corners are chamfered, never
//     rounded, so a lens, a bulb and a badge are all octagons.
//   - Butt caps and mitre joins.
//   - Each glyph has one accent part (class "a" for a stroke, "af" for a filled
//     pixel). It is drawn in the text colour at rest and lights up on hover,
//     focus, press, or while its control is selected.
//
// Motion (values are in grid units; times in seconds)
//   play  one shot when the pointer arrives
//   hold  a pose kept while hovered, released with a spring
//   loop  repeats while hovered
//   press plays on press
// Each entry is [parts, keyframes, options]. `parts` names data-p values.
// `stagger` and `start` in options become Motion's stagger(stagger, { startDelay: start }).

const px = (x, y, w = 2, h = 2, p = "px") => `<rect class="af" data-p="${p}" x="${x}" y="${y}" width="${w}" height="${h}"/>`;
const oct = `M8 3h8l5 5v8l-5 5H8l-5-5V8z`;
const dot = (x, y, w = 2, h = 2, p) => `<rect class="f"${p ? ` data-p="${p}"` : ""} x="${x}" y="${y}" width="${w}" height="${h}"/>`;
const slash = `<path class="a" data-p="sl" d="M4 4l16 16"/>`;
const speaker = `<path d="M4 9h4l5-5v16l-5-5H4z"/>`;
const thumb = `<g data-p="g" style="transform-origin:10% 90%"><path class="a" d="M4 11h3v9H4z"/><path d="M7 11l3-3V4h3v5h7v9l-2 2H7"/></g>`;

export const GLYPHS = {
  // ── direction ──
  left: { d: `<path data-p="s" d="M17 12H6"/><path data-p="h" d="M11 6l-6 6 6 6"/>${px(19, 11)}`,
    play: [["h,s", { x: [0, -3, 0] }], ["px", { x: [0, 3, 0], opacity: [1, 0, 1] }]], note: "Leans toward its target; the tail pixel lags behind." },
  right: { d: `<path data-p="s" d="M7 12h11"/><path data-p="h" d="M13 6l6 6-6 6"/>${px(3, 11)}`,
    play: [["h,s", { x: [0, 3, 0] }], ["px", { x: [0, -3, 0], opacity: [1, 0, 1] }]], note: "Leans toward its target; the tail pixel lags behind." },
  down: { d: `<path data-p="s" d="M12 7v11"/><path data-p="h" d="M6 13l6 6 6-6"/>${px(11, 3)}`,
    play: [["h,s", { y: [0, 3, 0] }], ["px", { y: [0, -3, 0], opacity: [1, 0, 1] }]], note: "Drops and returns." },
  rise: { d: `<path data-p="s" d="M12 17V6"/><path data-p="h" d="M6 11l6-6 6 6"/>${px(11, 19)}`,
    play: [["h,s", { y: [0, -3, 0] }], ["px", { y: [0, 3, 0], opacity: [1, 0, 1] }]], note: "Rises and returns." },
  send: { d: `<path data-p="s" d="M12 17V6"/><path data-p="h" d="M6 11l6-6 6 6"/>${px(11, 19)}`,
    hold: [["h,s", { y: -2 }], ["px", { y: 1, scaleY: 2 }]],
    press: [["h,s,px", { y: [-2, -18], opacity: [1, 0] }, { duration: 0.16, ease: "easeIn" }], ["h,s,px", { y: [12, 0], opacity: [0, 1] }, { duration: 0.32, at: 0.2 }]],
    note: "Rises on hover and stretches its exhaust; on press it launches and a new one arrives." },
  chev: { d: `<path data-p="c" d="M6 9l6 6 6-6"/>`, play: [["c", { y: [0, 2.5, 0] }]], note: "One small nod." },
  chevr: { d: `<path data-p="c" d="M9 6l6 6-6 6"/>`, play: [["c", { x: [0, 2.5, 0] }]], note: "One small nod." },
  ext: { d: `<path d="M11 5H5v14h14v-6"/><g data-p="ar"><path class="a" d="M14 4h6v6"/><path class="a" d="M20 4l-9 9"/></g>`,
    play: [["ar", { x: [0, 2.5, 0], y: [0, -2.5, 0] }]], note: "The arrow leaves the frame and comes back." },
  // ── basics ──
  plus: { d: `<g data-p="g"><path d="M12 5v14"/><path d="M5 12h14"/>${px(11, 11)}</g>`, hold: [["g", { rotate: 90 }]], note: "Quarter turn, held." },
  x: { d: `<g data-p="g"><path d="M6 6l12 12"/><path d="M18 6L6 18"/>${px(11, 11)}</g>`, hold: [["g", { rotate: 90 }]], note: "Quarter turn, held." },
  check: { d: `<path class="a" data-p="c" d="M4 12l5 5L20 6"/>`, play: [["c", { pathLength: [0, 1] }, { duration: 0.34 }]], note: "Draws itself in one stroke." },
  more: { d: `<rect class="f" data-p="d" x="3.5" y="10.5" width="3" height="3"/><rect class="af" data-p="d" x="10.5" y="10.5" width="3" height="3"/><rect class="f" data-p="d" x="17.5" y="10.5" width="3" height="3"/>`,
    play: [["d", { y: [0, -4, 0] }, { stagger: 0.07, duration: 0.32 }]], note: "Three pixels hop in turn." },
  menu: { d: `<path data-p="l" style="transform-origin:0% 50%" d="M4 7h16"/><path data-p="l" style="transform-origin:0% 50%" d="M4 12h16"/><path data-p="l" style="transform-origin:0% 50%" d="M4 17h9"/>${px(15, 16)}`,
    play: [["l", { scaleX: [0.3, 1] }, { stagger: 0.06, duration: 0.3 }], ["px", { opacity: [0, 1, 0, 1] }, { duration: 0.6 }]], note: "Lines type out; the cursor blinks at the end." },
  search: { d: `<g data-p="g"><path d="M8 4h5l4 4v5l-4 4H8l-4-4V8z"/><path class="a" d="M16 16l5 5"/></g>`,
    play: [["g", { x: [0, 2, -1, 0], y: [0, -2, -1, 0] }, { duration: 0.6 }]], note: "Sweeps once across the page." },
  filter: { d: `<path d="M4 8h8"/><path d="M16 8h4"/><rect class="a" data-p="k1" x="12" y="6" width="4" height="4"/><path d="M4 16h3"/><path d="M11 16h9"/><rect class="a" data-p="k2" x="7" y="14" width="4" height="4"/>`,
    hold: [["k1", { x: -2 }], ["k2", { x: 2 }]], note: "The two knobs slide apart." },
  refresh: { d: `<g data-p="g" style="transform-origin:7px 10px"><path d="M19 12v4l-3 3H8l-3-3V8l3-3h7"/><path class="a" d="M12 2l3 3-3 3"/></g>`,
    play: [["g", { rotate: [0, 360] }, { duration: 0.6, ease: [0.4, 0, 0.2, 1] }]], note: "One full turn." },
  // ── chat ──
  clip: { d: `<path data-p="c" d="M7 8v8l4 4h2l4-4V7l-3-3h-1l-3 3v8l2 2 2-2"/><path class="a" data-p="c2" d="M14 15V9"/>`,
    play: [["c", { pathLength: [0, 1] }, { duration: 0.55 }], ["c2", { pathLength: [0, 1] }, { duration: 0.2, delay: 0.5 }]], note: "Bends itself into shape." },
  mic: { d: `<path data-p="b" d="M10 4h4l1 1v7l-1 1h-4l-1-1V5z"/><path d="M6 11v2l3 3h6l3-3v-2"/><path d="M12 16v4"/><path d="M9 20h6"/>${px(11, 8)}`,
    hold: [["b", { scale: 1.08 }]], loop: [["px", { opacity: [1, 0.15, 1] }, { duration: 0.7 }]], note: "The capsule swells and its light blinks, as if recording." },
  wave: { d: `<path data-p="w" d="M4 10v4"/><path data-p="w" d="M8 7v10"/><path class="a" data-p="w" d="M12 4v16"/><path data-p="w" d="M16 8v8"/><path data-p="w" d="M20 10v4"/>`,
    loop: [["w", { scaleY: [1, 0.4, 1.25, 1] }, { stagger: 0.08, duration: 0.7 }]], note: "Bars rise and fall in a travelling wave." },
  copy: { d: `<path data-p="bk" d="M9 16H5V4h9l2 2v3"/><g data-p="fr"><path d="M9 9h8l3 3v8H9z"/><path class="a" d="M17 9v3h3"/></g>`,
    hold: [["bk", { x: -1.5, y: -1.5 }], ["fr", { x: 1, y: 1 }]], note: "The two sheets pull apart." },
  quote: { d: `<path data-p="q" d="M9 8l-4 4v5h5v-5H5"/><path class="a" data-p="q" d="M18 8l-4 4v5h5v-5h-5"/>`,
    play: [["q", { y: [-4, 0], opacity: [0, 1] }, { stagger: 0.09, duration: 0.3 }]], note: "The marks drop in one after the other." },
  up: { d: thumb, play: [["g", { rotate: [0, -16, 0] }, { duration: 0.45 }]], note: "Tips from the wrist." },
  dn: { d: `<g transform="matrix(1 0 0 -1 0 24)">${thumb}</g>`, play: [["g", { rotate: [0, -16, 0] }, { duration: 0.45 }]], note: "Tips from the wrist." },
  fork: { d: `<path d="M7 7v10"/><rect x="5" y="3" width="4" height="4"/><rect x="5" y="17" width="4" height="4"/><path class="a" data-p="br" d="M7 15h7l3-3v-2"/><rect class="a" data-p="nd" x="15" y="6" width="4" height="4"/>`,
    play: [["br", { pathLength: [0, 1] }, { duration: 0.35 }], ["nd", { scale: [0, 1] }, { duration: 0.25, delay: 0.28 }]], note: "The branch grows out of the trunk, then its node lands." },
  bulb: { d: `<path data-p="hd" d="M9 3h6l3 3v5l-3 3H9l-3-3V6z"/><path d="M9 14v3h6v-3"/><path d="M10 20h4"/><path class="a" data-p="fl" d="M10 10l2-2 2 2"/>`,
    play: [["fl", { opacity: [1, 0.1, 1, 0.3, 1] }, { duration: 0.5 }], ["hd", { scale: [1, 1.08, 1] }, { duration: 0.5 }]], note: "The filament flickers on." },
  book: { d: `<path data-p="pl" style="transform-origin:100% 50%" d="M12 8l-2-2H3v12h7l2 2"/><path data-p="pr" style="transform-origin:0% 50%" d="M12 8l2-2h7v12h-7l-2 2"/><path class="a" d="M12 8v12"/>`,
    play: [["pr", { scaleX: [1, 0.7, 1] }, { duration: 0.5 }], ["pl", { scaleX: [1, 0.7, 1] }, { duration: 0.5, delay: 0.08 }]], note: "Both pages lift from the spine." },
  layers: { d: `<path data-p="bk" d="M8 9V5h12v11h-4"/><path d="M4 9h12v11H4z"/><path class="a" data-p="t" style="transform-origin:0% 50%" d="M7 13h6"/><path class="a" data-p="t" style="transform-origin:0% 50%" d="M7 16h4"/>`,
    hold: [["bk", { x: 2, y: -2 }]], play: [["t", { scaleX: [0, 1] }, { stagger: 0.08, duration: 0.28 }]], note: "The back sheet slides out while the front one fills in." },
  panel: { d: `<path d="M5 4h14l1 1v14l-1 1H5l-1-1V5z"/><path class="a" data-p="dv" d="M9 4v16"/>`, hold: [["dv", { x: -3 }]], note: "The divider moves the way the panel will." },
  panelr: { d: `<path d="M5 4h14l1 1v14l-1 1H5l-1-1V5z"/><path class="a" data-p="dv" d="M15 4v16"/>`, hold: [["dv", { x: 3 }]], note: "The divider moves the way the panel will." },
  play: { d: `<path class="a" data-p="t" d="M8 4l8 8-8 8z"/>`, hold: [["t", { x: 2 }]], note: "Leans forward." },
  // ── review ──
  pen: { d: `<g data-p="nib"><path d="M12 2l5 5v5l-5 5-5-5V7z"/><path d="M12 17v-6"/>${px(11, 7)}</g><path class="a" data-p="ink" d="M4 21h16"/>`,
    play: [["nib", { x: [0, -5, 5, 0] }, { duration: 0.7 }], ["ink", { pathLength: [0, 1] }, { duration: 0.5, delay: 0.12 }]], note: "The nib crosses the line it is ruling." },
  edit: { d: `<g data-p="g" style="transform-origin:0% 100%"><path d="M5 19v-4L16 4l4 4L9 19z"/><path d="M13 7l4 4"/><path class="a" d="M5 15l4 4"/></g>`,
    play: [["g", { rotate: [0, -10, 6, 0] }, { duration: 0.5 }]], note: "Scribbles from its point." },
  feather: { d: `<g data-p="g" style="transform-origin:0% 100%"><path d="M20 4h-6l-6 6v6h6l6-6z"/><path class="a" data-p="sh" d="M4 20L14 10"/></g>`,
    play: [["g", { rotate: [0, -9, 5, 0] }, { duration: 0.7 }], ["sh", { pathLength: [0, 1] }, { duration: 0.45 }]], note: "Sways from the tip as the shaft is drawn." },
  ruler: { d: `<path d="M3 8h18v8H3z"/><path data-p="tk" style="transform-origin:50% 0%" d="M7 8v3"/><path class="a" data-p="tk" style="transform-origin:50% 0%" d="M12 8v5"/><path data-p="tk" style="transform-origin:50% 0%" d="M17 8v3"/>`,
    play: [["tk", { scaleY: [0, 1] }, { stagger: 0.07, duration: 0.25 }]], note: "Ticks are struck left to right." },
  compass: { d: `<path d="${oct}"/><path class="a" data-p="nd" d="M15 9v3l-3 3H9v-3l3-3z"/>`,
    play: [["nd", { rotate: [0, 70, -20, 0] }, { duration: 0.7 }]], note: "The needle swings and settles." },
  pattern: { d: `<path data-p="e" d="M7 5h10"/><path data-p="e" d="M5 7v5l5 5"/><path data-p="e" d="M19 7v5l-5 5"/><rect data-p="n" x="3" y="3" width="4" height="4"/><rect data-p="n" x="17" y="3" width="4" height="4"/><rect class="a" data-p="n" x="10" y="17" width="4" height="4"/>`,
    play: [["e", { pathLength: [0, 1] }, { stagger: 0.1, duration: 0.3 }], ["n", { scale: [0.6, 1] }, { stagger: 0.1, start: 0.15, duration: 0.25 }]], note: "Edges connect, then each node answers." },
  route: { d: `<rect x="4" y="16" width="4" height="4"/><path data-p="pt" d="M8 18h6l4-4V8"/><rect class="a" data-p="nd" x="16" y="4" width="4" height="4"/>`,
    play: [["pt", { pathLength: [0, 1] }, { duration: 0.4 }], ["nd", { scale: [0, 1] }, { duration: 0.25, delay: 0.35 }]], note: "The path runs from one turn to the next." },
  eye: { d: `<path data-p="lid" d="M2 12l5-5h10l5 5-5 5H7z"/><rect class="a" data-p="pu" x="10" y="10" width="4" height="4"/>`,
    play: [["lid,pu", { scaleY: [1, 0.12, 1] }, { duration: 0.32 }]], note: "Blinks." },
  lock: { d: `<path data-p="sh" d="M8 11V7l3-3h2l3 3v4"/><path d="M6 11h12l1 1v8l-1 1H6l-1-1v-8z"/>${px(11, 14, 2, 4)}`,
    hold: [["sh", { y: -2.5 }]], play: [["px", { opacity: [1, 0, 1] }]], note: "The shackle lifts while you are over it." },
  save: { d: `<path d="M4 4h13l3 3v13H4z"/><path d="M8 4v5h7V4"/><path class="a" data-p="bar" style="transform-origin:0% 50%" d="M8 15h8"/>`,
    play: [["bar", { scaleX: [0, 1] }, { duration: 0.5 }]], note: "The write bar fills." },
  export: { d: `<g data-p="ar"><path d="M12 4v10"/><path d="M7 10l5 5 5-5"/></g><path class="a" d="M4 16v4h16v-4"/>`,
    play: [["ar", { y: [0, 4, 0] }, { duration: 0.5 }]], note: "The arrow drops into the tray." },
  import: { d: `<g data-p="ar"><path d="M12 15V5"/><path d="M7 9l5-5 5 5"/></g><path class="a" d="M4 16v4h16v-4"/>`,
    play: [["ar", { y: [0, -3, 0] }, { duration: 0.5 }]], note: "The arrow lifts out of the tray." },
  trash: { d: `<g data-p="lid" style="transform-origin:0% 100%"><path d="M4 7h16"/><path d="M9 7V4h6v3"/></g><path d="M6 7v12l1 1h10l1-1V7"/><path class="a" d="M10 11v5"/><path class="a" d="M14 11v5"/>`,
    hold: [["lid", { rotate: -16, y: -1 }]], note: "The lid opens and stays open." },
  // ── status ──
  shield: { d: `<path d="M7 4h10l2 2v7l-7 7-7-7V6z"/><path class="a" data-p="q" d="M10 9V8h4v3h-2v2"/>${px(11, 14.5, 2, 1.8, "q")}`,
    play: [["q", { opacity: [1, 0, 1, 0, 1] }, { duration: 0.6 }]], note: "The question blinks twice." },
  alert: { d: `<path d="${oct}"/><path class="a" data-p="b" d="M12 7v6"/>${px(11, 15, 2, 2, "b")}`,
    play: [["b", { x: [0, -1.5, 1.5, -1, 1, 0] }, { duration: 0.4 }]], note: "A short shake." },
  // ── second set: everything the app used to draw with a foreign icon family ──
  // ── direction and layout ──
  chevl: { d: `<path data-p="c" d="M15 6l-6 6 6 6"/>`, play: [["c", { x: [0, -2.5, 0] }]], note: "One small nod." },
  chevu: { d: `<path data-p="c" d="M6 15l6-6 6 6"/>`, play: [["c", { y: [0, -2.5, 0] }]], note: "One small nod." },
  corner: { d: `<path d="M5 4v9h12"/><path class="a" data-p="h" d="M13 9l4 4-4 4"/>`, play: [["h", { x: [0, 2.5, 0] }]], note: "Turns the corner and points on." },
  undo: { d: `<g data-p="g" style="transform-origin:17px 10px"><path d="M5 12v4l3 3h8l3-3V8l-3-3H9"/><path class="a" d="M12 2L9 5l3 3"/></g>`,
    play: [["g", { rotate: [0, -360] }, { duration: 0.6, ease: [0.4, 0, 0.2, 1] }]], note: "One full turn, backwards." },
  expand: { d: `<path d="M14 4h6v6"/><path d="M10 20H4v-6"/><path class="a" data-p="a1" d="M20 4l-7 7"/><path class="a" data-p="a2" d="M4 20l7-7"/>`,
    hold: [["a1", { x: 1.5, y: -1.5 }], ["a2", { x: -1.5, y: 1.5 }]], note: "The corners pull outward." },
  collapse: { d: `<path d="M20 10h-6V4"/><path d="M4 14h6v6"/><path class="a" data-p="a1" d="M14 10l7-7"/><path class="a" data-p="a2" d="M10 14l-7 7"/>`,
    hold: [["a1", { x: -1.5, y: 1.5 }], ["a2", { x: 1.5, y: -1.5 }]], note: "The corners pull inward." },
  grip: { d: `${dot(7.5, 4.5, 3, 3, "d")}${dot(13.5, 4.5, 3, 3, "d")}${dot(7.5, 10.5, 3, 3, "d")}<rect class="af" data-p="d" x="13.5" y="10.5" width="3" height="3"/>${dot(7.5, 16.5, 3, 3, "d")}${dot(13.5, 16.5, 3, 3, "d")}`,
    play: [["d", { scale: [1, 0.6, 1] }, { stagger: 0.04, duration: 0.3 }]], note: "The studs flinch in turn, ready to be held." },
  minus: { d: `<g data-p="g"><path d="M5 12h6"/><path d="M13 12h6"/>${px(11, 11)}</g>`, hold: [["g", { scaleX: 0.7 }]], note: "Draws in." },
  // ── playback ──
  pause: { d: `<path data-p="l" d="M6 5h4v14H6z"/><path class="a" data-p="r" d="M14 5h4v14h-4z"/>`, hold: [["l", { x: -1 }], ["r", { x: 1 }]], note: "The bars part." },
  stop: { d: `<path data-p="s" d="M6 6h12v12H6z"/>${px(11, 11)}`, hold: [["s", { scale: 0.88 }]], note: "Presses in." },
  skip: { d: `<path data-p="t" d="M5 5l7 7-7 7z"/><path class="a" data-p="b" d="M17 5v14"/>`, play: [["t", { x: [0, 3, 0] }]], note: "The arrow runs into the stop." },
  // ── status ──
  help: { d: `<path data-p="q" d="M7 8V7l3-3h4l3 3v3l-5 5v1"/>${px(11, 19, 2, 2, "d")}`, play: [["q", { rotate: [0, -8, 6, 0] }, { duration: 0.45 }], ["d", { opacity: [1, 0, 1] }]], note: "Tilts its head." },
  info: { d: `<path d="M9 10h3v9"/><path d="M9 19h6"/>${px(11, 4, 2, 3)}`, play: [["px", { y: [0, -2, 0] }, { duration: 0.35 }]], note: "The dot hops." },
  clock: { d: `<path d="${oct}"/><path class="a" data-p="h" style="transform-origin:12px 12px" d="M12 7v5l3 3"/>`,
    play: [["h", { rotate: [0, 360] }, { duration: 0.7, ease: [0.4, 0, 0.2, 1] }]], note: "The hands go once around." },
  calendar: { d: `<path d="M4 6h16v14H4z"/><path d="M4 10h16"/><path d="M8 3v4"/><path d="M16 3v4"/>${px(7, 13, 3, 3)}`, play: [["px", { x: [0, 5, 5, 0], y: [0, 0, 0, 0] }, { duration: 0.7 }]], note: "The marked day moves along the week and back." },
  spin: { d: `<g data-p="g" style="transform-origin:12px 12px"><path d="M16 3l5 5v8l-5 5H8l-5-5V8l5-5"/><path class="a" d="M8 3h5"/></g>`,
    loop: [["g", { rotate: [0, 360] }, { duration: 0.9 }]], note: "Turns while work is under way. In the app it steps eight times a turn." },
  flag: { d: `<path d="M6 21V4"/><path class="a" data-p="f" style="transform-origin:25% 50%" d="M6 5h12l-4 4 4 4H6"/>`, play: [["f", { scaleX: [1, 0.8, 1.05, 1] }, { duration: 0.5 }]], note: "Catches the wind once." },
  bookmark: { d: `<path data-p="b" d="M7 4h10v16l-5-5-5 5z"/>${px(11, 7, 2, 3)}`, play: [["b", { y: [0, 2, 0] }, { duration: 0.3 }]], note: "Slips down into the page." },
  target: { d: `<path d="${oct}"/><path data-p="r" d="M10 8h4l2 2v4l-2 2h-4l-2-2v-4z"/>${px(11, 11)}`, play: [["r", { scale: [1.5, 1] }, { duration: 0.3 }]], note: "The ring closes on the centre." },
  ring: { d: `<path data-p="r" d="M9 5h6l4 4v6l-4 4H9l-4-4V9z"/>`, hold: [["r", { scale: 0.9 }]], note: "Draws in a little." },
  spark: { d: `<path data-p="d" d="M11 6l6 6-6 6-6-6z"/>${px(17, 3, 3, 3)}`, play: [["d", { scale: [1, 1.14, 1] }, { duration: 0.4 }], ["px", { opacity: [1, 0, 1, 0, 1] }, { duration: 0.5 }]], note: "Swells once while its small companion glints." },
  trend: { d: `<path data-p="l" d="M3 17l6-6 4 4 7-7"/><path class="a" data-p="h" d="M15 8h5v5"/>`, play: [["l", { pathLength: [0, 1] }, { duration: 0.45 }], ["h", { opacity: [0, 1] }, { duration: 0.2, delay: 0.4 }]], note: "The line is drawn, then its head arrives." },
  signal: { d: `<path data-p="b" style="transform-origin:50% 100%" d="M5 20v-4"/><path data-p="b" style="transform-origin:50% 100%" d="M10 20v-8"/><path data-p="b" style="transform-origin:50% 100%" d="M15 20V8"/><path class="a" data-p="b" style="transform-origin:50% 100%" d="M20 20V4"/>`,
    play: [["b", { scaleY: [0, 1] }, { stagger: 0.07, duration: 0.25 }]], note: "Bars come up from the weakest to the strongest." },
  // ── people and account ──
  person: { d: `<path class="a" data-p="hd" d="M10 4h4l2 2v3l-2 2h-4L8 9V6z"/><path d="M4 21v-3l4-4h8l4 4v3"/>`, play: [["hd", { y: [0, -1.5, 0] }, { duration: 0.35 }]], note: "A small nod." },
  people: { d: `<path d="M7 5h3l1 1v3l-1 1H7L6 9V6z"/><path d="M3 20v-4l2-2h7l2 2v4"/><g data-p="o"><path class="a" d="M15 6h2l1 1v2l-1 1h-1"/><path class="a" d="M17 14h2l2 2v4"/></g>`,
    play: [["o", { x: [3, 0], opacity: [0, 1] }, { duration: 0.3 }]], note: "The second person steps in." },
  signin: { d: `<path d="M13 4h6v16h-6"/><g data-p="ar"><path class="a" d="M4 12h10"/><path class="a" d="M10 8l4 4-4 4"/></g>`, play: [["ar", { x: [0, 3, 0] }]], note: "Steps through the door." },
  signout: { d: `<path d="M11 4H5v16h6"/><g data-p="ar"><path class="a" d="M10 12h10"/><path class="a" d="M16 8l4 4-4 4"/></g>`, play: [["ar", { x: [0, 3, 0] }]], note: "Steps out of the door." },
  key: { d: `<g data-p="g" style="transform-origin:8px 12px"><path d="M7 9h3l2 2v2l-2 2H7l-2-2v-2z"/><path d="M12 12h9"/><path class="a" d="M17 12v4"/><path class="a" d="M20 12v3"/></g>`, play: [["g", { rotate: [0, 30, 0] }, { duration: 0.4 }]], note: "Turns in the lock." },
  card: { d: `<path d="M3 6h18v12H3z"/><path class="a" data-p="s" style="transform-origin:0% 50%" d="M3 10h18"/><path d="M6 14h4"/>`, play: [["s", { scaleX: [0, 1] }, { duration: 0.35 }]], note: "The stripe is swiped." },
  hand: { d: `<g data-p="g" style="transform-origin:50% 100%"><path d="M9 21v-4l-4-4v-3h3V4h9v10l-3 3v4z"/><path d="M11 4v6"/><path d="M14 4v6"/>${px(11, 13)}</g>`, play: [["g", { rotate: [0, -10, 8, 0] }, { duration: 0.5 }]], note: "Waves once to be noticed." },
  bot: { d: `<path d="M5 8h14v11H5z"/><path d="M12 8V5"/>${dot(11, 3)}<rect class="f" data-p="e" x="8" y="11" width="2" height="3"/><rect class="f" data-p="e" x="14" y="11" width="2" height="3"/><path class="a" d="M9 16h6"/>`,
    play: [["e", { scaleY: [1, 0.15, 1] }, { duration: 0.3 }]], note: "Keating blinks." },
  react: { d: `<path d="M13 3H8L3 8v8l5 5h8l5-5v-4"/>${dot(8, 10)}${dot(13, 10)}<path d="M8 15h7"/><g data-p="pl"><path class="a" d="M18 3v6"/><path class="a" d="M15 6h6"/></g>`, hold: [["pl", { rotate: 90 }]], note: "The plus turns." },
  // ── media ──
  image: { d: `<path d="M4 5h16v14H4z"/><path data-p="m" d="M4 16l5-5 4 4 2-2 5 5"/>${px(15, 8)}`, play: [["px", { y: [3, 0], opacity: [0, 1] }, { duration: 0.35 }]], note: "The sun comes up over the hills." },
  camera: { d: `<path d="M4 8h4l2-2h4l2 2h4v11H4z"/><path class="a" data-p="l" d="M10 11h4l1 1v3l-1 1h-4l-1-1v-3z"/>`, play: [["l", { scale: [1, 0.7, 1] }, { duration: 0.25 }]], note: "The shutter closes and opens." },
  cameraoff: { d: `<path d="M4 8h4l2-2h4l2 2h4v11H4z"/><path d="M10 11h4l1 1v3l-1 1h-4l-1-1v-3z"/>${slash}`, play: [["sl", { pathLength: [0, 1] }, { duration: 0.3 }]], note: "Struck through." },
  video: { d: `<path d="M3 7h11v10H3z"/><path class="a" data-p="v" d="M14 12l5-5v10z"/>`, hold: [["v", { x: 1.5 }]], note: "The lens leans toward its subject." },
  screen: { d: `<path d="M3 5h18v11H3z"/><path d="M12 16v4"/><path d="M8 20h8"/><g data-p="ar"><path class="a" d="M12 13V8"/><path class="a" d="M9 10l3-3 3 3"/></g>`, play: [["ar", { y: [0, -2, 0] }]], note: "The arrow lifts off the screen." },
  speaker: { d: `${speaker}<path class="a" data-p="w" d="M16 8l4 4-4 4"/>`, loop: [["w", { x: [0, 1.5, 0], opacity: [1, 0.4, 1] }, { duration: 0.7 }]], note: "Sound leaves the cone." },
  mute: { d: `${speaker}<g data-p="x"><path class="a" d="M16 9l5 5"/><path class="a" d="M21 9l-5 5"/></g>`, play: [["x", { scale: [0, 1] }, { duration: 0.25 }]], note: "The cross lands." },
  micoff: { d: `<path d="M10 4h4l1 1v7l-1 1h-4l-1-1V5z"/><path d="M6 11v2l3 3h6l3-3v-2"/><path d="M12 16v4"/><path d="M9 20h6"/>${slash}`, play: [["sl", { pathLength: [0, 1] }, { duration: 0.3 }]], note: "Struck through." },
  eyeoff: { d: `<path d="M2 12l5-5h10l5 5-5 5H7z"/><rect x="10" y="10" width="4" height="4"/>${slash}`, play: [["sl", { pathLength: [0, 1] }, { duration: 0.3 }]], note: "Struck through." },
  headphones: { d: `<path d="M4 15v-5l5-5h6l5 5v5"/><path class="a" data-p="c" d="M4 14h4v6H4z"/><path class="a" data-p="c" d="M16 14h4v6h-4z"/>`, play: [["c", { scaleY: [1, 0.8, 1] }, { stagger: 0.1, duration: 0.3 }]], note: "The cups thump in turn." },
  music: { d: `<path d="M9 18V5h10v11"/><path data-p="n" d="M5 16h4v4H5z"/><path class="a" data-p="n" d="M15 14h4v4h-4z"/>`, play: [["n", { y: [0, -2, 0] }, { stagger: 0.12, duration: 0.3 }]], note: "The notes bounce." },
  hangup: { d: `<g data-p="g"><path d="M3 11l3-3h12l3 3v4h-5v-3H8v3H3z"/></g><path class="a" data-p="a" d="M12 16v5"/>`, hold: [["g", { y: 1.5 }]], note: "The handset settles onto its cradle." },
  // ── documents and work ──
  doc: { d: `<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/><path class="a" data-p="t" style="transform-origin:0% 50%" d="M9 12h6"/><path class="a" data-p="t" style="transform-origin:0% 50%" d="M9 16h6"/>`,
    play: [["t", { scaleX: [0, 1] }, { stagger: 0.08, duration: 0.28 }]], note: "Its lines are typed in." },
  note: { d: `<path d="M4 4h16v10l-6 6H4z"/><path class="a" data-p="c" d="M20 14h-6v6"/>`, hold: [["c", { x: -1, y: -1 }]], note: "The corner lifts." },
  quiz: { d: `<path d="M6 3h8l4 4v14H6z"/><path class="a" data-p="q" d="M10 12v-1l1-1h2l1 1v1l-2 2v1"/>${px(11, 17, 2, 2, "q")}`, play: [["q", { opacity: [1, 0, 1, 0, 1] }, { duration: 0.6 }]], note: "The question blinks twice." },
  checklist: { d: `<path class="a" data-p="c" d="M3 7l2 2 3-3"/><path d="M11 8h10"/><path d="M4 14h3v3H4z"/><path d="M11 16h10"/>`, play: [["c", { pathLength: [0, 1] }, { duration: 0.3 }]], note: "The first item is ticked." },
  folder: { d: `<path d="M3 6h6l2 2h10v11H3z"/><path class="a" data-p="l" d="M3 11h18"/>`, hold: [["l", { y: 2 }]], note: "The flap opens." },
  message: { d: `<path d="M4 5h16v11h-9l-4 4v-4H4z"/><path class="a" data-p="t" style="transform-origin:0% 50%" d="M8 9h8"/><path data-p="t" style="transform-origin:0% 50%" d="M8 12h5"/>`,
    play: [["t", { scaleX: [0, 1] }, { stagger: 0.09, duration: 0.28 }]], note: "The message is typed." },
  reply: { d: `<path data-p="h" d="M9 6l-5 5 5 5"/><path class="a" d="M4 11h11l5 5v3"/>`, play: [["h", { x: [0, -2.5, 0] }]], note: "Turns back to answer." },
  code: { d: `<path data-p="l" d="M9 7l-5 5 5 5"/><path data-p="r" d="M15 7l5 5-5 5"/>${px(11, 11)}`, hold: [["l", { x: -1.5 }], ["r", { x: 1.5 }]], note: "The brackets open." },
  terminal: { d: `<path d="M3 5h18v14H3z"/><path d="M7 9l3 3-3 3"/><path class="a" data-p="c" d="M12 15h5"/>`, loop: [["c", { opacity: [1, 0, 1] }, { duration: 0.8 }]], note: "The cursor blinks." },
  tree: { d: `<path d="M10 3h4v4h-4z"/><path data-p="b" d="M12 7v4"/><path data-p="b" d="M6 15v-4h12v4"/><path d="M4 15h4v4H4z"/><path class="a" data-p="n" d="M16 15h4v4h-4z"/>`,
    play: [["b", { pathLength: [0, 1] }, { stagger: 0.1, duration: 0.25 }], ["n", { scale: [0, 1] }, { duration: 0.25, delay: 0.3 }]], note: "Branches run down, then the new node lands." },
  compare: { d: `<g data-p="t"><path d="M4 8h14"/><path d="M14 4l4 4-4 4"/></g><g data-p="b"><path class="a" d="M20 16H6"/><path class="a" d="M10 12l-4 4 4 4"/></g>`, hold: [["t", { x: 1.5 }], ["b", { x: -1.5 }]], note: "The two arrows pass each other." },
  shapes: { d: `<path data-p="s" d="M8 3l5 5H3z"/><path data-p="s" d="M14 13h7v7h-7z"/><path class="a" data-p="s" d="M5 13h3l2 2v3l-2 2H5l-2-2v-3z"/>`, play: [["s", { scale: [0.6, 1] }, { stagger: 0.08, duration: 0.25 }]], note: "The three pieces drop into place." },
  gear: { d: `<g data-p="g" style="transform-origin:12px 12px"><path d="M10 6h4l4 4v4l-4 4h-4l-4-4v-4z"/><path d="M12 3v3"/><path d="M12 18v3"/><path d="M3 12h3"/><path d="M18 12h3"/></g><path class="a" d="M10 10h4v4h-4z"/>`, hold: [["g", { rotate: 45 }]], note: "An eighth of a turn, held." },
  tool: { d: `<g data-p="g" style="transform-origin:20% 80%"><path d="M5 19l9-9"/><path class="a" d="M14 10V6l3-3v4h4l-3 3z"/></g>`, play: [["g", { rotate: [0, -14, 8, 0] }, { duration: 0.5 }]], note: "A turn of the wrench." },
  bug: { d: `<path d="M9 8h6l2 2v7l-3 3h-4l-3-3v-7z"/><path d="M9 8V6l2-2"/><path d="M15 8V6l-2-2"/><path data-p="lg" d="M7 13H3"/><path data-p="lg" d="M17 13h4"/><path class="a" d="M12 11v9"/>`, play: [["lg", { y: [0, -1.5, 1.5, 0] }, { duration: 0.4 }]], note: "The legs twitch." },
  chip: { d: `<path d="M7 7h10v10H7z"/><path class="a" data-p="c" d="M10 10h4v4h-4z"/><path d="M10 3v4"/><path d="M14 3v4"/><path d="M10 17v4"/><path d="M14 17v4"/><path d="M3 10h4"/><path d="M3 14h4"/><path d="M17 10h4"/><path d="M17 14h4"/>`,
    loop: [["c", { opacity: [1, 0.25, 1] }, { duration: 0.9 }]], note: "The core pulses while it works." },
  server: { d: `<path d="M4 4h16v7H4z"/><path d="M4 13h16v7H4z"/>${px(7, 6.5)}${dot(7, 15.5, 2, 2, "l")}<path d="M12 7.5h5"/><path d="M12 16.5h5"/>`, loop: [["px", { opacity: [1, 0.2, 1] }, { duration: 0.8 }]], note: "The status light blinks." },
  keyboard: { d: `<path d="M3 6h18v12H3z"/><path data-p="k" d="M6 10h2"/><path data-p="k" d="M11 10h2"/><path data-p="k" d="M16 10h2"/><path class="a" d="M7 14h10"/>`, play: [["k", { y: [0, 1.5, 0] }, { stagger: 0.07, duration: 0.2 }]], note: "Three keys are struck." },
  // ── sharing and output ──
  share: { d: `<path d="M4 10h4v4H4z"/><path data-p="e" d="M8 11l6-6"/><path data-p="e" d="M8 13l6 6"/><path class="a" data-p="n" d="M14 3h4v4h-4z"/><path data-p="n" d="M14 17h4v4h-4z"/>`,
    play: [["e", { pathLength: [0, 1] }, { stagger: 0.08, duration: 0.25 }], ["n", { scale: [0.5, 1] }, { stagger: 0.08, start: 0.15, duration: 0.2 }]], note: "Lines reach out to two more places." },
  link: { d: `<path data-p="l" d="M10 8H6l-2 2v4l2 2h4"/><path data-p="r" d="M14 8h4l2 2v4l-2 2h-4"/><path class="a" d="M9 12h6"/>`, hold: [["l", { x: 1.5 }], ["r", { x: -1.5 }]], note: "The two links close up." },
  qr: { d: `<path d="M4 4h6v6H4z"/><path d="M14 4h6v6h-6z"/><path d="M4 14h6v6H4z"/><rect class="af" data-p="m" x="14" y="14" width="3" height="3"/>${dot(18, 18, 2, 2, "m")}`, play: [["m", { opacity: [0, 1] }, { stagger: 0.12, duration: 0.2 }]], note: "The last modules resolve." },
  print: { d: `<path d="M7 9V4h10v5"/><path d="M7 17H4V9h16v8h-3"/><path class="a" data-p="p" d="M7 14h10v6H7z"/>`, play: [["p", { y: [-3, 0] }, { duration: 0.4 }]], note: "The sheet feeds out." },
  scan: { d: `<path d="M4 9V4h5"/><path d="M15 4h5v5"/><path d="M20 15v5h-5"/><path d="M9 20H4v-5"/><path class="a" data-p="l" d="M4 12h16"/>`, play: [["l", { y: [-5, 5, 0] }, { duration: 0.7 }]], note: "The line sweeps the frame." },
  globe: { d: `<path d="${oct}"/><path d="M3 12h18"/><path class="a" data-p="m" style="transform-origin:12px 12px" d="M12 3L8 7v10l4 4 4-4V7z"/>`, play: [["m", { scaleX: [1, 0.2, 1] }, { duration: 0.6 }]], note: "Turns on its axis." },
  hash: { d: `<path d="M9 4v16"/><path d="M15 4v16"/><path d="M4 9h16"/><path class="a" data-p="l" style="transform-origin:0% 50%" d="M4 15h16"/>`, play: [["l", { scaleX: [0, 1] }, { duration: 0.3 }]], note: "The last stroke is drawn." },
  power: { d: `<path d="M8 6L5 9v7l4 4h6l4-4V9l-3-3"/><path class="a" data-p="s" d="M12 3v9"/>`, play: [["s", { y: [-2, 0], opacity: [0.2, 1] }, { duration: 0.3 }]], note: "The switch is thrown." },
  // ── theme ──
  sun: { d: `<path d="M10 8h4l2 2v4l-2 2h-4l-2-2v-4z"/><g data-p="r" style="transform-origin:12px 12px"><path d="M12 3v2"/><path d="M12 19v2"/><path d="M3 12h2"/><path d="M19 12h2"/><path class="a" d="M5.5 5.5l1.5 1.5"/><path class="a" d="M17 17l1.5 1.5"/><path class="a" d="M18.5 5.5L17 7"/><path class="a" d="M7 17l-1.5 1.5"/></g>`,
    hold: [["r", { rotate: 45 }]], note: "The rays turn an eighth." },
  moon: { d: `<path data-p="m" d="M14 3H9L4 8v8l5 5h7l4-4h-5l-5-5V7z"/>${px(17, 6)}`, play: [["px", { opacity: [1, 0, 1, 0, 1] }, { duration: 0.6 }]], note: "A star glints beside it." },
  verified: { d: `<path d="M7 4h10l2 2v7l-7 7-7-7V6z"/><path class="a" data-p="c" d="M9 11l2 2 4-4"/>`, play: [["c", { pathLength: [0, 1] }, { duration: 0.3 }]], note: "The tick is drawn inside the shield." },
  // ── mark ──
  kmark: { d: `<path d="M5 4v16"/><path d="M16 4l-8 8 8 8"/>${px(18, 17, 3, 3)}`, note: "The Keating K with a waiting cursor." },
};

export const GROUPS = [
  ["Direction", ["left", "right", "down", "rise", "send", "chev", "chevr", "chevl", "chevu", "ext", "corner", "expand", "collapse"]],
  ["Basics", ["plus", "minus", "x", "check", "more", "menu", "search", "filter", "refresh", "undo", "grip"]],
  ["Chat", ["clip", "mic", "micoff", "wave", "copy", "quote", "reply", "message", "up", "dn", "fork", "bulb", "spark", "book", "layers", "panel", "panelr", "play", "pause", "stop", "skip", "speaker", "mute"]],
  ["Review", ["pen", "edit", "feather", "ruler", "compass", "pattern", "route", "eye", "eyeoff", "lock", "save", "export", "import", "trash", "flag", "bookmark"]],
  ["Learning", ["doc", "note", "quiz", "checklist", "folder", "tree", "shapes", "code", "terminal", "compare", "target", "trend", "clock", "calendar"]],
  ["People and rooms", ["person", "people", "hand", "bot", "react", "camera", "cameraoff", "video", "screen", "headphones", "music", "hangup"]],
  ["Settings and account", ["gear", "tool", "bug", "chip", "server", "keyboard", "key", "card", "signin", "signout", "globe", "sun", "moon", "power"]],
  ["Sharing", ["share", "link", "qr", "print", "scan", "image", "hash"]],
  ["Status and mark", ["shield", "verified", "alert", "help", "info", "spin", "ring", "signal", "kmark"]],
];

export const LABELS = {
  left: "back", right: "forward", down: "jump down", rise: "move up", send: "send", chev: "open", chevr: "next", ext: "open elsewhere",
  plus: "add", x: "close", check: "done", more: "more", menu: "menu", search: "search", filter: "filter", refresh: "retry",
  clip: "attach", mic: "record", wave: "live", copy: "copy", quote: "quote", up: "helpful", dn: "not helpful", fork: "fork", bulb: "reasoning", book: "sources", layers: "materials", panel: "sessions", panelr: "margin", play: "run",
  pen: "review", edit: "edit", feather: "Socratic pass", ruler: "rubric", compass: "finish note", pattern: "patterns", route: "turns", eye: "focus", lock: "private", save: "save", export: "export", import: "bring in", trash: "delete",
  shield: "unverified", alert: "problem", kmark: "Keating",
  chevl: "previous", chevu: "close up", corner: "nested under", undo: "undo", expand: "full size", collapse: "smaller", grip: "drag to reorder", minus: "remove",
  pause: "pause", stop: "stop", skip: "skip",
  help: "help", info: "about this", clock: "time", calendar: "due date", spin: "working", flag: "flag", bookmark: "keep", target: "goal", ring: "not started", spark: "made by Keating", trend: "progress", signal: "strength",
  person: "you", people: "people", signin: "sign in", signout: "sign out", key: "access key", card: "payment", hand: "ask to step in", bot: "Keating bot", react: "react",
  image: "image", camera: "camera", cameraoff: "camera off", video: "video", screen: "share screen", speaker: "read aloud", mute: "muted", micoff: "microphone off", eyeoff: "hidden", headphones: "listen", music: "audio", hangup: "leave call",
  doc: "document", note: "note", quiz: "quiz", checklist: "assignment", folder: "files", message: "discussion", reply: "reply", code: "code", terminal: "terminal", tree: "outline", compare: "compare", shapes: "components", gear: "settings", tool: "tools", bug: "diagnostics", chip: "model", server: "provider", keyboard: "shortcuts",
  share: "share", link: "link", qr: "QR code", print: "print", scan: "scan", globe: "language", hash: "topic", power: "turn off",
  sun: "light theme", moon: "dark theme",
  verified: "checked and safe",
};

export const svg = (name, cls = "") => `<svg class="i${cls ? " " + cls : ""}" data-i="${name}" viewBox="0 0 24 24" aria-hidden="true">${GLYPHS[name].d}</svg>`;

/** A standalone file: presentation attributes instead of classes, no data-* hooks. */
export const standalone = (name) => {
  const body = GLYPHS[name].d
    .replace(/ class="af"/g, ' fill="currentColor" stroke="none"')
    .replace(/ class="f"/g, ' fill="currentColor" stroke="none"')
    .replace(/ class="a"/g, "")
    .replace(/ data-p="[^"]*"/g, "")
    .replace(/ style="[^"]*"/g, "");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="butt" stroke-linejoin="miter">${body}</svg>\n`;
};
