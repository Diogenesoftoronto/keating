#let lesson-quotes = json("quote-ledger.json").quotes
#let lesson-excerpt(id) = {
  let q = lesson-quotes.find(item => item.id == id)
  let accent = if q.role == "user" { rgb("254e63") } else { rgb("7b6150") }
  block(width: 100%, breakable: false, inset: (x: 11pt, y: 8pt),
    fill: if q.role == "user" { rgb("f1f5f7") } else { rgb("f7f3ef") },
    stroke: (left: 2pt + accent))[
    #text(size: 8pt, weight: "bold", fill: accent)[#q.speaker · #q.date · #q.episode / #q.id]
    #v(4pt)
    #set par(justify: false, leading: 0.45em)
    #text(size: 10.5pt)[“#text(q.quote)”]
  ]
}

= Voices from the lessons: reasoning together
These excerpts preserve the participants' wording, including spelling and numerical slips. Each block is a contiguous passage; intervening turns are not shown. Quote IDs locate the exact message and text span in `case-study/quote-ledger.json`.

== From output shape to a new inference
The static-embedding lesson begins with the creator insisting that the encoder merges tokens into one vector. After Keating separates encoder output from pooling, the creator revises that account:

#lesson-excerpt("Q1")

The creator then connects the lookup-table architecture to its training cost:

#lesson-excerpt("Q2")

The row-count distinction has changed, despite the numerical slip in Q1. The later observation goes beyond naming the architecture: the creator reasons about a computational consequence. The exchange contains both conceptual correction and a new inference.

== The learner repairs the tutor's judgment
In the policy-gradient lesson, Keating treats a claim about Comedy's declining share of recommendations as a mistaken claim about its logit update. The creator clarifies the quantity they mean:

#lesson-excerpt("Q6")

#lesson-excerpt("Q7")

The creator's objection restores the distinction between an absolute score and a relative probability. The useful feedback runs in both directions: the tutor explains unfamiliar notation, and the creator corrects its reading of their answer.

#pagebreak()
= Voices from the lessons: checking understanding
== A correct option, a mastery claim, and an unresolved mechanism
At the start of the Vulkan diagnostic, the creator explains how they selected the answer:

#lesson-excerpt("Q3")

Keating closes with a list of ideas the creator now owns, including the four performance levers and AMD's async-compute behavior. It explains its judgment through the creator's cooking analogy:

#lesson-excerpt("Q4")

Later in the same lesson, the creator identifies what remains opaque:

#lesson-excerpt("Q5")

The creator makes the diagnostic problem unusually explicit. First, answer wording supplies a cue; later, familiar technical language still conceals an unexplained process. Their own analogy represents progress, but the tutor's mastery claim closes the assessment before those remaining gaps are resolved.

== Returning to an unfinished lesson
About 17 days after the initial SwiReasoning exchange, the creator chooses to start from the ground up. Asked to reconstruct the central claim, they respond:

#lesson-excerpt("Q8")

The return makes continuity concrete: an earlier lesson plan exists, but the creator has only a fragment of the idea available. A useful resumption needs the unresolved concept and a new explanation from the learner. Retrieving the saved artifact alone does not provide that stopping point.
