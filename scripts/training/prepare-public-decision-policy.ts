#!/usr/bin/env bun
/** Real assessment/review outcomes; only the Keating schedule is replayed. */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join, basename } from "node:path";
import { applyReview, initialSrsState, validatePortableLearnerData, type PortableLearnerData, type SrsRating } from "../../packages/learner-contracts/src/index.js";

const digest = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const iso = (ms: number) => new Date(ms).toISOString();
function rows(text: string, separator: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/u), names = lines.shift()!.split(separator);
  // These pinned publisher files contain no quoted fields. Reject format drift.
  if (names.some(name => name.includes('"'))) throw new Error("Unexpected publisher table format");
  return lines.map(line => {
    const values = line.split(separator);
    if (values.length !== names.length || values.some(value => value.includes('"'))) throw new Error("Unexpected publisher row format");
    return Object.fromEntries(names.map((key, i) => [key, values[i]!]));
  });
}
function empty(now: number): PortableLearnerData {
  return { generatedAt: iso(now), sessions: [], artifacts: [], goals: [], questionChecks: [], quizResults: [], decks: [], cardReviews: [],
    studyPriorities: [], feedbackEvents: [], usageEvents: [], topicEvidence: [], benchmarks: [], evolutions: [],
    learnerProfile: { topicsExplored: [], strengths: [], weaknesses: [], sessionsCount: 0 } };
}

export async function preparePublicDecisionPolicies(rawDirectory: string, outputDirectory: string) {
  const root = resolve(rawDirectory), output = resolve(outputDirectory);
  const rawManifest = await readFile(join(root, "public-sources.json"), "utf8");
  const manifest = JSON.parse(rawManifest) as { files: Array<{ source: "ednet" | "fsrs"; path: string; sha256: string }>; ednet: { questionsSha256: string }; fsrs: { revision: string } };
  const questionsText = await readFile(join(root, "ednet-questions.csv"), "utf8");
  if (digest(questionsText) !== manifest.ednet.questionsSha256) throw new Error("Publisher reference changed");
  const questions = new Map(rows(questionsText, ",").map(row => [row.question_id!, row]));
  await mkdir(output, { mode: 0o700 });
  const sources: Array<Record<string, unknown>> = [], audit: Array<Record<string, unknown>> = [];
  for (const file of [...manifest.files].sort((a, b) => a.path.localeCompare(b.path))) {
    const path = resolve(root, file.path);
    if (!path.startsWith(`${root}/`)) throw new Error("Invalid source path");
    const text = await readFile(path, "utf8");
    if (digest(text) !== file.sha256) throw new Error("Publisher source changed");
    const learnerId = `${file.source}-${basename(file.path).replace(/\.[^.]+$/u, "")}`;
    const split = parseInt(digest(learnerId).slice(0, 8), 16) % 4 === 0 ? "validation" : "fit";
    let data: PortableLearnerData;
    if (file.source === "ednet") {
      const events = rows(text, ",").map((row, index) => ({ row, index, started: Number(row.timestamp), elapsed: Number(row.elapsed_time) }))
        .filter(event => Number.isSafeInteger(event.started) && event.started > 0 && Number.isSafeInteger(event.elapsed) && event.elapsed >= 0)
        .sort((a, b) => a.started - b.started || a.index - b.index).slice(0, 96);
      if (!events.length) continue;
      data = empty(Math.max(...events.map(event => event.started + event.elapsed)) + 1);
      for (const { row, index, started, elapsed } of events) {
        const question = questions.get(row.question_id!);
        if (!question || !/^[a-d]$/u.test(row.user_answer ?? "") || !/^[a-d]$/u.test(question.correct_answer ?? "")) continue;
        data.questionChecks.push({ id: `ednet-${index}`, topic: `EdNet TOEIC part ${question.part}`,
          question: `EdNet question ${row.question_id}`, answer: row.user_answer!, grading: "auto",
          score: Number(row.user_answer === question.correct_answer), createdAt: iso(started + elapsed) });
      }
    } else {
      const byCard = new Map<string, Array<{ timestamp: number; rating: SrsRating; index: number }>>();
      rows(text, "\t").forEach((row, index) => {
        const timestamp = Number(row.review_time), rating = Number(row.review_rating) - 1;
        if (!Number.isSafeInteger(timestamp) || timestamp <= 0 || !Number.isInteger(rating) || rating < 0 || rating > 3 || !row.card_id) throw new Error("Invalid published review");
        const list = byCard.get(row.card_id) ?? [];
        list.push({ timestamp, rating: rating as SrsRating, index }); byCard.set(row.card_id, list);
      });
      // Whole-card histories, selected without inspecting ratings. Bound source
      // size so exhaustive source/metric reconstruction remains practical in-app.
      const selected = [...byCard].sort(([a], [b]) => digest(a).localeCompare(digest(b)))
        .filter(([, events]) => events.length <= 96).slice(0, 16);
      if (!selected.length) continue;
      data = empty(Math.max(...selected.flatMap(([, events]) => events.map(event => event.timestamp))) + 1);
      for (const [cardId, unsorted] of selected) {
        const events = [...unsorted].sort((a, b) => a.timestamp - b.timestamp || a.index - b.index);
        // Simultaneous duplicate ratings have no recoverable order.
        if (new Set(events.map(event => event.timestamp)).size !== events.length) continue;
        const id = `card-${cardId}`, deckId = `deck-${cardId}`, topic = "Published Anki recall";
        const createdAt = iso(events[0]!.timestamp - 1);
        let state = initialSrsState(createdAt);
        for (const event of events) {
          const timestamp = iso(event.timestamp), previousIntervalDays = state.intervalDays;
          const applied = applyReview(state, event.rating, timestamp); state = applied.next;
          data.cardReviews.push({ id: `fsrs-${event.index}`, deckId, cardId: id, rating: event.rating,
            appliedIntervalDays: applied.appliedIntervalDays, easeAfter: state.ease, createdAt: timestamp,
            previousIntervalDays, nextDueAt: state.dueAt, repetitionsAfter: state.repetitions, lapsesAfter: state.lapses, isLapse: applied.isLapse });
        }
        // The public release lacks deck membership/content: each actual card is
        // its own clearly labelled replay queue item, never an invented deck.
        data.decks.push({ id: deckId, title: `Published card ${cardId}`, topic, createdAt,
          updatedAt: events.length ? iso(events.at(-1)!.timestamp) : createdAt,
          cards: [{ id, front: `Published card ${cardId}`, back: "Content withheld by public source", tags: [], srs: state }] });
      }
    }
    if (!validatePortableLearnerData(data)) throw new Error(`Normalized source does not satisfy learner contracts: ${learnerId}`);
    const contents = JSON.stringify(data), filename = `${learnerId}.json`;
    await writeFile(join(output, filename), contents, { flag: "wx", mode: 0o600 });
    sources.push({ path: join(output, filename), sha256: digest(contents), learnerId, groupId: learnerId, split,
      provenance: { origin: "public-human", dataset: file.source === "ednet" ? "https://github.com/riiid/ednet" : "https://huggingface.co/datasets/open-spaced-repetition/fsrs-dataset",
        revision: file.sha256, schedule: file.source === "fsrs" ? "replayed-keating-srs" : "unknown",
        notes: file.source === "fsrs" ? "Actual published review timestamps and ratings; rating offset -1 preserves ordinal categories. Keating schedules replayed; one original card per queue item because deck membership is absent. No objective assessment is invented. First 16 hashed complete card histories of at most 96 records; no outcome-based selection."
          : "Actual EdNet choices scored against published answer key. First 96 timestamp-ordered interactions per complete learner file; response time is presentation timestamp plus published elapsed time. Part labels identify broad TOEIC sections, not measured latent mastery. No help-use information is inferred." } });
    audit.push({ learnerId, split, assessments: data.questionChecks.length, reviews: data.cardReviews.length, cards: data.decks.length });
  }
  await writeFile(join(output, "selection.json"), JSON.stringify({ schemaVersion: 1, sources }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  await writeFile(join(output, "acquisition-audit.json"), JSON.stringify({ sourceManifestSha256: digest(rawManifest), sourceManifest: resolve(root, "public-sources.json"), selection: "source-prefix-v1;learner-SHA256-mod4-validation;no-outcome-based-selection", learners: audit }, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  return { learners: sources.length, selection: join(output, "selection.json"), assessments: audit.reduce((n, row) => n + Number(row.assessments), 0), reviews: audit.reduce((n, row) => n + Number(row.reviews), 0) };
}

if (import.meta.main) {
  const [input, output, extra] = process.argv.slice(2);
  if (!input || !output || extra) throw new Error("Usage: bun scripts/training/prepare-public-decision-policy.ts RAW-directory NEW-output-directory");
  console.log(JSON.stringify(await preparePublicDecisionPolicies(input, output)));
}
