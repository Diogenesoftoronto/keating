#set page(paper: "us-letter", margin: (x: 1in, y: 1in))
#set text(font: "New Computer Modern", size: 10.5pt)
#set par(justify: true, leading: 0.62em)

#show heading.where(level: 1): set text(weight: "bold", size: 1.15em)
#show heading.where(level: 2): set text(weight: "bold", size: 1.03em)
#show heading.where(level: 3): set text(weight: "bold", size: 0.98em)

#import "study/preamble.typ": paper-title, modest-table

#include "study/frontmatter.typ"
#include "study/sections/introduction.typ"
#include "study/sections/metaharness.typ"
#include "study/sections/results.typ"
#include "study/sections/discussion.typ"
#include "study/sections/methods.typ"
#include "study/sections/limitations.typ"
#include "study/sections/availability.typ"

#v(1.2em)

#bibliography("refs.bib", style: "apa")
