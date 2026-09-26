/**
 * The subject taxonomy, in two levels.
 *
 * `Domain` (see `types.ts`) is the coarse bucket the pedagogy rules key on:
 * a mathematical topic gets sequenced into formalism, a medical one gets its
 * evidence level named, and so on. There are only eleven of those and there
 * should stay only eleven, because each one is a distinct teaching stance and
 * every `Record<Domain, ...>` table has to answer for all of them.
 *
 * `Field` is what a learner actually asks about. "Physics", "ecology" and
 * "astronomy" are one teaching stance but three different subjects, and
 * collapsing them at the point of classification throws away the only signal
 * fine enough to classify with. So fields are classified, families are taught
 * with, and `FIELD_FAMILY` is the one-way map between them. Adding a field
 * costs a single entry here; adding a family costs an arm in every table.
 *
 * This module is pure and dependency-free: it is imported by the CLI core, the
 * web bundle and the nodepod boot files alike.
 */
import type { Domain } from "./types.js";

/** The coarse teaching stance. Alias of `Domain`, named for what it now is. */
export type DomainFamily = Domain;

export const FIELDS = [
  // math
  "mathematics", "statistics",
  // science
  "physics", "chemistry", "biology", "earth-science", "astronomy", "ecology", "geography",
  // code
  "computing", "software-engineering", "data-science",
  // philosophy
  "philosophy", "ethics", "logic",
  // law
  "law",
  // politics
  "politics", "civics", "economics",
  // psychology
  "psychology", "cognitive-science",
  // medicine
  "medicine", "public-health", "nutrition",
  // arts
  "arts", "music", "literature", "film", "architecture",
  // history
  "history", "archaeology",
  // general
  "general", "languages", "life-skills", "business", "sports",
] as const;

export type Field = (typeof FIELDS)[number];

/**
 * Which teaching stance each field inherits.
 *
 * Some of these are judgement calls rather than library classifications.
 * Economics sits under `politics` because rule 16 — competing analytical
 * frameworks, normative claims kept apart from descriptive ones — is exactly
 * how economics should be taught. Geography sits under `science` because the
 * measurement-and-model stance survives both its physical and human halves.
 * `languages`, `life-skills`, `business` and `sports` inherit `general`
 * deliberately: none of the eleven stances improves them, and inventing one
 * would mean inventing pedagogy we have not thought through.
 */
export const FIELD_FAMILY: Record<Field, DomainFamily> = {
  mathematics: "math", statistics: "math",
  physics: "science", chemistry: "science", biology: "science", "earth-science": "science",
  astronomy: "science", ecology: "science", geography: "science",
  computing: "code", "software-engineering": "code", "data-science": "code",
  philosophy: "philosophy", ethics: "philosophy", logic: "philosophy",
  law: "law",
  politics: "politics", civics: "politics", economics: "politics",
  psychology: "psychology", "cognitive-science": "psychology",
  medicine: "medicine", "public-health": "medicine", nutrition: "medicine",
  arts: "arts", music: "arts", literature: "arts", film: "arts", architecture: "arts",
  history: "history", archaeology: "history",
  general: "general", languages: "general", "life-skills": "general",
  business: "general", sports: "general",
};

export function familyOf(field: Field): DomainFamily {
  return FIELD_FAMILY[field];
}

export function isField(value: string): value is Field {
  return Object.hasOwn(FIELD_FAMILY, value);
}

/**
 * Multi-word keys, checked before single words.
 *
 * English compounds put the head noun last and a modifier first, and the
 * modifier is very often the polysemous half. "Memory management" is not
 * psychology and a "wave function" is not code, but a first-matching-word
 * lookup called both wrong. These are the compounds where the parts actively
 * mislead; ordinary compounds are handled by the head-noun rule below.
 */
const PHRASE_FIELDS: Record<string, Field> = {
  "memory-management": "computing", "memory-allocation": "computing", "memory-leak": "computing",
  "cache-memory": "computing", "virtual-memory": "computing",
  "wave-function": "physics", "partition-function": "physics", "work-function": "physics",
  "state-machine": "computing", "machine-learning": "data-science", "machine-translation": "computing",
  "natural-language": "computing", "operating-system": "computing", "type-theory": "logic",
  "game-theory": "economics", "set-theory": "mathematics", "number-theory": "mathematics",
  "graph-theory": "mathematics", "music-theory": "music", "string-theory": "physics",
  "information-theory": "mathematics", "probability-theory": "mathematics",
  "political-economy": "economics", "public-policy": "politics", "civil-rights": "law",
  "civil-war": "history", "cold-war": "history", "world-war": "history",
  "art-history": "history", "natural-history": "biology", "case-law": "law",
  "common-law": "law", "criminal-law": "law", "supply-chain": "business",
  "climate-change": "earth-science", "plate-tectonics": "earth-science",
  "cell-biology": "biology", "molecular-biology": "biology", "cell-membrane": "biology",
  "krebs-cycle": "biology", "citric-acid": "chemistry", "periodic-table": "chemistry",
  "linear-algebra": "mathematics", "abstract-algebra": "mathematics",
  "organic-chemistry": "chemistry", "quantum-computing": "computing",
  "quantum-mechanics": "physics", "classical-mechanics": "physics",
  "public-health": "public-health", "mental-health": "psychology",
  "social-media": "psychology", "human-geography": "geography",
};

/**
 * Single-word keys.
 *
 * Every key is lowercase and hyphen-free; the lookup splits on hyphens, so a
 * multi-word subject belongs in `PHRASE_FIELDS` instead.
 */
const WORD_FIELDS: Record<string, Field> = {
  // mathematics / statistics
  theorem: "mathematics", proof: "mathematics", calculus: "mathematics", algebra: "mathematics",
  geometry: "mathematics", integral: "mathematics", topology: "mathematics",
  derivative: "mathematics", matrix: "mathematics", vector: "mathematics",
  probability: "statistics", statistics: "statistics", regression: "statistics",
  bayes: "statistics", variance: "statistics", distribution: "statistics", sampling: "statistics",
  // physics / astronomy / chemistry
  quantum: "physics", relativity: "physics", gravity: "physics", thermodynamic: "physics",
  entropy: "physics", momentum: "physics", electromagnetism: "physics", optics: "physics",
  particle: "physics", photon: "physics",
  astronomy: "astronomy", galaxy: "astronomy", planet: "astronomy", star: "astronomy",
  cosmology: "astronomy", orbit: "astronomy", telescope: "astronomy",
  chemistry: "chemistry", molecule: "chemistry", reaction: "chemistry", atom: "chemistry",
  isotope: "chemistry", catalyst: "chemistry", oxidation: "chemistry", valence: "chemistry",
  // biology / ecology
  evolution: "biology", cell: "biology", dna: "biology", rna: "biology", gene: "biology",
  genome: "biology", protein: "biology", enzyme: "biology", chromosome: "biology",
  mitosis: "biology", meiosis: "biology", mutation: "biology", photosynthesis: "biology",
  anatomy: "biology", physiology: "biology", organ: "biology", muscle: "biology",
  bone: "biology", cardiovascular: "biology", neuron: "biology", synapse: "biology",
  hormone: "biology", bacteria: "biology", virus: "biology", pathogen: "biology",
  microbiology: "biology", immunology: "biology", antibody: "biology", antigen: "biology",
  ecosystem: "ecology", biodiversity: "ecology", habitat: "ecology", species: "ecology",
  biosphere: "ecology", biome: "ecology", conservation: "ecology",
  // earth science / geography
  geology: "earth-science", tectonic: "earth-science", volcano: "earth-science",
  climate: "earth-science", weather: "earth-science", atmosphere: "earth-science",
  erosion: "earth-science", mineral: "earth-science", ocean: "earth-science",
  geography: "geography", cartography: "geography", urbanization: "geography",
  migration: "geography", topography: "geography",
  // computing
  function: "computing", algorithm: "computing", programming: "computing", code: "computing",
  loop: "computing", variable: "computing", compiler: "computing", recursion: "computing",
  class: "computing", inheritance: "computing", api: "computing", database: "computing",
  pointer: "computing", concurrency: "computing", async: "computing", cache: "computing",
  network: "computing", protocol: "computing", dns: "computing", encryption: "computing",
  testing: "software-engineering", refactoring: "software-engineering",
  architecture: "software-engineering", deployment: "software-engineering",
  versioning: "software-engineering", debugging: "software-engineering",
  neural: "data-science", embedding: "data-science", classifier: "data-science",
  overfitting: "data-science", gradient: "data-science", transformer: "data-science",
  // philosophy / ethics / logic
  epistemology: "philosophy", metaphysics: "philosophy", existentialism: "philosophy",
  ontology: "philosophy", phenomenology: "philosophy", determinism: "philosophy",
  ethics: "ethics", morality: "ethics", utilitarianism: "ethics", deontology: "ethics",
  virtue: "ethics", consent: "ethics",
  logic: "logic", syllogism: "logic", fallacy: "logic", inference: "logic",
  quantifier: "logic", predicate: "logic",
  // law
  court: "law", statute: "law", legal: "law", tort: "law", contract: "law",
  constitution: "law", jurisdiction: "law", precedent: "law", liability: "law",
  // politics / civics / economics
  democracy: "politics", sovereignty: "politics", ideology: "politics",
  geopolitics: "politics", nationalism: "politics", diplomacy: "politics",
  election: "civics", parliament: "civics", governance: "civics", legislature: "civics",
  referendum: "civics", citizenship: "civics", bureaucracy: "civics",
  inflation: "economics", market: "economics", tariff: "economics", gdp: "economics",
  monopoly: "economics", scarcity: "economics", externality: "economics", tax: "economics",
  // psychology / cognitive science
  emotion: "psychology", behavior: "psychology", personality: "psychology",
  motivation: "psychology", anxiety: "psychology", attachment: "psychology",
  conditioning: "psychology", bias: "psychology",
  memory: "cognitive-science", cognition: "cognitive-science", perception: "cognitive-science",
  attention: "cognitive-science", reasoning: "cognitive-science", heuristic: "cognitive-science",
  // medicine
  diagnosis: "medicine", treatment: "medicine", pathology: "medicine", clinical: "medicine",
  pharmacology: "medicine", symptom: "medicine", prognosis: "medicine", surgery: "medicine",
  epidemiology: "public-health", vaccine: "public-health", infection: "public-health",
  antibiotic: "public-health", outbreak: "public-health", screening: "public-health",
  nutrition: "nutrition", vitamin: "nutrition", metabolism: "nutrition",
  diet: "nutrition", calorie: "nutrition", microbiome: "nutrition",
  // arts
  painting: "arts", sculpture: "arts", aesthetic: "arts", drawing: "arts",
  colour: "arts", perspective: "arts", printmaking: "arts",
  music: "music", harmony: "music", rhythm: "music", counterpoint: "music",
  melody: "music", chord: "music", improvisation: "music", tempo: "music",
  poetry: "literature", novel: "literature", metaphor: "literature", narrative: "literature",
  rhetoric: "literature", prose: "literature", theatre: "literature", drama: "literature",
  film: "film", cinematography: "film", montage: "film", screenplay: "film",
  // history / archaeology
  war: "history", empire: "history", revolution: "history", medieval: "history",
  colonial: "history", ancient: "history", civilization: "history", dynasty: "history",
  treaty: "history", renaissance: "history",
  archaeology: "archaeology", excavation: "archaeology", artifact: "archaeology",
  stratigraphy: "archaeology",
  // languages / life skills / business / sports
  grammar: "languages", syntax: "languages", vocabulary: "languages", phonetics: "languages",
  conjugation: "languages", translation: "languages", pronunciation: "languages",
  budget: "life-skills", cooking: "life-skills", savings: "life-skills",
  insurance: "life-skills", mortgage: "life-skills",
  marketing: "business", management: "business", startup: "business",
  negotiation: "business", logistics: "business", accounting: "business",
  training: "sports", endurance: "sports", tactics: "sports", biomechanics: "sports",
};

/** A slug word that carries no subject signal and must not win the head-noun rule. */
const STOPWORDS = new Set([
  "the", "a", "an", "of", "in", "on", "for", "to", "and", "or", "is", "are",
  "how", "why", "what", "does", "do", "with", "from", "by", "at", "as", "its",
]);

/**
 * Best-effort field for a slug, or null when nothing matches.
 *
 * Null is the important return: it is the abstain sentinel that escalates to
 * the embedding tier and then to a judgement. Returning `"general"` here would
 * be a claim — "this topic has no subject" — and would stop the escalation
 * before it started.
 *
 * Adjacent word pairs are checked first, then single words with the **last**
 * match winning. Head-last is right far more often than head-first in English
 * compounds: "quantum computing" is computing, "computational biology" is
 * biology, "music theory" is music.
 */
export function guessField(slug: string): Field | null {
  const words = slug.split("-").filter((word) => word.length > 0);
  if (words.length === 0) return null;

  const whole = words.join("-");
  if (PHRASE_FIELDS[whole]) return PHRASE_FIELDS[whole];

  for (let index = 0; index + 1 < words.length; index += 1) {
    const pair = `${words[index]}-${words[index + 1]}`;
    if (PHRASE_FIELDS[pair]) return PHRASE_FIELDS[pair];
  }

  let last: Field | null = null;
  for (const word of words) {
    if (STOPWORDS.has(word)) continue;
    const field = WORD_FIELDS[word];
    if (field) last = field;
  }
  return last;
}

/**
 * One sentence per field, embedded once and compared against the learner's
 * topic when a keyword lookup abstains.
 *
 * These are prose rather than bare labels because the embedding of a single
 * word like "film" sits near every other single word; a sentence that names
 * the field's objects and methods is what separates the prototypes enough for
 * the margin between the top two to mean anything.
 */
export const FIELD_PROTOTYPES: Record<Field, string> = {
  mathematics: "Pure mathematics: proofs, theorems, algebraic structures, geometry, limits and continuous change.",
  statistics: "Statistics and probability: distributions, sampling, inference, regression and uncertainty in data.",
  physics: "Physics: matter, energy, forces, motion, fields, and the mathematical laws governing the physical universe.",
  chemistry: "Chemistry: atoms, molecules, bonding, reactions, and the composition and transformation of substances.",
  biology: "Biology: cells, genetics, organisms, physiology, and the molecular machinery of living things.",
  "earth-science": "Earth science: geology, oceans, atmosphere, climate systems and the processes shaping the planet.",
  astronomy: "Astronomy and cosmology: stars, planets, galaxies, and the structure and history of the universe.",
  ecology: "Ecology: ecosystems, species interactions, biodiversity, habitats and environmental conservation.",
  geography: "Geography: places, regions, maps, populations, settlement patterns and human use of land.",
  computing: "Computing and programming: algorithms, data structures, languages, systems, networks and software behaviour.",
  "software-engineering": "Software engineering practice: design, testing, refactoring, version control, deployment and maintenance.",
  "data-science": "Machine learning and data science: models, training, features, evaluation and statistical learning.",
  philosophy: "Philosophy: metaphysics, epistemology, the nature of mind, reality, knowledge and existence.",
  ethics: "Ethics and moral philosophy: right action, obligation, value, justice and competing normative frameworks.",
  logic: "Formal logic: propositions, inference rules, validity, proof systems and quantification.",
  law: "Law: statutes, cases, courts, contracts, liability, rights and legal reasoning across jurisdictions.",
  politics: "Politics and political theory: power, states, ideology, international relations and political movements.",
  civics: "Civics and government: elections, legislatures, constitutions, public institutions and citizenship.",
  economics: "Economics: markets, prices, incentives, trade, growth, monetary policy and economic behaviour.",
  psychology: "Psychology: emotion, behaviour, personality, development, mental health and psychological research.",
  "cognitive-science": "Cognitive science: memory, attention, perception, reasoning, learning and how the mind processes information.",
  medicine: "Clinical medicine: diagnosis, disease mechanisms, treatment, pharmacology and patient care.",
  "public-health": "Public health and epidemiology: populations, transmission, prevention, vaccination and health policy.",
  nutrition: "Nutrition and metabolism: nutrients, diet, digestion, energy balance and dietary guidance.",
  arts: "Visual art: painting, sculpture, drawing, composition, colour and art movements.",
  music: "Music: harmony, rhythm, melody, form, performance, improvisation and musical analysis.",
  literature: "Literature and writing: poetry, fiction, drama, narrative technique, rhetoric and close reading.",
  film: "Film and cinema: shot composition, editing, screenwriting, genre and moving-image storytelling.",
  architecture: "Architecture and built design: buildings, space, structure, materials and the design of environments.",
  history: "History: past events, periods, causes and consequences, primary sources and historical interpretation.",
  archaeology: "Archaeology: material remains, excavation, dating, artefacts and reconstructing past societies.",
  general: "A general topic that does not belong to a specific academic subject.",
  languages: "Language learning: grammar, vocabulary, pronunciation, translation and using a second language.",
  "life-skills": "Practical life skills: personal finance, budgeting, cooking, household planning and everyday tasks.",
  business: "Business and management: strategy, marketing, operations, accounting, negotiation and organisations.",
  sports: "Sport and physical training: technique, conditioning, tactics, biomechanics and athletic performance.",
};
