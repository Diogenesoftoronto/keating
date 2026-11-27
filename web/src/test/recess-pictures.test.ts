import { expect, test } from "bun:test";
import { habitLesson, lessonForPrompt, type HabitLesson } from "../keating/habits/lesson";
import { recessQuestionCandidates, buildChatRecessPack } from "../keating/habits/recess-lesson";
import { recessCurationRequest } from "../keating/habits/recess-curate";
import { recessExplainRequest } from "../keating/habits/recess-explain";
import { pictureFor, pictureNeed, swapUnloadedPictures, withQuestionPictures } from "../keating/habits/recess-images";
import type { RecessQuestion } from "../components/recess/types";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const GENERATED = `data:image/webp;base64,${"A".repeat(400)}`;

test("the lesson keeps the pictures the learner saw, beside the text that mentions them", () => {
	const payload = { title: "Cell parts", alt: "A labelled animal cell", dataUrl: GENERATED, mimeType: "image/webp" };
	const lesson = habitLesson([
		{ role: "user-with-attachments", content: [{ type: "text", text: "Which part is this?" }, { type: "image", mimeType: "image/png", data: PNG.split(",")[1], filename: "cell.png" }] },
		{ role: "assistant", content: [{ type: "toolCall", id: "t1", name: "generate_image" }] },
		{ role: "toolResult", content: [{ type: "text", text: `# Generated Image: Cell parts\n\n<keating-image json=${JSON.stringify(JSON.stringify(payload))} />` }] },
		{ role: "assistant", content: [{ type: "text", text: `In the diagram, the **nucleus** holds the DNA. ![Inline sketch](${PNG})` }] },
	]);
	expect(lesson.map(turn => turn.role)).toEqual(["learner", "tutor"]);
	expect(lesson[0].images?.map(image => image.alt)).toEqual(["cell.png"]);
	expect(lesson[1].images?.map(image => image.alt)).toEqual(["A labelled animal cell", "Inline sketch"]);
	// The text budget never carries pixels; the picture lives in `images`.
	expect(lesson[1].text).not.toContain("base64");
	// Models and Jev get the id and description, never the data.
	const forPrompt = JSON.stringify(lessonForPrompt(lesson));
	expect(forPrompt).not.toContain("data:image");
	expect(forPrompt).toContain("A labelled animal cell");
});

const cellLesson = (withPicture: boolean): HabitLesson => [
	{ role: "learner", text: "Can you explain the parts of this cell?", ...(withPicture ? { images: [{ id: "img_cell", alt: "Labelled diagram of an animal cell", src: PNG }] } : {}) },
	{ role: "tutor", text: "In the diagram, the **nucleus** holds the cell's DNA. The **mitochondria** release energy from food. The **ribosomes** build proteins from amino acids. The **cell membrane** controls what enters and leaves the cell. Each **mitochondrion** has its own small loop of DNA, which is why biologists think mitochondria were once free bacteria." },
];

test("a question about the diagram carries that diagram, and is not asked without it", () => {
	const shown = recessQuestionCandidates(cellLesson(true));
	expect(shown.length).toBeGreaterThan(2);
	for (const question of shown) if (pictureNeed(question) === "needs") expect(question.image?.id).toBe("img_cell");
	expect(shown.some(question => question.image?.src === PNG)).toBe(true);

	const blind = recessQuestionCandidates(cellLesson(false));
	expect(blind.length).toBeGreaterThan(2);
	expect(blind.filter(question => pictureNeed(question) === "needs")).toEqual([]);
	expect(blind.every(question => !question.image)).toBe(true);
	const pack = buildChatRecessPack(cellLesson(false))!;
	expect([...pack.gates, ...(pack.revive ?? [])].filter(question => pictureNeed(question) === "needs")).toEqual([]);
});

test("a model names its picture by id; an unknown id or a missing picture never reaches play", () => {
	const lesson = cellLesson(true);
	const asked = withQuestionPictures([
		{ q: "Which labelled part holds the DNA?", a: ["Nucleus", "Ribosome", "Membrane"], image: "img_cell" },
		{ q: "What does the picture show at the top?", a: ["Nucleus", "Ribosome", "Membrane"], image: "img_made_up" },
		{ q: "What do ribosomes build?", a: ["Proteins", "Sugars", "Fats"] },
	], lesson);
	expect(asked.map(question => question.image?.id)).toEqual(["img_cell", "img_cell", undefined]);
	expect(withQuestionPictures([{ q: "What does the picture show at the top?", a: ["A", "B", "C"] }], cellLesson(false))).toEqual([]);
	// "The graph" in graph theory is not a picture: kept, not dropped.
	expect(pictureFor({ q: "How many edges does the graph have?", a: ["3", "4", "5"] }, cellLesson(false))).toBeUndefined();
});

test("Jev and the explain grader read the picture's description, not its data", () => {
	const lesson = cellLesson(true);
	const pool = recessQuestionCandidates(lesson);
	const request = JSON.stringify(recessCurationRequest(lesson, pool));
	expect(request).not.toContain("data:image");
	if (pool.some(question => question.image)) expect(request).toContain("shownWithPicture");
	expect(JSON.stringify(recessExplainRequest(lesson, { prompt: "Why?", reference: "Because." }, "It is."))).not.toContain("data:image");
});

test("a question whose picture will not load is swapped for one that shows, before takeoff", () => {
	const image = { id: "img_broken", alt: "Broken", src: "https://example.invalid/x.png" };
	const pictured: RecessQuestion = { id: "p", q: "Which part is circled in the diagram?", a: ["Nucleus", "Ribosome", "Membrane"], image };
	const plain = (id: string): RecessQuestion => ({ id, q: `Question ${id}?`, a: ["Yes", "No", "Maybe"] });
	const pack = { gates: [plain("a"), pictured], revive: [plain("b")] };
	const fixed = swapUnloadedPictures(pack, new Set(["img_broken"]), [pictured, plain("a"), plain("b"), plain("c")]);
	expect(fixed.gates.map(question => question.id)).toEqual(["a", "c"]);
	expect(fixed.revive.map(question => question.id)).toEqual(["b"]);
	expect(swapUnloadedPictures(pack, new Set(), [])).toBe(pack);
});
