// Authored practice lessons for Recess, also used as fallback packs when chat compilation is unavailable.
//
// thread: {me} learner message, {k} tutor prose, {code} formula or code block.
//   {spin:text} {worm:text} {myth:text} mark the words an enemy peels off from.
// drift: small symbols carried by drifters. spin: label on the spinner.
// split: [whole, half, half]. dart: label on the charger. worm: one character per segment.
// myths: wrong statement and its correction. gates: question, then the right answer first.
// wall: the boss's lines. tldr: the one line left when the wall falls.
export const packs = {
  maths: {
    label: "Maths", title: "Chain rule, slowly", meta: "calculus · 31 turns",
    thread: [
      { me: "I keep getting d/dx sin(2x) wrong. Why isn't it just cos(2x)?" },
      { k: "Because sin(2x) is a {spin:function inside a function}. The outer one is sin(u), the inner one is u = 2x. The chain rule says: differentiate the outside, keep the inside, then multiply by the derivative of the inside." },
      { code: "{worm:dy/dx = dy/du · du/dx}      d/dx sin(2x) = cos(2x) · 2" },
      { me: "So e^(3x) gives 3e^(3x)?" },
      { k: "Yes. The inside, 3x, contributes the 3. The slip to watch for is treating a product like a sum: {myth:(f·g)′ is not f′·g′}. That one needs the product rule." },
    ],
    names: { drift: "Sign slip", dart: "Runaway power", spin: "Divide-by-zero", split: "Loose fraction", worm: "Chain of rules", myth: "Misconception", wall: "Wall of Text" },
    drift: ["−", "±", "≠", "≈"], spin: "÷0", split: ["a/b", "a", "b"], dart: "xⁿ", worm: "dy/du·du/dx",
    myths: [
      { wrong: "(f·g)′ = f′·g′", right: "(f·g)′ = f′g + fg′" },
      { wrong: "√(a+b) = √a + √b", right: "√(a+b) ≠ √a + √b" },
      { wrong: "(x+y)² = x² + y²", right: "(x+y)² = x² + 2xy + y²" },
    ],
    gates: [
      { q: "d/dx sin(2x) = ?", a: ["2cos(2x)", "cos(2x)", "−2cos(2x)"] },
      { q: "d/dx e³ˣ = ?", a: ["3e³ˣ", "e³ˣ", "3x·e³ˣ⁻¹"] },
    ],
    wall: ["It is important to note that, in general, when", "one considers the derivative of a composite", "function, which is to say a function of another", "function, it follows, as was shown previously,", "that the rate of change of the whole depends on", "both rates, as we will now explain at length…"],
    tldr: "Differentiate the outside, then multiply by the inside's derivative.",
  },
  chemistry: {
    label: "Chemistry", title: "Why burning gives off heat", meta: "bond energy · 14 turns",
    thread: [
      { me: "Why does burning methane give off heat if you have to break bonds first?" },
      { k: "Breaking bonds always takes energy in. Forming bonds always gives energy out. Methane burns hot because the new bonds in CO₂ and H₂O give out more than it cost to pull the {spin:unstable old bonds} apart." },
      { code: "{worm:CH₄ + 2O₂ → CO₂ + 2H₂O}      1 C · 4 H · 4 O on each side" },
      { me: "So a catalyst just makes that cheaper?" },
      { k: "It lowers the energy needed to get started. And despite what people say, {myth:a catalyst is not used up}: it comes out the other side unchanged." },
    ],
    names: { drift: "Stray electron", dart: "Loose proton", spin: "Unstable nucleus", split: "Water splitter", worm: "Polymer chain", myth: "Misconception", wall: "Wall of Text" },
    drift: ["e⁻", "δ⁺", "δ⁻", "e⁻"], spin: "²³⁵U", split: ["H₂O", "H₂", "O"], dart: "H⁺", worm: "CH₂CH₂CH₂CH₂",
    myths: [
      { wrong: "A catalyst is used up", right: "A catalyst is not used up" },
      { wrong: "Breaking bonds releases energy", right: "Breaking bonds takes energy in" },
      { wrong: "Atoms are destroyed in a reaction", right: "Atoms are only rearranged" },
    ],
    gates: [
      { q: "2H₂ + O₂ → ?", a: ["2H₂O", "H₂O", "H₂O₂"] },
      { q: "Breaking a bond…", a: ["takes energy in", "gives energy out", "does neither"] },
    ],
    wall: ["In order to understand combustion it is first", "necessary to appreciate that, broadly speaking,", "every chemical process whatsoever involves both", "the cleavage and the formation of bonds, each", "of which has an associated enthalpy term that", "must be considered in turn, as follows below…"],
    tldr: "New bonds give out more energy than the old ones cost to break.",
  },
  coding: {
    label: "Coding", title: "Where did my 5 go?", meta: "python loops · 9 turns",
    thread: [
      { me: "My loop prints 0 to 4 but I asked for range(5). Where's the 5?" },
      { k: "range(5) counts five numbers starting at 0, so it stops at 4. The stop value is never included. Careful with {spin:while True} too: without a break it never stops at all." },
      { code: "{worm:for i in range(5):} print(i)      # 0 1 2 3 4" },
      { me: "And b = a copies the list?" },
      { k: "No. {myth:b = a does not copy the list}. It gives the same list a second name. Use b = a.copy() when you want a new one." },
    ],
    names: { drift: "Stray symbol", dart: "None pointer", spin: "Infinite loop", split: "Merge conflict", worm: "Traceback", myth: "Misconception", wall: "Wall of Text" },
    drift: [";", "{ }", "==", "//"], spin: "while", split: ["<<>>", "<<", ">>"], dart: "None", worm: "Traceback",
    myths: [
      { wrong: "b = a copies the list", right: "b = a names the same list" },
      { wrong: "range(5) includes 5", right: "range(5) stops at 4" },
      { wrong: "Lists start at index 1", right: "Lists start at index 0" },
    ],
    gates: [
      { q: "range(3) gives…", a: ["0, 1, 2", "1, 2, 3", "0, 1, 2, 3"] },
      { q: "len([3, 1, 4]) is…", a: ["3", "2", "4"] },
    ],
    wall: ["Before we can discuss the for statement it is", "worth reviewing, in some detail, the history of", "iteration protocols in general, beginning with", "the iterator object, the iterable, the sentinel,", "and the many ways in which these interact, as", "the following eleven sections will make clear…"],
    tldr: "range(n) starts at 0 and stops before n.",
  },
  music: {
    label: "Music", title: "Dots and beats", meta: "rhythm · 12 turns",
    thread: [
      { me: "Why is a dotted half note three beats?" },
      { k: "A dot adds half of the note's own value. A half note is two beats, half of that is one, so a dotted half note lasts three beats. Keep a {spin:steady pulse} while you count it." },
      { code: "{worm:♩ ♩ ♩ ♩  |  half. = 2 + 1}      three beats in 4/4" },
      { me: "And an octave is eight notes, so eight semitones?" },
      { k: "Eight letter names, but twelve semitones. A common slip: {myth:an octave is not eight semitones}. Count the black keys too." },
    ],
    names: { drift: "Wrong note", dart: "Accidental", spin: "Runaway metronome", split: "Broken chord", worm: "Arpeggio", myth: "Misconception", wall: "Wall of Text" },
    drift: ["♪", "♭", "♩", "♪"], spin: "♩=208", split: ["♫", "♪", "♪"], dart: "♯", worm: "arpeggio",
    myths: [
      { wrong: "An octave is eight semitones", right: "An octave is twelve semitones" },
      { wrong: "A dot adds one beat", right: "A dot adds half the note's value" },
      { wrong: "3/4 means three-quarter speed", right: "3/4 means three beats in a bar" },
    ],
    gates: [
      { q: "Semitones in an octave?", a: ["12", "8", "7"] },
      { q: "Beats in a dotted half note?", a: ["3", "2½", "4"] },
    ],
    wall: ["Rhythmic notation, as it has come down to us,", "is the product of a long and gradual process of", "refinement, such that any account of the dotted", "note must, of necessity, begin with mensural", "practice and proceed, by stages, through each", "subsequent reform, which we now do in order…"],
    tldr: "A dot adds half of the note's own length.",
  },
  biology: {
    label: "Biology", title: "Two cells or four?", meta: "cell division · 17 turns",
    thread: [
      { me: "Does mitosis make four cells?" },
      { k: "Mitosis makes two cells, each with the same DNA as the parent. Meiosis is the one that ends with four. Before either, the {spin:DNA is copied} once, so every new cell gets a full set." },
      { code: "{worm:1 cell → mitosis → 2 cells}      same DNA in both" },
      { me: "And plants don't need to respire because they photosynthesise?" },
      { k: "They do both. It is a common slip to think {myth:plants do not respire}. Photosynthesis stores energy in sugar; respiration releases it, day and night." },
    ],
    names: { drift: "Loose molecule", dart: "Phage", spin: "Virus", split: "Dividing cell", worm: "DNA strand", myth: "Misconception", wall: "Wall of Text" },
    drift: ["O₂", "CO₂", "ATP", "RNA"], spin: "virus", split: ["cell", "cell", "cell"], dart: "phage", worm: "ATCGGCTAAT",
    myths: [
      { wrong: "Plants do not respire", right: "Plants respire day and night" },
      { wrong: "Mitosis makes four cells", right: "Mitosis makes two cells" },
      { wrong: "All bacteria cause disease", right: "Most bacteria are harmless" },
    ],
    gates: [
      { q: "Cells after one mitosis?", a: ["2", "4", "1"] },
      { q: "Plants respire…", a: ["day and night", "only at night", "never"] },
    ],
    wall: ["The cell cycle, considered in its entirety, may", "be divided into a number of phases and, within", "those, sub-phases, each of which is regulated by", "checkpoints whose molecular basis, though it is", "beyond our scope, should nonetheless be borne", "in mind throughout the pages that now follow…"],
    tldr: "Mitosis: one cell becomes two with the same DNA.",
  },
  business: {
    label: "Business", title: "Sold more, have less", meta: "cash and profit · 11 turns",
    thread: [
      { me: "We sold more this month but the bank balance went down. How?" },
      { k: "Because profit and cash are different things. Profit counts a sale when you make it. Cash only moves when the customer pays. Sell on 30-day terms and the profit is this month, the cash next month. That gap is your {spin:working capital}." },
      { code: "{worm:cash in − cash out = cash flow}      profit ≠ cash" },
      { me: "And if I mark up by 50%, my margin is 50%?" },
      { k: "No, and it is a costly slip: {myth:markup is not margin}. A 50% markup on a £10 cost sells at £15, and £5 out of £15 is a 33% margin." },
    ],
    names: { drift: "Rounding error", dart: "Crash", spin: "Pie chart", split: "Merger", worm: "Supply chain", myth: "Misconception", wall: "Wall of Text" },
    drift: ["£", "%", "0.5", "−"], spin: "Q4", split: ["M&A", "M", "A"], dart: "↓", worm: "supplychain",
    myths: [
      { wrong: "Markup is the same as margin", right: "50% markup is a 33% margin" },
      { wrong: "Profit means cash in the bank", right: "Profit and cash are different" },
      { wrong: "Revenue is profit", right: "Profit is revenue minus costs" },
    ],
    gates: [
      { q: "Cost £10, price £15. Margin?", a: ["33%", "50%", "67%"] },
      { q: "Revenue minus costs is…", a: ["profit", "cash flow", "turnover"] },
    ],
    wall: ["Going forward, and with a view to leveraging our", "core competencies across all key verticals, it is", "imperative that stakeholders align on a holistic,", "end-to-end framework for value creation, subject", "always to the caveats set out in appendix nine,", "which we will now walk through slide by slide…"],
    tldr: "Profit is counted when you sell. Cash moves when you are paid.",
  },
  literature: {
    label: "Literature", title: "Like, or is?", meta: "figurative language · 8 turns",
    thread: [
      { me: "Is “her smile was like sunshine” a metaphor?" },
      { k: "That one is a simile, because it compares with the word “like”. A metaphor drops the comparison word and says one thing is another: “her smile was sunshine”. Both are {spin:figurative language}." },
      { code: "{worm:simile: X is like Y}      metaphor: X is Y" },
      { me: "And the theme is just what happens in the story?" },
      { k: "What happens is the plot. A common slip: {myth:the theme is not the plot}. The theme is what the story says about its subject, the idea underneath the events." },
    ],
    names: { drift: "Comma splice", dart: "Cliffhanger", spin: "Plot twist", split: "Split infinitive", worm: "Run-on sentence", myth: "Misconception", wall: "Wall of Text" },
    drift: [",", ";", "’", "…"], spin: "twist", split: ["to·go", "to", "go"], dart: "?!", worm: "andthenandthen",
    myths: [
      { wrong: "The theme is the plot", right: "The theme is the idea under the plot" },
      { wrong: "A simile says X is Y", right: "A simile says X is like Y" },
      { wrong: "The narrator is the author", right: "The narrator is a voice the author made" },
    ],
    gates: [
      { q: "“Time is a thief” is a…", a: ["metaphor", "simile", "pun"] },
      { q: "Who tells a first-person story?", a: ["the narrator", "the author", "the reader"] },
    ],
    wall: ["It was, as indeed it had ever been, and as it would", "doubtless continue to be for as long as memory,", "that fickle and inconstant companion of our days,", "should consent to serve, a morning of the kind", "that defies, or seems to defy, every attempt at", "description, though we shall attempt it anyway…"],
    tldr: "A simile says “like”. A metaphor says “is”.",
  },
  history: {
    label: "History", title: "Who wrote this, and when?", meta: "sources · 15 turns",
    thread: [
      { me: "Is a textbook a primary source?" },
      { k: "Usually not. A primary source comes from the time itself: a letter, a law, a photograph, a diary. A textbook written later, using those, is a secondary source. Either can be biased, so always ask {spin:who made it and why}." },
      { code: "{worm:1066 → 1215 → 1492 → 1789}      get the order before the dates" },
      { me: "And people in the Middle Ages thought the Earth was flat, right?" },
      { k: "That is a much later story. {myth:medieval scholars did not think the Earth was flat}. Educated people had known it was a sphere since ancient Greece." },
    ],
    names: { drift: "Wrong date", dart: "Anachronism", spin: "Hourglass", split: "Torn treaty", worm: "Timeline", myth: "Misconception", wall: "Wall of Text" },
    drift: ["1066", "BC", "AD", "1492"], spin: "era", split: ["treaty", "tre", "aty"], dart: "→", worm: "1066121514921789",
    myths: [
      { wrong: "Medieval scholars thought Earth was flat", right: "They knew it was a sphere" },
      { wrong: "A textbook is a primary source", right: "A textbook is a secondary source" },
      { wrong: "Napoleon was unusually short", right: "Napoleon was about average height" },
    ],
    gates: [
      { q: "Magna Carta was sealed in…", a: ["1215", "1066", "1492"] },
      { q: "A soldier's diary is a…", a: ["primary source", "secondary source", "textbook"] },
    ],
    wall: ["In order properly to situate the events under", "discussion it will first be necessary to review,", "reign by reign, the dynastic, fiscal, liturgical", "and agrarian circumstances of the preceding four", "centuries, together with their historiography,", "to which the next nine chapters are devoted…"],
    tldr: "Primary sources come from the time. Secondary sources come after.",
  },
  spanish: {
    label: "Spanish", title: "Ser o estar", meta: "español · 22 turns",
    thread: [
      { me: "Why is it “estoy cansado” and not “soy cansado”?" },
      { k: "Spanish has two verbs for “to be”. Ser is for what something is: identity, origin, lasting traits. Estar is for how or where it is right now: moods, states, location. Tired is a state, so it takes {spin:estar}." },
      { code: "{worm:soy · eres · es · somos · sois · son}      ser, present tense" },
      { me: "And “embarazada” means embarrassed?" },
      { k: "Careful, that is a false friend. {myth:embarazada does not mean embarrassed}. It means pregnant. Embarrassed is “avergonzado”." },
    ],
    names: { drift: "Stray accent", dart: "Irregular verb", spin: "Ser or estar", split: "False friends", worm: "Conjugation", myth: "Misconception", wall: "Wall of Text" },
    drift: ["ñ", "¿", "é", "¡"], spin: "estar", split: ["el/la", "el", "la"], dart: "¡!", worm: "soyeresessomos",
    myths: [
      { wrong: "Embarazada means embarrassed", right: "Embarazada means pregnant" },
      { wrong: "“Soy cansado”", right: "“Estoy cansado”" },
      { wrong: "Ser and estar are the same", right: "Ser is what it is, estar is how it is" },
    ],
    gates: [
      { q: "“I am tired” is…", a: ["Estoy cansado", "Soy cansado", "Es cansado"] },
      { q: "“Embarazada” means…", a: ["pregnant", "embarrassed", "barefoot"] },
    ],
    wall: ["The present subjunctive, which must on no account", "be confused with the imperfect subjunctive in -ra", "or its literary variant in -se, is formed, broadly", "speaking and with the forty-one exceptions listed", "overleaf, from the first person singular of the", "present indicative, as the tables below show…"],
    tldr: "Ser is what it is. Estar is how it is right now.",
  },
  french: {
    label: "French", title: "Être ou avoir", meta: "français · 18 turns",
    thread: [
      { me: "Why is it “je suis allé” but “j’ai mangé”?" },
      { k: "Most French verbs build the past with avoir: j’ai mangé, I ate. A small group, mostly verbs of movement or change of state, use être instead: je suis allé, I went. With être the participle agrees with the subject: elle est allée. Learn which {spin:auxiliary} each verb takes." },
      { code: "{worm:je suis · tu es · il est · nous sommes}      être, present tense" },
      { me: "And “actuellement” means actually?" },
      { k: "A false friend. {myth:actuellement does not mean actually}. It means currently. “Actually” is “en fait”." },
    ],
    names: { drift: "Stray accent", dart: "Silent letter", spin: "Nasal vowel", split: "Liaison", worm: "Conjugation", myth: "Misconception", wall: "Wall of Text" },
    drift: ["é", "è", "ç", "ê"], spin: "être", split: ["le/la", "le", "la"], dart: "h", worm: "suisesestsommes",
    myths: [
      { wrong: "Actuellement means actually", right: "Actuellement means currently" },
      { wrong: "“J’ai allé”", right: "“Je suis allé”" },
      { wrong: "The s in “Paris” is spoken", right: "The s in “Paris” is silent" },
    ],
    gates: [
      { q: "“I went” is…", a: ["Je suis allé", "J’ai allé", "Je vais allé"] },
      { q: "“Actuellement” means…", a: ["currently", "actually", "accurately"] },
    ],
    wall: ["The agreement of the past participle, a matter on", "which grammarians have disagreed since at least", "the sixteenth century, depends, as every pupil is", "told, upon the position of the direct object, save", "in the cases, by no means few, where it does not,", "and which the following pages set out in full…"],
    tldr: "Most verbs take avoir. Movement and change of state take être.",
  },
  japanese: {
    label: "Japanese", title: "は is “wa”?", meta: "日本語 · 13 turns",
    thread: [
      { me: "Why is は read “wa” in こんにちは?" },
      { k: "は is normally “ha”. When it is the topic particle it is read “wa”, and こんにちは ends in that particle, so it is “konnichiwa”. The same goes for へ, read “e”, and を, read “o”. These three {spin:particles} keep an old spelling." },
      { code: "{worm:は wa · へ e · を o}      when they are particles" },
      { me: "And あなた is the normal word for “you”?" },
      { k: "It exists, but it is used far less than “you” is in English. {myth:あなた is not the everyday “you”}. People use the person's name with さん, or leave the word out." },
    ],
    names: { drift: "Stray stroke", dart: "Brush", spin: "Ink stone", split: "Compound", worm: "Stroke order", myth: "Misconception", wall: "Wall of Text" },
    drift: ["あ", "い", "う", "え"], spin: "は", split: ["漢字", "漢", "字"], dart: "ー", worm: "こんにちは",
    myths: [
      { wrong: "あなた is the everyday “you”", right: "Use the name with さん, or nothing" },
      { wrong: "こんにちは ends in “ha”", right: "こんにちは ends in “wa”" },
      { wrong: "を is read “wo”", right: "を is read “o”" },
    ],
    gates: [
      { q: "は as the topic particle is read…", a: ["wa", "ha", "ba"] },
      { q: "を as a particle is read…", a: ["o", "wo", "u"] },
    ],
    wall: ["Before attempting even the simplest sentence the", "student must first master, in addition to the two", "syllabaries, the full system of honorific, humble", "and polite registers, the counters for flat, long", "and small objects, and the 2,136 regular-use kanji,", "all of which are covered in the next volume…"],
    tldr: "は, へ and を are read wa, e and o when they are particles.",
  },
  law: {
    label: "Law", title: "Not guilty, or innocent?", meta: "burden of proof · 12 turns",
    thread: [
      { me: "If someone is found not guilty, has the court decided they are innocent?" },
      { k: "Not quite. A criminal court asks one question: has the prosecution proved guilt beyond reasonable doubt? “Not guilty” means that was not proved. The {spin:burden of proof} stays on the prosecution throughout; the accused does not have to prove anything." },
      { code: "{worm:criminal: beyond reasonable doubt}      civil: balance of probabilities" },
      { me: "And a contract has to be written down to count?" },
      { k: "A common belief, but {myth:a contract does not have to be in writing}. Most spoken agreements are binding too. Writing makes them far easier to prove, and a few kinds, such as sales of land, do need it." },
    ],
    names: { drift: "Stray clause", dart: "Objection", spin: "Loophole", split: "Dispute", worm: "Fine print", myth: "Misconception", wall: "Wall of Text" },
    drift: ["§", "¶", "©", "™"], spin: "onus", split: ["A v B", "A", "B"], dart: "obj.", worm: "hereinafter",
    myths: [
      { wrong: "A contract must be in writing", right: "Most spoken agreements are binding" },
      { wrong: "“Not guilty” means proven innocent", right: "“Not guilty” means guilt was not proved" },
      { wrong: "The accused must prove innocence", right: "The prosecution must prove guilt" },
    ],
    gates: [
      { q: "Who must prove a criminal case?", a: ["the prosecution", "the accused", "the judge"] },
      { q: "Civil cases are decided on…", a: ["balance of probabilities", "beyond reasonable doubt", "a show of hands"] },
    ],
    wall: ["WHEREAS the party of the first part, hereinafter", "“the Party”, notwithstanding anything to the", "contrary herein contained and without prejudice", "to the generality of the foregoing, covenants,", "undertakes and agrees, subject always to clauses", "14(b)(iii) to 97 inclusive, as follows, namely…"],
    tldr: "The prosecution must prove guilt. The accused need not prove innocence.",
  },
  politics: {
    label: "Politics", title: "Most votes, or more than half?", meta: "electoral systems · 10 turns",
    thread: [
      { me: "If a candidate gets the most votes, they have a majority, right?" },
      { k: "Only if it is more than half. The most votes is a plurality. With three or more candidates you can win a plurality on 40% while most voters chose someone else. Which rule decides the winner is part of the {spin:electoral system}." },
      { code: "{worm:plurality: the most votes}      majority: more than half" },
      { me: "And the head of state always runs the government?" },
      { k: "In some systems, yes. But {myth:the head of state is not always the head of government}. In a parliamentary system a president or monarch is head of state while a prime minister leads the government." },
    ],
    names: { drift: "Stray ballot", dart: "Veto", spin: "Spin", split: "Coalition", worm: "Filibuster", myth: "Misconception", wall: "Wall of Text" },
    drift: ["✓", "✗", "%", "?"], spin: "spin", split: ["co·alition", "co", "alition"], dart: "veto", worm: "filibuster",
    myths: [
      { wrong: "The head of state always runs the government", right: "In many systems a prime minister does" },
      { wrong: "The most votes is a majority", right: "The most votes is a plurality" },
      { wrong: "A constitution cannot be changed", right: "Most can be amended, by a harder process" },
    ],
    gates: [
      { q: "40%, the most votes of three, is a…", a: ["plurality", "majority", "landslide"] },
      { q: "A parliamentary government is led by…", a: ["the prime minister", "the head of state", "the speaker"] },
    ],
    wall: ["The honourable member will be aware, as indeed the", "whole House is aware, that the matter to which the", "question refers, and to which I shall return in due", "course, is one on which we have been entirely clear,", "and I refer the honourable member to the answer", "I gave some moments ago, which was, namely, that…"],
    tldr: "The most votes is a plurality. More than half is a majority.",
  },
  finance: {
    label: "Finance", title: "Ten plus ten is twenty-one", meta: "compound interest · 16 turns",
    thread: [
      { me: "If I earn 10% a year for two years, that is 20% in total, right?" },
      { k: "A little more. In the second year you earn 10% on the first year's interest as well. £100 becomes £110, then £121, so it is 21%. Interest earning interest is {spin:compound interest}, and over decades it does most of the work." },
      { code: "{worm:100 → 110 → 121 → 133.10}      10% a year, compounded" },
      { me: "And if a fund loses 50% and then gains 50%, I am back where I started?" },
      { k: "No, and it catches many people: {myth:a 50% loss is not undone by a 50% gain}. £100 falls to £50, and 50% of £50 only brings it to £75. It takes a 100% gain to recover." },
    ],
    names: { drift: "Stray percent", dart: "Hidden fee", spin: "Interest rate", split: "Stock split", worm: "Compounding", myth: "Misconception", wall: "Wall of Text" },
    drift: ["%", "¢", "€", "$"], spin: "APR", split: ["2:1", "1", "1"], dart: "fee", worm: "100110121133",
    myths: [
      { wrong: "Lose 50%, gain 50%: back to even", right: "That leaves you 25% down" },
      { wrong: "10% for two years makes 20%", right: "Compounded, it makes 21%" },
      { wrong: "A high return means a safe investment", right: "Higher return usually means higher risk" },
    ],
    gates: [
      { q: "£100 at 10% a year, after two years?", a: ["£121", "£120", "£110"] },
      { q: "Down 50%. Gain needed to recover?", a: ["100%", "50%", "75%"] },
    ],
    wall: ["Past performance is not a reliable indicator of", "future results and the value of investments, and", "any income from them, may fall as well as rise,", "such that investors may not get back the amount", "invested, subject to the charges, levies and fees", "set out in the key information document, page 46…"],
    tldr: "Interest earns interest. A loss needs a bigger gain to undo it.",
  },
};
// every pack knows its own key, so modules can tell subjects apart without relying on the label
// (a compiled pack keeps the subject it was compiled for as its id, and names its toy cast in `cast`)
for (const k of Object.keys(packs)) { const p = packs[k]; if (!p.id) p.id = k; if (!p.cast) p.cast = k; }
