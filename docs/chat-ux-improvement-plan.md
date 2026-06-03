# Chat UX Improvement Plan

> Reducing cognitive load and viewport disruption during streaming responses.

## Problem Statement

When content streams in, the DOM grows while the user is reading. The viewport "slides" — the user loses their place mid-paragraph. Instinctively they scroll up to re-anchor. This is worse for:
- Slower readers (reading line 3 while line 15 appears)
- Long reasoning/thinking outputs
- Dense technical content

Additionally, reasoning blocks add visual clutter, and auto-scroll by default fights the user's reading flow.

---

## Goals

1. **Viewport stability** — reading position is never disrupted by new content
2. **Cognitive load reduction** — hide or minimize reasoning/thinking output
3. **Clear affordances** — user knows when new content arrived without clutter
4. **Opt-in streaming speed** — focus mode for users who want paced reading

---

## Feature Set

### 1. Auto-scroll OFF by Default

- User's viewport never auto-snaps to bottom when new content arrives
- Instead, new content accumulates below the fold
- This is the default behavior — no configuration needed

### 2. Hide Reasoning (Session Mode)

- A global toggle: **"Hide reasoning"** for the current session
- Not per-message collapse (already exists) — a session-wide suppress
- Removes thinking/reasoning blocks from rendering entirely
- Useful for users who find reasoning distracting or want faster perceived responses

**States:**
- `show-reasoning` (default) — render reasoning blocks inline, collapsible per-message
- `suppress-reasoning` — reasoning blocks not rendered at all

**UI:** A toggle button in the chat header bar, persists for the session.

### 3. Focus Mode (Slowed Streaming)

- A toggle that slows token emission to roughly match reading speed (~15–30 chars/sec)
- Variable speed: faster for code/markdown, slower for prose
- Addresses the "viewport slides" problem mechanically — if tokens arrive at reading speed, the user's place isn't displaced

**States:**
- `off` (default) — normal streaming speed
- `on` — slowed streaming to reading pace

**UI:** A "Focus mode" toggle in the chat header, with a subtle icon/state indicator when active.

### 4. Jump-to-Bottom Button

- Floating button, bottom-right of the message list
- Only visible when user has scrolled up
- Minimal: small up-chevron or arrow, semi-transparent
- On hover: slightly more visible

**States:**
- `hidden` — user is at bottom of message list
- `visible` — user is scrolled up (regardless of new content)

**Implementation:**
- Detect `isScrolledUp` via `onScroll` handler: `scrollHeight - scrollTop !== clientHeight`
- Show on `isScrolledUp === true`, hide when user scrolls to bottom

### 5. Subtle Content-Below Indicator

- Only appears when content arrives while user is scrolled up
- NOT Discord-style badge (always visible, clutters UI)
- Design: a **thin colored bar at the bottom edge** of the message list — like a notification line, barely visible unless looking for it
- Clicking the bar scrolls to bottom

**States:**
- `hidden` — no new content arrived while scrolled up
- `visible` — new content arrived while scrolled up

**Logic:**
```
scrolledUp = true
newContentArrived = false

// on new token while scrolledUp:
if (scrolledUp && !newContentArrived) {
  showIndicator()
  newContentArrived = true
}

// on scroll to bottom:
newContentArrived = false
hideIndicator()
```

---

## UI Component Sketch

```
ChatPanel
├── ChatHeader
│   ├── [Reasoning toggle: "Hide reasoning" / "Show reasoning"]
│   └── [Focus mode toggle: icon + label]
├── MessageList (scrollable)
│   ├── Message
│   │   └── [Collapsible reasoning + answer]
│   ├── ...more messages...
│   ├── [New content below — thin bar, click to scroll]
│   └── [If scrolled up] → JumpToBottomButton (bottom-right, floating)
└── [Input area]
```

---

## Implementation Phases

### Phase 1: Foundation — Settings Panel + State

**Settings Panel** — add these three toggles to the interface panel (not just chat header), with these defaults:

| Setting | Default | Description |
|---------|---------|-------------|
| `autoScroll` | `false` | User's viewport never auto-snaps |
| `suppressReasoning` | `false` | Hide reasoning blocks entirely |
| `focusMode` | `false` | Slowed streaming to reading pace |

These are persisted in the settings/config, not just session state. Defaults are set to `false` so users opt into the improved behaviors.

**State to add:**
- `autoScroll: boolean`
- `suppressReasoning: boolean`
- `focusMode: boolean`
- `isScrolledUp: boolean` — detected from scroll events
- `newContentArrivedWhileScrolledUp: boolean`

**Files to touch:** `Chat.tsx`, `useKeatingAgent.tsx`, existing settings/config storage

### Phase 2: Jump-to-Bottom Button

- [ ] Implement `isScrolledUp` detection
- [ ] Create `JumpToBottomButton` component — minimal chevron-up icon
- [ ] Wire `scrollToBottom()` on click

**Files:** `SessionSidebar.tsx` or a new `JumpToBottom.tsx` component

### Phase 3: New Content Indicator

- [ ] Track `newContentArrivedWhileScrolledUp` on token arrival
- [ ] Create `ContentBelowIndicator` — thin bar at bottom of message list
- [ ] Wire click to scroll to bottom and dismiss indicator

**Files:** `Chat.tsx` or `QuestionRenderer.tsx`

### Phase 4: Reasoning Suppress Toggle

- [ ] Add toggle button in chat header
- [ ] Filter out reasoning block rendering when `suppressReasoning === true`
- [ ] Persist in session state (not localStorage — session only)

**Files:** `Chat.tsx`, `QuestionRenderer.tsx` (already has collapsible reasoning, add suppress path)

### Phase 5: Focus Mode

- [ ] Add toggle in chat header
- [ ] Implement token throttling in `useKeatingAgent.tsx` — rate-limit token emission when `focusMode === true`
- [ ] Visual indicator when active (subtle, e.g., muted icon state)

**Files:** `useKeatingAgent.tsx`, `Chat.tsx`

---

## Out of Scope (For Now)

- Reading-speed-aware auto-scroll (too complex, needs ML/tracking)
- Per-scroll auto-scroll toggle (covered by auto-scroll default behavior)
- "Reveal on pause" viewport lock (superseded by auto-scroll OFF + slow stream in focus mode)
- Staged reveal / progressive disclosure (different UX paradigm)
- Reader mode (post-response focus mode)

---

## References

- Discord's `↓ New` button (anti-pattern: always visible, clutters UI)
- ChatGPT/Claude jump-to-bottom (good: only visible when scrolled up)
- Linear's minimal dot indicator (good: quiet, non-distracting)
- Read.cv reading progress line (for long-form, not chat — reference only)