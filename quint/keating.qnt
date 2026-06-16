/**
 * keating.qnt — Formal specification of the Keating pedagogy engine.
 *
 * Quint 0.32.0 typechecks one file at a time, so all modules live here.
 * The logical module structure mirrors src/core/:
 *
 *   Policy           — TeacherPolicy, SimulationWeights, clamping
 *   Invariants       — system laws (the Antithesis invariants)
 *   Topics           — domain keyword heuristics, fallback generation
 *   LessonPlan       — phase construction + domain-specific injections
 *   Benchmark        — deterministic score function, score bounds
 *   Evolution        — MAP-Elites archive, novelty, three-gate acceptance
 *   PromptEvolution  — 6-objective scoring, PROSPER selection
 *   Learner          — profile, feedback append-only, spaced repetition
 *   StateMachine     — top-level transitions: plan/bench/evolve/feedback
 *
 * Numeric values in the TS types are floats in [0,1]. Quint has only
 * `int`, so we rescale: 1.0 == 1000 millis, 100.0 == 10000 (for scores).
 * All arithmetic commutes with this rescaling.
 *
 * Run:
 *   quint typecheck keating.qnt
 *   quint run --invariant=systemIsSane keating.qnt
 *   quint verify --invariant=systemIsSane keating.qnt
 */

// ═══════════════════════════════════════════════════════════════════════════
// Helpers (used by every module below)
// ═══════════════════════════════════════════════════════════════════════════

module helpers {
  // List versions of common Set operations (Quint stdlib only has these
  // on Set, but we need them on List for the spec).

  // listMap: applies f to every element of l, returning a new list
  pure def listMap(l: List[a], f: (a) => b): List[b] =
    l.foldl(List(), (acc, x) => acc.append(f(x)))

  pure def listForall(l: List[a], p: (a) => bool): bool =
    l.foldl(true, (acc, x) => acc and p(x))

  pure def listExists(l: List[a], p: (a) => bool): bool =
    l.foldl(false, (acc, x) => acc or p(x))

  // List to Set (only valid for hashable element types)
  pure def listToSet(l: List[a]): Set[a] =
    l.foldl(Set(), (acc, x) => acc.union(Set(x)))

  // First element matching a predicate, or default
  pure def listFirstMatch(l: List[a], p: (a) => bool, default: a): a =
    l.foldl(default, (acc, x) => if (acc == default and p(x)) x else acc)

  // List insertion at an index
  pure def listInsertAt(l: List[a], i: int, e: a): List[a] =
    l.slice(0, i).append(e).concat(l.slice(i, l.length()))

  // Set size
  pure def setSize(s: Set[a]): int = s.size()
}

// ═══════════════════════════════════════════════════════════════════════════
// Module: Policy
// ═══════════════════════════════════════════════════════════════════════════

module Policy {
  pure val UNIT = 1000
  pure val EPSILON_MILLIS = 1
  pure val MIN_EXERCISES = 1
  pure val MAX_EXERCISES = 5

  pure def clampUnit(x: int): int =
    if (x < 0) 0 else if (x > UNIT) UNIT else x

  pure def clampInt(x: int, lo: int, hi: int): int =
    if (x < lo) lo else if (x > hi) hi else x

  type ScalarTuple = (int, int, int, int, int, int, int, int)

  type TeacherPolicy = {
    name: str,
    scalars: ScalarTuple,
    exerciseCount: int
  }

  pure val DEFAULT_POLICY: TeacherPolicy = {
    name: "keating-default",
    scalars: (720, 660, 640, 740, 700, 680, 620, 580),
    exerciseCount: 3
  }

  type Weights = (int, int, int, int, int)

  pure val DEFAULT_WEIGHTS: Weights = (340, 200, 160, 160, 140)

  pure def policyIsBounded(p: TeacherPolicy): bool =
    and {
      p.exerciseCount >= MIN_EXERCISES,
      p.exerciseCount <= MAX_EXERCISES,
      p.scalars._1 >= 0, p.scalars._1 <= UNIT,
      p.scalars._2 >= 0, p.scalars._2 <= UNIT,
      p.scalars._3 >= 0, p.scalars._3 <= UNIT,
      p.scalars._4 >= 0, p.scalars._4 <= UNIT,
      p.scalars._5 >= 0, p.scalars._5 <= UNIT,
      p.scalars._6 >= 0, p.scalars._6 <= UNIT,
      p.scalars._7 >= 0, p.scalars._7 <= UNIT,
      p.scalars._8 >= 0, p.scalars._8 <= UNIT
    }

  pure def weightsAreBounded(w: Weights): bool =
    and {
      w._1 >= 0, w._1 <= UNIT,
      w._2 >= 0, w._2 <= UNIT,
      w._3 >= 0, w._3 <= UNIT,
      w._4 >= 0, w._4 <= UNIT,
      w._5 >= 0, w._5 <= UNIT
    }

  pure def weightsAreNormalized(w: Weights): bool = {
    val s = w._1 + w._2 + w._3 + w._4 + w._5
    and { s - UNIT < EPSILON_MILLIS, s - UNIT > -EPSILON_MILLIS }
  }

  pure def clampPolicy(p: TeacherPolicy): TeacherPolicy = {
    {
      name: p.name,
      scalars: (
        clampUnit(p.scalars._1),
        clampUnit(p.scalars._2),
        clampUnit(p.scalars._3),
        clampUnit(p.scalars._4),
        clampUnit(p.scalars._5),
        clampUnit(p.scalars._6),
        clampUnit(p.scalars._7),
        clampUnit(p.scalars._8)
      ),
      exerciseCount: clampInt(p.exerciseCount, MIN_EXERCISES, MAX_EXERCISES)
    }
  }

  pure def clampWeights(w: Weights): Weights = {
    if (weightsAreBounded(w).and(weightsAreNormalized(w))) w
    else if (w._1 + w._2 + w._3 + w._4 + w._5 == 0) DEFAULT_WEIGHTS
    else {
      val s = w._1 + w._2 + w._3 + w._4 + w._5
      val n1 = w._1 * UNIT / s
      val n2 = w._2 * UNIT / s
      val n3 = w._3 * UNIT / s
      val n4 = w._4 * UNIT / s
      val n5 = w._5 * UNIT / s
      val c1 = clampUnit(n1)
      val c2 = clampUnit(n2)
      val c3 = clampUnit(n3)
      val c4 = clampUnit(n4)
      val c5 = clampUnit(n5)
      val cs = c1 + c2 + c3 + c4 + c5
      if (cs == 0) DEFAULT_WEIGHTS
      else {
        val r1 = c1 * UNIT / cs
        val r2 = c2 * UNIT / cs
        val r3 = c3 * UNIT / cs
        val r4 = c4 * UNIT / cs
        val r5 = c5 * UNIT / cs
        (r1 + (UNIT - r1 - r2 - r3 - r4 - r5), r2, r3, r4, r5)
      }
    }
  }

  pure def policySignature(p: TeacherPolicy): str =
    "${p.scalars._1}|${p.scalars._2}|${p.scalars._3}|${p.scalars._4}|${p.exerciseCount}|${p.scalars._5}|${p.scalars._6}|${p.scalars._7}|${p.scalars._8}"
}

// ═══════════════════════════════════════════════════════════════════════════
// Module: Invariants
// ═══════════════════════════════════════════════════════════════════════════

module Invariants {
  import Policy.*
  import helpers.*

  pure val SCORE_MAX = 10000
  pure val METRIC_MAX = 1000

  type TopicBenchmark = {
    topicSlug: str,
    meanScore: int,
    meanMasteryGain: int,
    meanRetention: int,
    meanEngagement: int,
    meanTransfer: int,
    meanConfusion: int
  }

  type BenchmarkResult = {
    overallScore: int,
    topicBenchmarks: List[TopicBenchmark]
  }

  pure def topicBounded(t: TopicBenchmark): bool =
    and {
      t.meanScore >= 0, t.meanScore <= SCORE_MAX,
      t.meanMasteryGain >= 0, t.meanMasteryGain <= METRIC_MAX,
      t.meanRetention >= 0, t.meanRetention <= METRIC_MAX,
      t.meanEngagement >= 0, t.meanEngagement <= METRIC_MAX,
      t.meanTransfer >= 0, t.meanTransfer <= METRIC_MAX,
      t.meanConfusion >= 0, t.meanConfusion <= METRIC_MAX
    }

  pure def benchmarkScoresAreBounded(r: BenchmarkResult): bool =
    and {
      r.overallScore >= 0,
      r.overallScore <= SCORE_MAX,
      listForall(r.topicBenchmarks, topicBounded)
    }

  pure def policyAndWeightsAreValid(p: TeacherPolicy, w: Weights): bool =
    and {
      policyIsBounded(p),
      weightsAreBounded(w),
      weightsAreNormalized(w)
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Module: Topics
// ═══════════════════════════════════════════════════════════════════════════

module Topics {
  import helpers.*

  pure val CANONICAL_TOPICS: Set[str] = Set(
    "derivative", "entropy", "bayes-rule", "falsifiability", "stoicism",
    "recursion", "precedent", "separation-of-powers", "cognitive-bias",
    "evidence-based-medicine", "counterpoint", "industrial-revolution",
    "relativity", "social-contract"
  )

  pure val DOMAINS: Set[str] = Set(
    "math", "science", "philosophy", "code", "law",
    "politics", "psychology", "medicine", "arts", "history", "general"
  )

  // Domain keyword heuristic (subset of src/core/topics.ts:buildFallbackTopic)
  // We precompute the list of (keyword-substring, domain) pairs.
  pure val DOMAIN_KEYWORDS: List[(str, str)] = [
    ("calculus|derivative|integral|limit|function|graph|algebra|topology|geometry", "math"),
    ("physics|chemistry|biology|relativity|entropy|thermo|electric|magnetic", "science"),
    ("kant|aristotle|plato|stoicism|existentialism|phenomenology|epistemology|philosophy", "philosophy"),
    ("recursion|loop|closure|promise|monad|protocol|api|runtime|compiler|type", "code"),
    ("precedent|statute|tort|contract|liability|jurisprudence|constitutional", "law"),
    ("separation|sovereignty|republic|democracy|election|legislature|federalism", "politics"),
    ("bias|cognitive|anchoring|availability|heuristic|memory|emotion|psycho", "psychology"),
    ("evidence|trial|rct|meta-analysis|clinical|diagnosis|pathology|pharma", "medicine"),
    ("music|painting|sculpture|poetry|novel|cinema|theater|aesthetic", "arts"),
    ("revolution|war|treaty|empire|industrial|colonial|enlightenment|renaissance", "history")
  ]

  // Crude substring-membership predicate. The TS implementation uses
  // regex; we abstract to a single string containsKeyword that
  // returns true iff any keyword in `keywords` is a substring of
  // `slug` (case-insensitive). Quint strings are opaque, so we model
  // this as an opaque predicate. Tests can interpret this.
  pure def containsKeyword(slug: str, keywords: str): bool = true

  // Resolve a topic name to a domain via the keyword heuristic.
  // First non-empty match wins; falls back to "general".
  pure def resolveDomain(slug: str): str = {
    listFirstMatch(DOMAIN_KEYWORDS, ((kw, dom)) => containsKeyword(slug, kw), ("zzz", "general"))._2
  }

  pure def resolveDomainIsValid(slug: str): bool =
    DOMAINS.contains(resolveDomain(slug))
}

// ═══════════════════════════════════════════════════════════════════════════
// Module: LessonPlan
// ═══════════════════════════════════════════════════════════════════════════

module LessonPlan {
  import Policy.*
  import Topics.*
  import helpers.*

  pure val STANDARD_PHASE_IDS: Set[str] = Set(
    "orient", "intuition", "formal-core", "misconceptions",
    "examples", "practice", "transfer"
  )

  type LessonPhase = {
    id: str,
    title: str,
    bulletCount: int
  }

  type LessonPlan = {
    topicSlug: str,
    topicDomain: str,
    phases: List[LessonPhase],
    usesDiagram: bool,
    usesLiveCode: bool,
    socraticOpening: bool
  }

  pure val standardPhases: List[LessonPhase] = [
    { id: "orient", title: "Orientation", bulletCount: 2 },
    { id: "intuition", title: "Intuition", bulletCount: 2 },
    { id: "formal-core", title: "Formal Core", bulletCount: 2 },
    { id: "misconceptions", title: "Misconception Repair", bulletCount: 2 },
    { id: "examples", title: "Worked Examples", bulletCount: 2 },
    { id: "practice", title: "Guided Practice", bulletCount: 3 },
    { id: "transfer", title: "Transfer and Reflection", bulletCount: 2 }
  ]

  // "diagram" is inserted at index 4 (between misconceptions and examples)
  // if policy.diagramBias >= 0.55.
  pure def withDiagram(phases: List[LessonPhase], policy: TeacherPolicy): List[LessonPhase] =
    if (policy.scalars._5 >= 550)
      listInsertAt(phases, 4, { id: "diagram", title: "Diagram", bulletCount: 2 })
    else phases

  // "live-code" is appended if domain == "code".
  pure def withLiveCode(phases: List[LessonPhase], domain: str): List[LessonPhase] =
    if (domain == "code")
      phases.append({ id: "live-code", title: "Live Code", bulletCount: 3 })
    else phases

  pure def hasSocraticOpening(p: TeacherPolicy): bool = p.scalars._2 >= 600

  pure def buildLessonPlan(topicName: str, policy: TeacherPolicy): LessonPlan = {
    val isCanonical = CANONICAL_TOPICS.contains(topicName)
    val effectiveDomain = if (isCanonical) resolveDomain(topicName) else "general"
    val base = standardPhases
    val withDiag = withDiagram(base, policy)
    val withLC = withLiveCode(withDiag, effectiveDomain)
    {
      topicSlug: topicName,
      topicDomain: effectiveDomain,
      phases: withLC,
      usesDiagram: policy.scalars._5 >= 550,
      usesLiveCode: effectiveDomain == "code",
      socraticOpening: hasSocraticOpening(policy)
    }
  }

  // ── Invariants on the plan ──────────────────────────────────────────────

  pure def phasesAreUnique(plan: LessonPlan): bool =
    setSize(listToSet(listMap(plan.phases, p => p.id))) == plan.phases.length()

  pure def hasAllStandardPhases(plan: LessonPlan): bool = {
    val present = listToSet(listMap(plan.phases, p => p.id))
    val standardPresent = present.intersect(STANDARD_PHASE_IDS)
    standardPresent == STANDARD_PHASE_IDS
  }

  pure def diagramInjectionConsistent(plan: LessonPlan, policy: TeacherPolicy): bool =
    (policy.scalars._5 >= 550) == plan.usesDiagram

  pure def liveCodeInjectionConsistent(plan: LessonPlan): bool =
    (plan.topicDomain == "code") == plan.usesLiveCode

  pure def socraticOpeningConsistent(plan: LessonPlan, policy: TeacherPolicy): bool =
    (policy.scalars._2 >= 600) == plan.socraticOpening

  pure def lessonPlanIsValid(plan: LessonPlan, policy: TeacherPolicy): bool =
    and {
      phasesAreUnique(plan),
      hasAllStandardPhases(plan),
      diagramInjectionConsistent(plan, policy),
      liveCodeInjectionConsistent(plan),
      socraticOpeningConsistent(plan, policy)
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Module: Benchmark
// ═══════════════════════════════════════════════════════════════════════════

module Benchmark {
  import Policy.*
  import Invariants.*

  // Mirrors test/helpers.ts:deterministicScore (scaled):
  //   raw = analogyDensity * w.masteryGain * 30
  //       + socraticRatio * w.engagement * 25
  //       + formalism * w.retention * 20
  //       + retrievalPractice * w.transfer * 15
  //       + (1 - challengeRate) * w.confusion * 10
  //   score = clamp(raw + 20, 0, 100)
  // Scaled: each constant × 100, weights × 1000 (so product stays in 1e5).
  pure def deterministicScore(p: TeacherPolicy, w: Weights): int = {
    val s = p.scalars
    val raw = s._1 * w._1 * 30 +
              s._2 * w._3 * 25 +
              s._3 * w._2 * 20 +
              s._4 * w._4 * 15 +
              (UNIT - s._8) * w._5 * 10
    val shifted = raw / UNIT + 2000
    if (shifted < 0) 0
    else if (shifted > SCORE_MAX) SCORE_MAX
    else shifted
  }

  pure def stubBenchmark(p: TeacherPolicy, w: Weights, topicSlug: str): BenchmarkResult = {
    val score = deterministicScore(p, w)
    val s = p.scalars
    {
      overallScore: score,
      topicBenchmarks: [{
        topicSlug: topicSlug,
        meanScore: score,
        meanMasteryGain: s._1 * 600 / UNIT + 200,
        meanRetention: s._4 * 500 / UNIT + 300,
        meanEngagement: s._2 * 400 / UNIT + 300,
        meanTransfer: s._7 * 300 / UNIT + 200,
        meanConfusion: s._8 * 300 / UNIT
      }]
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Module: Evolution
// ═══════════════════════════════════════════════════════════════════════════

module Evolution {
  import Policy.*
  import Invariants.*
  import Benchmark.*
  import helpers.*

  pure val NOVELTY_THRESHOLD = 50
  pure val SAFETY_MARGIN = 150

  type EvolutionCandidate = {
    policy: TeacherPolicy,
    benchmark: BenchmarkResult,
    novelty: int,
    accepted: bool,
    improves: bool,
    safe: bool,
    novelEnough: bool
  }

  // exerciseCount normalized to [0, UNIT] (i.e. exerciseCount * 200)
  pure def policyVector(p: TeacherPolicy): (int, int, int, int, int, int, int, int, int) =
    (
      p.scalars._1, p.scalars._2, p.scalars._3, p.scalars._4,
      p.exerciseCount * 200,
      p.scalars._5, p.scalars._6, p.scalars._7, p.scalars._8
    )

  pure def sqDist(a: (int, int, int, int, int, int, int, int, int),
                  b: (int, int, int, int, int, int, int, int, int)): int = {
    val d1 = a._1 - b._1
    val d2 = a._2 - b._2
    val d3 = a._3 - b._3
    val d4 = a._4 - b._4
    val d5 = a._5 - b._5
    val d6 = a._6 - b._6
    val d7 = a._7 - b._7
    val d8 = a._8 - b._8
    val d9 = a._9 - b._9
    d1 * d1 + d2 * d2 + d3 * d3 + d4 * d4 +
    d5 * d5 + d6 * d6 + d7 * d7 + d8 * d8 + d9 * d9
  }

  // Novelty = mean of squared distances to all archived policies.
  pure def noveltyScore(archive: List[TeacherPolicy], candidate: TeacherPolicy): int = {
    if (archive.length() == 0) UNIT
    else {
      val cv = policyVector(candidate)
      val dists = listMap(archive, p => sqDist(cv, policyVector(p)))
      dists.foldl(0, (acc, d) => acc + d) / archive.length()
    }
  }

  pure def weakestScore(r: BenchmarkResult): int =
    r.topicBenchmarks.foldl(SCORE_MAX, (acc, t) =>
      if (t.meanScore < acc) t.meanScore else acc)

  pure def gateImproves(c: BenchmarkResult, best: BenchmarkResult): bool =
    c.overallScore > best.overallScore

  pure def gateSafe(c: BenchmarkResult, best: BenchmarkResult): bool =
    weakestScore(c) >= weakestScore(best) - SAFETY_MARGIN

  // Compare against the SQUARE of the threshold (since sqDist is
  // also squared and mean doesn't preserve the unit).
  pure def gateNovel(cand: EvolutionCandidate): bool =
    cand.novelty >= NOVELTY_THRESHOLD * NOVELTY_THRESHOLD

  pure def accept(cand: EvolutionCandidate, best: BenchmarkResult): bool =
    and {
      gateImproves(cand.benchmark, best),
      gateSafe(cand.benchmark, best),
      gateNovel(cand)
    }

  pure def acceptanceIsMonotone(c: EvolutionCandidate, best: BenchmarkResult): bool =
    not(c.accepted).or(c.benchmark.overallScore > best.overallScore)
}

// ═══════════════════════════════════════════════════════════════════════════
// Module: PromptEvolution
// ═══════════════════════════════════════════════════════════════════════════

module PromptEvolution {
  import Policy.*

  pure val OBJECTIVE_NAMES: Set[str] = Set(
    "voice", "diagnosis", "verification", "retrieval", "transfer", "structure"
  )

  type PromptScores = {
    voice: int,
    diagnosis: int,
    verification: int,
    retrieval: int,
    transfer: int,
    structure: int
  }

  pure def scoresAreBounded(s: PromptScores): bool =
    and {
      s.voice >= 0, s.voice <= UNIT,
      s.diagnosis >= 0, s.diagnosis <= UNIT,
      s.verification >= 0, s.verification <= UNIT,
      s.retrieval >= 0, s.retrieval <= UNIT,
      s.transfer >= 0, s.transfer <= UNIT,
      s.structure >= 0, s.structure <= UNIT
    }

  // PROSPER selector: balanced multi-objective dominates.
  pure def paretoDominatesAll(c: PromptScores, p: PromptScores): bool =
    and {
      c.voice >= p.voice,
      c.diagnosis >= p.diagnosis,
      c.verification >= p.verification,
      c.retrieval >= p.retrieval,
      c.transfer >= p.transfer,
      c.structure >= p.structure,
      or {
        c.voice > p.voice,
        c.diagnosis > p.diagnosis,
        c.verification > p.verification,
        c.retrieval > p.retrieval,
        c.transfer > p.transfer,
        c.structure > p.structure
      }
    }

  pure def meanScore(s: PromptScores): int =
    (s.voice + s.diagnosis + s.verification +
     s.retrieval + s.transfer + s.structure) / 6

  pure def prosperAccept(c: PromptScores, p: PromptScores): bool =
    paretoDominatesAll(c, p)
}

// ═══════════════════════════════════════════════════════════════════════════
// Module: Learner
// ═══════════════════════════════════════════════════════════════════════════

module Learner {
  import Policy.*
  import Invariants.*
  import helpers.*

  pure val FEEDBACK_SIGNALS: Set[str] = Set("thumbs-up", "thumbs-down", "confused")

  type Feedback = {
    topic: str,
    signal: str
  }

  type LearnerProfile = {
    id: str,
    priorKnowledge: int,
    abstractionComfort: int,
    analogyNeed: int,
    dialoguePreference: int,
    diagramAffinity: int,
    persistence: int,
    transferDesire: int,
    anxiety: int
  }

  pure def profileIsBounded(p: LearnerProfile): bool =
    and {
      p.priorKnowledge >= 0, p.priorKnowledge <= UNIT,
      p.abstractionComfort >= 0, p.abstractionComfort <= UNIT,
      p.analogyNeed >= 0, p.analogyNeed <= UNIT,
      p.dialoguePreference >= 0, p.dialoguePreference <= UNIT,
      p.diagramAffinity >= 0, p.diagramAffinity <= UNIT,
      p.persistence >= 0, p.persistence <= UNIT,
      p.transferDesire >= 0, p.transferDesire <= UNIT,
      p.anxiety >= 0, p.anxiety <= UNIT
    }

  type CoveredTopic = {
    slug: str,
    lastSeen: int,
    mastery: int,
    sessionCount: int
  }

  type LearnerState = {
    profile: LearnerProfile,
    feedback: List[Feedback],
    covered: List[CoveredTopic]
  }

  pure def learnerIsBounded(s: LearnerState): bool = profileIsBounded(s.profile)

  pure def feedbackSignalsAreValid(s: LearnerState): bool =
    listForall(s.feedback, f => FEEDBACK_SIGNALS.contains(f.signal))

  pure def masteryBounded(s: LearnerState): bool =
    listForall(s.covered, c => c.mastery >= 0 and c.mastery <= UNIT)

  // Feedback is append-only (monotonic).
  pure def feedbackAppendOnly(before: List[Feedback], after: List[Feedback]): bool = {
    val n = before.length()
    and {
      after.length() >= n,
      after.slice(0, n) == before
    }
  }

  pure val DEFAULT_DUE_THRESHOLD = 500
  pure val DEFAULT_MIN_REVIEW_DAYS = 1

  pure def isDue(topic: CoveredTopic, dueThreshold: int, minReviewDays: int): bool =
    or {
      topic.mastery < dueThreshold,
      topic.lastSeen > minReviewDays
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Module: StateMachine
// ═══════════════════════════════════════════════════════════════════════════

module StateMachine {
  import Policy.*
  import Invariants.*
  import Topics.*
  import LessonPlan.*
  import Benchmark.*
  import Evolution.*
  import PromptEvolution.*
  import Learner.*
  import helpers.*

  type KeatingState = {
    policy: TeacherPolicy,
    weights: Weights,
    archive: List[TeacherPolicy],
    bestBenchmark: BenchmarkResult,
    feedback: List[Feedback],
    plan: LessonPlan
  }

  pure val initState: KeatingState = {
    policy: DEFAULT_POLICY,
    weights: DEFAULT_WEIGHTS,
    archive: [],
    bestBenchmark: stubBenchmark(DEFAULT_POLICY, DEFAULT_WEIGHTS, "init"),
    feedback: [],
    plan: buildLessonPlan("derivative", DEFAULT_POLICY)
  }

  // ── Top-level invariants (vals, not defs, so `quint run --invariant` can use them) ──

  val policyBounded: bool = policyIsBounded(policy)

  val weightsNormalized: bool = weightsAreNormalized(weights)

  val scoresBounded: bool = benchmarkScoresAreBounded(bestBenchmark)

  val feedbackValid: bool = feedbackSignalsAreValid({
    profile: { id: "x", priorKnowledge: 0, abstractionComfort: 0, analogyNeed: 0,
               dialoguePreference: 0, diagramAffinity: 0, persistence: 0,
               transferDesire: 0, anxiety: 0 },
    feedback: feedback,
    covered: []
  })

  val planIsValid: bool = lessonPlanIsValid(plan, policy)

  // Composite invariant: the system is sane.
  val systemIsSane: bool =
    and {
      policyBounded,
      weightsNormalized,
      scoresBounded,
      feedbackValid,
      planIsValid
    }

  // ── State variables for the simulator ──────────────────────────────────
  var policy: TeacherPolicy
  var weights: Weights
  var archive: List[TeacherPolicy]
  var bestBenchmark: BenchmarkResult
  var feedback: List[Feedback]
  var plan: LessonPlan

  // ── Actions ─────────────────────────────────────────────────────────────

  action planTopic(t: str): bool = all {
    policy' = policy,
    weights' = weights,
    archive' = archive,
    bestBenchmark' = bestBenchmark,
    feedback' = feedback,
    plan' = buildLessonPlan(t, policy)
  }

  action benchTopic(t: str): bool = all {
    policy' = policy,
    weights' = weights,
    archive' = archive,
    bestBenchmark' = stubBenchmark(policy, weights, t),
    feedback' = feedback,
    plan' = plan
  }

  action giveFeedback(f: Feedback): bool = all {
    FEEDBACK_SIGNALS.contains(f.signal),
    policy' = policy,
    weights' = weights,
    archive' = archive,
    bestBenchmark' = bestBenchmark,
    feedback' = feedback.append(f),
    plan' = plan
  }

  // Pure helper: given a bump, return the mutated policy
  pure def applyBump(p: TeacherPolicy, bump: int): TeacherPolicy =
    clampPolicy({
      name: "candidate",
      scalars: (
        clampUnit(p.scalars._1 + bump),
        clampUnit(p.scalars._2 + bump),
        p.scalars._3, p.scalars._4, p.scalars._5,
        p.scalars._6, p.scalars._7, p.scalars._8
      ),
      exerciseCount: clampInt(p.exerciseCount + (bump / 50), 1, 5)
    })

  // Helper: given a candidate policy and weights, return the new archive.
  def evalCandidateNewArchive(
    p: TeacherPolicy,
    w: Weights,
    archive: List[TeacherPolicy],
    best: BenchmarkResult
  ): List[TeacherPolicy] = {
    val cand = stubBenchmark(p, w, "candidate")
    val newNovelty = noveltyScore(archive, p)
    val candRec = {
      policy: p,
      benchmark: cand,
      novelty: newNovelty,
      accepted: false, improves: false, safe: false, novelEnough: false
    }
    val accepted = accept(candRec, best)
    if (accepted) archive.append(p) else archive
  }

  // Helper: given a candidate policy and weights, return the new best.
  def evalCandidateNewBest(
    p: TeacherPolicy,
    w: Weights,
    archive: List[TeacherPolicy],
    best: BenchmarkResult
  ): BenchmarkResult = {
    val cand = stubBenchmark(p, w, "candidate")
    val newNovelty = noveltyScore(archive, p)
    val candRec = {
      policy: p,
      benchmark: cand,
      novelty: newNovelty,
      accepted: false, improves: false, safe: false, novelEnough: false
    }
    val accepted = accept(candRec, best)
    if (accepted) cand else best
  }

  // Combined helper: take a bump and the current state, return
  // (newPolicy, newArchive, newBest) in a single tuple.
  def mutateAndEval(
    p: TeacherPolicy,
    bump: int,
    w: Weights,
    archive: List[TeacherPolicy],
    best: BenchmarkResult
  ): (TeacherPolicy, List[TeacherPolicy], BenchmarkResult) = {
    val mutated = applyBump(p, bump)
    (mutated, evalCandidateNewArchive(mutated, w, archive, best),
            evalCandidateNewBest(mutated, w, archive, best))
  }

  action mutatePolicyStep(): bool = {
    nondet bump = oneOf(Set(-100, -50, -10, 0, 10, 50, 100))
    val r = mutateAndEval(policy, bump, weights, archive, bestBenchmark)
    all {
      policy' = r._1,
      weights' = weights,
      archive' = r._2,
      bestBenchmark' = r._3,
      feedback' = feedback,
      // Rebuild the plan so socratic/diagram flags stay consistent
      // with the new policy. This matches the spec's contract that
      // the system is always self-consistent.
      plan' = buildLessonPlan(plan.topicSlug, r._1)
    }
  }

  // ── Step: one of the actions, nondeterministically chosen ────────────
  action step = {
    nondet action_choice = oneOf(Set(0, 1, 2, 3, 4, 5, 6, 7, 8))
    if (action_choice == 0) planTopic("derivative")
    else if (action_choice == 1) planTopic("entropy")
    else if (action_choice == 2) planTopic("recursion")
    else if (action_choice == 3) benchTopic("derivative")
    else if (action_choice == 4) benchTopic("entropy")
    else if (action_choice == 5) giveFeedback({ topic: "derivative", signal: "thumbs-up" })
    else if (action_choice == 6) giveFeedback({ topic: "derivative", signal: "thumbs-down" })
    else if (action_choice == 7) giveFeedback({ topic: "entropy", signal: "confused" })
    else mutatePolicyStep
  }

  action init = all {
    policy' = DEFAULT_POLICY,
    weights' = DEFAULT_WEIGHTS,
    archive' = [],
    bestBenchmark' = stubBenchmark(DEFAULT_POLICY, DEFAULT_WEIGHTS, "init"),
    feedback' = [],
    plan' = buildLessonPlan("derivative", DEFAULT_POLICY)
  }
}
