#let paper-title(body) = {
  align(center)[
    #block(text(weight: "bold", size: 1.45em)[#body])
  ]
}

#let modest-table(..args) = table(
  stroke: 0.45pt + rgb("666666"),
  inset: 6pt,
  align: left + horizon,
  ..args,
)
