#let coverage = json("subject-data.json")
= Subjects covered across the learning record
The retained conversations span technical, scientific, practical, and cultural subjects. Grouping forks and copied histories yields #coverage.metadata.totalFamilies conversation families. Of these, #coverage.metadata.includedFamilies have an identifiable learning topic: #coverage.metadata.discussedFamilies reach subject discussion or practice, and #coverage.metadata.openingOnlyFamilies remain at an opening, clarification, or diagnostic prompt.

#figure(
  image("figures/chart-subject-coverage.svg", width: 100%),
  caption: [Primary subject of each topic-bearing conversation family. Solid segments count discussion or practice; hatched segments count openings. Bar-end labels show their sum. Examples beneath the bars name discussed topics.],
)

*Technical subjects anchor a broader, self-directed curriculum.* Machine learning and software engineering each appear in 12 families. Together with networks, systems, and hardware, they account for 30 of the 46 topic-bearing families (65.2%). The remaining 16 connect learning to biology and physics, practical decisions, society and philosophy, creative interests, and learning itself.

The eight subject areas also contain different stages of participation. Biology and physics reach discussion in all four retained families; music, art, and language include one discussed topic and two openings. The subject map therefore shows both the creator's enacted curriculum and the questions that were still waiting to become fuller lessons.
