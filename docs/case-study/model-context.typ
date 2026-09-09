= The teacher changed with its models
The creator reports that most lessons used MiniMax M2.7 or M3, alongside July use of free OpenRouter models and Mercury diffusion models that was not fully recorded. The creator describes many of these choices as substantially below the frontier available at the time. This makes the case a study of learning with the models available and practical to use during development, across a period of changing model capabilities.

The metadata shows the concentration of MiniMax use: 55 of 81 session objects carry MiniMax labels, including 37 M3, 15 M2.7, and three M2.7-highspeed labels. Saved session configurations and individual response labels differ in 19 session objects. Across the 604 distinct assistant-event fingerprints, 177 carry M3, 173 M2.7, and 20 M2.7-highspeed labels; 13 have no model label. The first set counts saved configurations; the second counts assistant events, including intermediate responses.

The teaching encounter connects three evolving elements: the creator's knowledge, Keating's prompts and tools, and its underlying models. Each encounter records what the creator asked, what that configuration delivered, and how the creator responded.

#let model-card(title, body) = block(width: 100%, inset: 10pt, radius: 3pt, fill: rgb("f2f5f6"), stroke: 0.5pt + rgb("c7d3d8"))[
  #text(size: 10pt, weight: "bold", fill: rgb("254e63"))[#title]
  #v(4pt)
  #text(size: 9pt)[#body]
]
#figure(
  block(width: 100%)[
    #grid(columns: (1fr, 1fr), gutter: 9pt,
      model-card([Creator + learning task], [Prior knowledge, questions, corrections, persistence, and topic difficulty vary.]),
      model-card([Application + model], [Prompts, tools, interfaces, provider routes, and model capabilities vary.]),
    )
    #align(center)[#text(size: 18pt, fill: rgb("254e63"))[↓]]
    #model-card([One situated teaching encounter], [The creator encounters an explanation, assessment, or interactive artifact, then responds, challenges, or repairs it.])
    #align(center)[#text(size: 18pt, fill: rgb("254e63"))[↓]]
    #model-card([Evidence for interpretation], [Dialogue records the exchange. Response labels locate model use; the creator's account and application history provide development context.])
  ],
  caption: [The teaching encounter connects a changing learner, application, and model.],
)

*Useful teaching emerged under the creator's everyday model choices.* The embedding and Scheme exchanges show the creator applying a new distinction to another example. Explanations, concrete reconstructions, questions, and challenges made these lessons productive within the mixed-model setting.

*Model diversity makes verification central to Keating's design.* Faulty code, premature praise, and misread arguments identify concrete requirements across configurations: execute reference examples, probe the learner's reasoning, and check an interpretation before correcting it. The creator repeatedly supplied this repair work during lessons.

*Future comparisons need the configuration that taught each lesson.* Record application and prompt revisions, requested and returned model identities, provider routes, and tool failures. Keep tutor and judge identities separate, and compare similar tasks with recorded assistance and prior exposure.
