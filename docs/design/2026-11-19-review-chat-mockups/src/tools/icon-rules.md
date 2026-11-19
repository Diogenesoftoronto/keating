# Replacing foreign icons with Keating glyphs

The app must draw every icon from the Keating glyph set (`web/src/design-system/glyphs/`, 119 glyphs, names and meanings in `LABELS` at the end of `data.ts`). `lucide-react` goes away from the files in your scope.

## How to draw a glyph
```tsx
import { KeatingGlyph } from "<relative>/design-system/glyphs";
<KeatingGlyph name="clock" size={14} />            // decorative: it is aria-hidden by default
<KeatingGlyph name="spin" size={14} className="k-glyph-working" />   // a busy indicator; turns in eight steps
```
- Read `web/src/design-system/glyphs/KeatingGlyph.tsx` and `README.md` first for the props that exist (size, className, lit/selected state, motion trigger). Do not add props.
- For an icon-only button use the kit's `IconButton` (`web/src/design-system/kit`) when the surrounding file already uses the kit; otherwise keep the existing button element and its accessible name and swap only the icon.
- Sizes: keep the visible size the icon had (lucide `size={14}` stays 14; a class that set width/height stays). Glyphs are drawn on a 24 grid with a 1.9 stroke; do not pass `strokeWidth`. If a lucide icon was coloured by a class, keep the class; glyphs use `currentColor`.
- Never use a glyph for a meaning its drawing does not carry. `up` and `dn` are thumbs (helpful / not helpful), NOT arrows. `shield` has a question mark and means "unverified"; `verified` is the shield with a tick. `export` is the arrow dropping into a tray (download, export); `import` is the arrow lifting out (upload, bring in). `send` is for sending a message; `rise` is "move up"; `chevu` closes or collapses upward.
- Spinners: lucide `Loader2`/`LoaderCircle` with a spin class become `<KeatingGlyph name="spin" className="k-glyph-working" />`; remove the old spin class from that element only.
- Dynamic icon tables (`const icons: Record<Kind, LucideIcon>` and props typed `LucideIcon`) become tables of glyph names typed `GlyphName` (exported from the glyphs module), rendered with `KeatingGlyph`.
- Unicode symbols and emoji used as icons in JSX text (arrows, ticks, crosses, stars, warning signs) become glyphs too, unless they are part of learner-written or model-written content.
- KEEP (do not replace): brand or provider logos, file-type marks that come from data, the Keating logo images, pictures, and anything in `*.stories.tsx` or tests unless a test asserts on an icon you changed (then update the assertion).
- If a meaning truly has no glyph, do not improvise with a wrong one: leave that single icon as it is and list it in your report under "needs a glyph" with file:line and meaning. Expect this to be rare.

## Mapping (lucide name → glyph). Context can override: read what the control does.
| lucide | glyph | note |
|---|---|---|
| Check, CheckCircle2, CircleCheck | check | |
| X, XCircle | x | |
| Plus, FilePlus2 (as "add") | plus | |
| Minus, CircleMinus, MinusCircle | minus | |
| ArrowRight | right | |
| ArrowLeft | left | |
| ArrowDown | down | |
| ArrowUp | rise | `send` only on a send button |
| ArrowUpRight, ExternalLink | ext | |
| ChevronDown | chev | |
| ChevronRight | chevr | |
| ChevronLeft | chevl | |
| ChevronUp | chevu | |
| CornerDownRight | corner | |
| Maximize2 | expand | |
| Minimize2 | collapse | |
| GripVertical | grip | |
| RotateCcw | undo | when it means reset or undo; use `refresh` when it means try again or regenerate |
| RefreshCw, Repeat, SwitchCamera | refresh | |
| Loader2, LoaderCircle | spin | with class `k-glyph-working` |
| Play | play | |
| Pause | pause | |
| Square | stop | when it stops something; `ring` when it is an empty marker |
| SkipForward | skip | |
| Search | search | |
| SlidersHorizontal | filter | |
| Settings, Settings2 | gear | |
| Wrench, Hammer | tool | |
| Copy | copy | |
| Paperclip | clip | |
| Send | send | |
| Mic | mic | |
| MicOff | micoff | |
| AudioLines, Activity (as audio level) | wave | |
| Volume2 | speaker | |
| VolumeX | mute | |
| Headphones | headphones | |
| Music | music | |
| Quote | quote | |
| Reply | reply | |
| MessageSquare, MessageSquareText | message | |
| ThumbsUp | up | |
| GitBranch, GitFork | fork | |
| GitCompareArrows | compare | |
| Network, ListTree | tree | |
| Lightbulb, Brain | bulb | |
| Sparkles, Zap, Flame, Star (as "special" or streak) | spark | Star as "favourite" is `bookmark` |
| BookOpen, BookMarked (as reading), BookPlus, BookOpenCheck, Library, LibraryBig, GraduationCap | book | BookUp is `import` when it uploads or brings a book in |
| Bookmark, BookMarked (as saved) | bookmark | |
| Layers, Layers3 | layers | |
| Shapes, Box | shapes | |
| FileText, File, FileJson | doc | |
| FileCode2, Code2 | code | |
| Terminal | terminal | |
| FileQuestion | quiz | |
| NotebookPen, StickyNote | note | |
| ListChecks, ClipboardList, ClipboardCheck | checklist | |
| FolderOpen | folder | |
| PenLine, Pencil | edit | |
| Eye | eye | |
| EyeOff | eyeoff | |
| Lock, LockKeyhole | lock | |
| KeyRound | key | |
| ShieldCheck, Shield | verified | |
| ShieldAlert, AlertTriangle, TriangleAlert, AlertCircle, CircleAlert | alert | |
| CircleHelp, HelpCircle | help | |
| Info | info | |
| Clock, Clock3, Timer, History | clock | |
| CalendarClock | calendar | |
| Flag | flag | |
| Target, CircleDot | target | |
| Circle | ring | |
| TrendingUp | trend | |
| Wifi, Activity (as signal or health) | signal | |
| Save | save | |
| Download, FileDown, ArrowDownToLine | export | |
| Upload | import | |
| Trash2 | trash | |
| Share2 | share | |
| Link2 | link | |
| QrCode | qr | |
| Printer | print | |
| ScanLine | scan | |
| Image, ImagePlus | image | |
| Camera | camera | |
| CameraOff | cameraoff | |
| Video, Film | video | |
| MonitorUp | screen | |
| PhoneOff | hangup | |
| Hand | hand | |
| User | person | |
| Users | people | |
| Bot | bot | |
| SmilePlus | react | |
| LogIn | signin | |
| LogOut | signout | |
| CreditCard, CircleDollarSign | card | |
| Cpu | chip | |
| Server | server | |
| Keyboard | keyboard | |
| Bug | bug | |
| Globe, Languages | globe | |
| Hash | hash | |
| Power | power | |
| Sun | sun | |
| Moon | moon | |
| Map, Route | route | |
| Rocket | send | "get started" |
| Rows3 | menu | |
| PanelRightClose | panelr | |

## Checks before you report
- `grep -rn "lucide-react" <your scope>` returns nothing except the KEEP cases you list.
- `cd web && bunx tsc --noEmit` is clean, and the focused tests for the files you changed pass (`env -u LD_LIBRARY_PATH bun test <files>`).
- You did not change behaviour, labels, accessible names, layout or copy. This is an icon swap.
