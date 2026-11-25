<!-- Model-facing schema for `EvidenceBoard`, injected into the turn directive only when the affordance table picks it. Source: web/.keating-mockups/CATALOGUE.md (ids renamed to OpenUI names). -->

## `EvidenceBoard` (kind `evidence-board`): link sentences to claims, or rebuild a draft against a rubric

Write it in an openui fence as `EvidenceBoard(title, config, brief?)`, positional: `title` is the card heading string, `config` the object below (plain JSON values; quoted or bare keys both parse), `brief` optional one-line Markdown framing. One component per reply; keep the prose to one or two sentences that say what to drag and what to watch, then stop and wait for the learner's share.

**Teaches:** reading evidence closely. **link** mode: the learner drags a sentence (or sweeps several) of a
passage onto a claim and drops it on *Backs it*, *Partly* or *Undercuts*; each link is judged with a reason,
and missed key evidence is listed. Traps such as correlation-as-causation, an anecdote, a dropped hedge or a
quote out of context are named. After Check each link gets ✓ / ≈ / ✗ and a one-line verdict; the reasons and
`verdict` sit behind a "Why" disclosure. **revise** mode: the learner **builds a better draft by moving
sentences**. Their draft starts as `drafts[0]`; they drag lines in from `drafts[1]` and the `spares` (drop
between lines to insert, on a line to replace it), drag a line out to cut it, or reorder. The rubric under
the draft scores it live, previews the result mid-drag, and names the sentence(s) that decide each row.

**Choose it for:** "This headline says X. Does the article back that up?", "Is this source reliable about
its author's factory?", "Which of these sentences supports my thesis?", "My revised conclusion is better,
right? Why?" (revise), "How can I make this paragraph more persuasive?" (revise), "Does this ad's evidence
support its claim?"

**Not for:** sorting standalone items into categories (`SortBoard` bins). Numeric data the learner should
regroup (`DataExplorer`). "What is a primary source?" (prose). Very long texts: 40 spans at most, so excerpt.

**Config** (`EvidenceBoardConfig`):

```ts
type EvidenceBoardConfig = {
  title: string;                                       // ≤ 200 chars
  instructions?: string;
  gaps?: Record<string, { name: string; reply: string }>;  // reasoning gaps; name ≤ 120 chars
  perfectReply?: string;
} & (
  | { mode: "link";
      passage: { headline?: string; source?: string;
                 paragraphs: (string | PassageSpan[])[] };   // 1–8 paragraphs, ≤ 40 spans in all
      claims: EvidenceClaim[] }                               // 1–6
  | { mode: "revise";
      drafts: Draft[];                  // exactly 2: [0] the learner's starting draft, [1] a revision to borrow from
      spares?: PassageSpan[];           // 0–6 extra lines to borrow (a better claim, a distractor)
      levels: { id: string; label: string }[];                // 2–4, low → high; label ≤ 30 chars
      rubric: RubricCriterion[];                              // 2–5
      marks: SentenceMark[];            // what each line does to each row (required; non-empty)
      clashes?: SentenceClash[];        // two lines that, together, cap a row
      maxSentences?: number;            // longest draft allowed, integer 2–10, default 6
      reference?: ReferenceRating[] }   // LEGACY, used only when `marks` is absent; don't author it
);
type PassageSpan = { id: string; text: string };             // id /^[A-Za-z][\w-]{0,39}$/
type EvidenceClaim = { id: string; text: string;             // text ≤ 300 chars
                       verdict?: string; links: EvidenceLink[] };
type EvidenceLink = {
  spanId: string;                                            // an existing span id
  relation: "supports" | "partial" | "contradicts" | "irrelevant";
  why: string;                                               // the reason shown when judged
  gap?: string;                                              // a key of `gaps`
  key?: boolean;   // list as "missed" if not attached; default true for supports/contradicts, false otherwise.
                   // Never set it on an irrelevant link: there is no "irrelevant" drop zone to satisfy it.
};
type Draft = { id: string; label: string; sentences: PassageSpan[] };  // label ≤ 80; 1–12 sentences, text ≤ 600;
                                                  // line ids unique across both drafts AND spares
type RubricCriterion = { id: string; name: string;                     // name ≤ 60
                         descriptors: Record<string, string>;          // one per level id, ≤ 300 chars
                         combine?: "weakest" | "strongest";            // default weakest: one weak line drags the row
                                                                       // down (an overclaim); strongest: the best line
                                                                       // carries it (an objection answered)
                         absent?: string;                              // level when no line in the draft bears on the
                         absentWhy?: string };                         // row; default lowest. Use the top level for rows
                                                                       // like Clarity that are fine until something breaks them
type SentenceMark = { sentence: string; criterion: string; level: string;   // one mark per line × row at most
                      why: string; gap?: string; reply?: string };
type SentenceClash = { sentences: [string, string];   // two different line ids
                       criterion: string; level: string; why: string; gap?: string; reply?: string };
type ReferenceRating = { criterion: string; draft: string; level: string; why: string;   // legacy only
                         sentences: string[]; gap?: string; reply?: string };
```

**Spans: give them explicitly.** A string paragraph is split into sentences automatically, with ids
`p1s1, p1s2, …` (paragraph, sentence, counting from 1). The split handles decimals, common abbreviations,
initials and quotes, but any edit to the text shifts every later id, and "U.S. Senate"-style endings are
ambiguous. Use `PassageSpan[]` paragraphs whenever any link points into that paragraph, and give each span its leading space
(`" They…"`) so the text joins naturally. Cut a span at the clause that matters (e.g. "We can't say" |
"coffee itself is responsible"): the learner can only pick whole spans.

Judging: spans not listed in a claim's `links` count as irrelevant to it. The drop zones are only Backs it,
Partly and Undercuts, so an `irrelevant` link's `why` is shown when the learner attaches that span anyway
(that is where traps such as an anecdote belong). `why`, `reply` and `perfectReply` may be up to 2000
chars; keep them to one or two sentences. When an attachment covers several
spans, agreeing relevant spans give their relation, disagreeing ones give `partial`, and irrelevant extras
add a "trim it" note. Ids for claims, drafts, levels and criteria also follow `/^[A-Za-z][\w-]{0,39}$/`.
The share reply quotes the top reasoning gap's full `reply` and the first two sentences of a second gap's,
so **keep the first two sentences of every gap `reply` self-contained**.

**Revise scoring:** an empty draft gets the lowest level on every row. Otherwise each row combines the marks
of the lines in the draft (`weakest` or `strongest`); a row with no marked line gets `absent`; any clash
whose two lines are both present caps the row at the clash's level. Mark every line that bears on a row,
distractors included, and put the teaching in `why` and `reply`. **Make sure some draft of ≤ `maxSentences`
lines reaches the top level on every row** (otherwise the learner can never finish). Use clashes for a hedge
later undone ("the hypothesis was correct"), for repeats, and for weak evidence that muddies strong evidence.

**Minimal example** (link):

```openui lifecycle=ephemeral id=does-the-report-back-its-headline
root = LearningSurface([reply])
reply = EvidenceBoard("Does the report back its headline?", {"mode": "link", "title": "Does the report back its headline?", "passage": {"headline": "Phones ruin sleep", "paragraphs": [[{"id": "s1", "text": "Teens who used phones after 10 pm slept 40 minutes less on average."}, {"id": "s2", "text": " The survey could not tell whether phone use caused the lost sleep."}]]}, "claims": [{"id": "c1", "text": "Phones cause teens to sleep less.", "links": [{"spanId": "s1", "relation": "partial", "why": "It shows a link, not a cause."}, {"spanId": "s2", "relation": "contradicts", "why": "The authors say they can't show cause."}]}]})
```

**Minimal example** (revise):

```openui lifecycle=ephemeral id=make-the-argument-stronger
root = LearningSurface([reply])
reply = EvidenceBoard("Make the argument stronger", {"mode": "revise", "title": "Make the argument stronger", "drafts": [{"id": "first", "label": "First draft", "sentences": [{"id": "a1", "text": "Homework is useless."}, {"id": "a2", "text": "Everyone I know hates it."}]}, {"id": "second", "label": "Revision", "sentences": [{"id": "b1", "text": "Homework does little for young pupils' test scores."}, {"id": "b2", "text": "A large 2006 review found almost no link between homework and achievement before secondary school."}]}], "levels": [{"id": "weak", "label": "Weak"}, {"id": "strong", "label": "Strong"}], "rubric": [{"id": "claim", "name": "Claim", "descriptors": {"weak": "Says more than the evidence can.", "strong": "Says exactly what the evidence shows."}}, {"id": "evidence", "name": "Evidence", "combine": "strongest", "descriptors": {"weak": "Opinion or anecdote.", "strong": "A measured result about the claim."}}], "marks": [{"sentence": "a1", "criterion": "claim", "level": "weak", "why": "\"Useless\" for everyone goes far beyond any study."}, {"sentence": "b1", "criterion": "claim", "level": "strong", "why": "It limits the claim to young pupils and test scores."}, {"sentence": "a2", "criterion": "evidence", "level": "weak", "why": "How people feel about homework says nothing about what it does."}, {"sentence": "b2", "criterion": "evidence", "level": "strong", "why": "A review of many studies is measured evidence about exactly this claim."}]})
```
