# Subject coverage coding

`subject-data.json` supplies the subject-coverage figure. Its unit is a retained,
topic-bearing conversation family. Each family receives one primary subject, so
the category bars add to **46 families**. The analysis covers the full portable
archive, rather than only the eleven sessions selected for the qualitative
findings.

## Source and scope

The source is the September 6 portable export used throughout the case study:

`329ec5856aaa3cc0cdd3b3a9e8311aa885e27b728a5ab14bf804fe5b1bc7656e`

The SHA-256 matches the portable entry in `aggregates.json`. It was checked again
after analysis; the input was unchanged. The training ZIP is a derivative archive
and contributes no additional conversations to this subject count.

Coding used saved titles, visible learner/tutor text, and relevant lesson or quiz
artifacts. Titles were treated as navigation aids: generic titles and potential
topic changes were inspected in the dialogue. Structured thinking blocks and
tagged `<think>`/`<thinking>` spans were excluded from the visible-history
comparison. The public ledger contains hashed identifiers and general topic
labels, without transcript text, account information, or learner responses.

## Family construction

1. Start with all **81 unique session objects**. Follow each `parentSessionId`
   through its ancestry. The **18 non-self parent links** produce **63 families**.
   One record points to itself; it is treated as a root, not an extra edge. All
   parent targets exist. No other cycles occur.
2. Join copied histories that lack a usable parent link. An event match requires
   the same role, numeric timestamp, and visible text. Require at least four
   matching dated events, including learner and tutor events. There are six such
   joins: five copies of the city-formation history and one copy of the Vulkan
   history. Each city copy shares 23 dated visible events with the linked city
   family; the Vulkan copy shares 39 with its linked family.
3. Apply one documented missing-timestamp exception. The unlinked OpenZiti fork
   has no message timestamps, but its **entire ordered sequence of 23 nonempty
   visible learner/tutor turns** is identical, role for role and text for text,
   to the dated OpenZiti thread. This is joined as a copy. The exception requires
   the complete sequence, at least ten turns, and multiple turns from both roles.
   Untimed greetings or similar topic titles alone are never grounds for a join.

The seven copied-history joins reduce 63 linked families to **56 retained
conversation families**. Separate visits to the same subject remain separate
families when they do not share this lineage. For example, the later
SwiReasoning revisit and the original discussion each count once.

The JSON records all 18 parent edges and seven copied-history joins under
`lineage`, including hashes of both endpoints, match rules, and event counts.
Every session appears in exactly one family.

## Inclusion and stage

Ten families have no retained learner-selected subject discussion or request:

| Excluded family type | Families |
| --- | ---: |
| Greetings and workspace checks | 8 |
| Project-access repair only | 1 |
| Generic tool demonstration without a learner-selected subject | 1 |
| **Total excluded** | **10** |

This leaves **46 topic-bearing families**, divided into two stages:

- **Discussion or practice (32):** the conversation moves beyond its initial
  framing and diagnosis into an explanation, worked example, conceptual
  comparison, learner reconstruction, or subject practice and feedback.
- **Opening only (14):** the subject is requested, but the retained conversation
  stops at introductory framing, diagnosis, scope clarification, unavailable
  source access, or a promised lesson/quiz. Short diagnostic hints or an opening
  equation do not by themselves make this a developed subject discussion.

The distinction is about how far the recorded interaction proceeds. It does not
score the correctness of a lesson, certify completion, or estimate learning
time or mastery. Each included family has `stage: "discussed"` or
`stage: "opening-only"`; the figure uses the longer reader-facing labels above.

## Primary-subject decisions

Subject assignment is a manual reading of the learning objective and the
retained exchange. One primary category per family keeps the denominator
additive. Where subjects intersect, the category follows the main object of
inquiry: writing-evaluation models, synthetic data, compute economics, and
Bradley–Terry ranking are grouped with AI; understanding AI coding through the
history of compilers is grouped with software engineering. Protein binders and
antibodies are grouped with biology even when AI research motivates the lesson.

The following cases prevent a title-only count from describing the archive
correctly:

- A tools-tour thread later contains a completed phylogenetic-tree quiz and
  feedback. Its primary learning subject is **phylogenetic trees**, under biology.
- A greeting-titled thread develops into **email protocols and delivery**, and
  another into **functional-language selection**. Both are included.
- The free-will thread includes an explanation of the argument structure as well
  as repeated map repairs. It remains a philosophy discussion.
- The uncommitted-changes thread never reaches the requested code examination;
  its visible work concerns inaccessible project files. It is excluded as an
  access-repair episode.
- A generic quiz-tool test contains an attempted tutor-selected topic and no
  returned quiz. It is excluded. A separate request explicitly selects **Guile
  debugging**, but ends before a quiz is returned; it is included as opening only.
- The TypeScript-tool thread briefly requests a biosphere visualization, then
  explicitly returns to its original subject. No biosphere lesson develops, so
  the family retains its TypeScript primary topic.
- Household budgeting, memory biases, Canadian lawmaking, 3D rigging, and New
  York slang appear in the archive even where the interaction remains at its
  opening. Their presence is shown without treating those openings as developed
  lessons.

## Figure data

| Primary subject | Discussion or practice | Opening only | Total families |
| --- | ---: | ---: | ---: |
| Machine learning & AI | 9 | 3 | 12 |
| Software engineering | 9 | 3 | 12 |
| Networks, systems & hardware | 4 | 2 | 6 |
| Business, finance & civics | 2 | 2 | 4 |
| Biology & physics | 4 | 0 | 4 |
| Humanities & social sciences | 2 | 1 | 3 |
| Music, art & language | 1 | 2 | 3 |
| Learning & pedagogy | 1 | 1 | 2 |
| **Total** | **32** | **14** | **46** |

Each `subjects` record includes `count`, `discussedCount`, `openingOnlyCount`,
`discussedTopics`, and `openingOnlyTopics`. The combined `topics` array lists
discussed topics before opening-only topics. `representativeTopics` selects
discussion/practice examples for the figure, linking its labels to the paper's
episodes and showing both biology and physics. Topic labels provide examples;
they are not an independently summed measure of breadth.

## Audit and reproduction

Session hashes are full SHA-256 hashes of the source session ID. A family hash
is SHA-256 of `keating-case-study-subject-family-v1`, a NUL separator, and the
family's lexically sorted source session IDs joined by NUL separators. This
lets an auditor with the same local export map every coding decision back to
its source without publishing raw session identifiers or dialogue.

To reproduce the structural checks, load the portable source, hash its session
IDs, and compare their set with the union of all ledger `sessionHashes`. Check
that these sets are equal and that no ledger hash appears twice. Resolve source
parent links and compare them with `lineage.parentLinks`; then verify each
exact-history join with the rules above. For each ledger entry, match its
`anchorSessionHash` to the local source for the manual coding review. Regenerate
each category count by summing included family assignments, with stage counts
from the `stage` field.

Verified invariants: 81 unique session objects accounted for exactly once;
56 families each assigned once; 46 included plus 10 excluded; eight subject
counts sum to 46; 32 discussion/practice plus 14 opening-only families sum to 46;
all parent references resolved; no non-self ancestry cycles; portable hash
unchanged. These are deterministic data checks, with no hosted model calls.
