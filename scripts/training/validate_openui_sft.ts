import { compileOpenUISourceToSharedDocument, validateUiDocument } from "../../packages/learner-contracts/src/index.js";
import { parseOpenUIMessageSegments } from "../../web/src/keating/openui/segments";

export function validateAnswer(answer: string, id: string, allowActivities = false) {
  const segments = parseOpenUIMessageSegments(answer, id);
  const surfaces = segments.filter(s => s.type === "openui");
  if (!surfaces.length) {
    if (answer.includes("```") || /ask_user_question|MagicQuestion/.test(answer)) throw new Error(`${id}: invalid authoring target`);
    return { mode: "text", nodes: [] };
  }
  if (surfaces.length !== 1) throw new Error(`${id}: expected one focused surface`);
  const s = surfaces[0];
  if (s.format !== "source" || !s.complete || !s.program.startsWith("root = LearningSurface(")) throw new Error(`${id}: incomplete source`);
  if (!answer.startsWith("```openui ") || !answer.trimEnd().endsWith("```")) throw new Error(`${id}: noncanonical fence or prose after interaction`);
  const document = compileOpenUISourceToSharedDocument(s.program, { documentId: id });
  if (!validateUiDocument(document) || document.retention !== s.metadata.lifecycle) throw new Error(`${id}: invalid document or lifecycle mismatch`);
  const questionNodes = document.nodes.filter(n => n.type === "question" || n.type === "question-group");
  if (questionNodes.length > 1 || questionNodes.some(n => n.type === "question-group" && n.questions.length !== 1)) throw new Error(`${id}: more than one focused question`);
  if (document.nodes.some(n => n.type === "handoff" || (!allowActivities && (n.type === "deck" || n.type === "quiz")))) throw new Error(`${id}: activity is outside this focused seed`);
  return { mode: "openui", document, nodes: document.nodes.map(n => n.type), quizzes: document.nodes.filter(n => n.type === "quiz" && n.mode !== "exam").length, exams: document.nodes.filter(n => n.type === "quiz" && n.mode === "exam").length, flashcards: document.nodes.filter(n => n.type === "deck").length };
}

if (import.meta.main) {
  const catalog = await Bun.file(process.argv[2]).json();
  const rows = [...catalog.train, ...catalog.validation];
  const results = rows.map(row => ({ id: row.id, ...validateAnswer(row.assistant, row.id) }));
  console.log(JSON.stringify({ examples: rows.length, openui: results.filter(r => r.mode === "openui").length, text: results.filter(r => r.mode === "text").length, results }));
}
