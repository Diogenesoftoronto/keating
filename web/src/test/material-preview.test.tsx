import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { UI_CONTRACT_VERSION, type UiActionReceipt, type UiDocumentNode } from "@keating/learner-contracts";
import { DeckPreview, QuizPreview, quizCompleted } from "../components/workspace/MaterialPreview";
import { ArtifactViewer } from "../components/ArtifactViewer";
import { artifactBrowserStorage } from "../components/artifact-browser-shared";

it("announces the saved library while its local records load", () => {
	const html = renderToStaticMarkup(<ArtifactViewer storage={artifactBrowserStorage} />);
	expect(html).toContain('role="status"');
	expect(html).toContain("Loading artifacts...");
});

type QuizNode = Extract<UiDocumentNode, { type: "quiz" }>;
type DeckNode = Extract<UiDocumentNode, { type: "deck" }>;

const quiz: QuizNode = { type: "quiz", id: "quiz", title: "Eigenvalues", questions: [
	{ id: "q1", prompt: "Which equation gives the eigenvalues?", kind: "multiple_choice", choices: [{ id: "q1-a", label: "det(A - xI) = 0" }, { id: "q1-b", label: "det(A) = x" }], correctAnswer: "q1-a", explanation: "The matrix must be singular." },
	{ id: "q2", prompt: "Find the eigenvalues of a diagonal matrix.", kind: "short_answer", correctAnswer: "Its diagonal entries", explanation: "Read them off the diagonal." },
] };
const deck: DeckNode = { type: "deck", id: "deck", title: "Vocabulary", topic: "Linear algebra", cards: [
	{ id: "c1", front: "Eigenvector", back: "A direction the matrix leaves unchanged." },
	{ id: "c2", front: "Eigenvalue", back: "The stretch factor." },
] };

const receipt = (type: string, nodeId: string, state: UiActionReceipt["state"]): UiActionReceipt => ({
	schemaVersion: UI_CONTRACT_VERSION, actionFingerprint: "f", state, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
	action: { type, nodeId } as unknown as UiActionReceipt["action"],
});

describe("quiz preview in the materials panel", () => {
	it("lists every question and its choices without a clock or answer controls", () => {
		const html = renderToStaticMarkup(<QuizPreview node={quiz} completed={false} />);
		expect(html).toContain("2 questions");
		expect(html).toContain("Which equation gives the eigenvalues?");
		expect(html).toContain("det(A) = x");
		expect(html).toContain("Multiple choice");
		expect(html).toContain("Short answer");
		expect(html).not.toContain("<button");
		expect(html).not.toContain("<input");
	});

	it("keeps answers and explanations out of an unfinished quiz", () => {
		const html = renderToStaticMarkup(<QuizPreview node={quiz} completed={false} />);
		expect(html).not.toContain("Show answer");
		expect(html).not.toContain("The matrix must be singular.");
		expect(html).not.toContain("Its diagonal entries");
		expect(html).toContain("after you finish it in the conversation");
	});

	it("offers each answer, as the learner saw it, once the quiz is finished", () => {
		const html = renderToStaticMarkup(<QuizPreview node={quiz} completed />);
		expect(html.match(/Show answer/g)).toHaveLength(2);
		// The stored answer is an option id; the preview shows the option's label.
		expect(html).not.toContain(">q1-a<");
		expect(html).toContain("Its diagonal entries");
		expect(html).toContain("The matrix must be singular.");
	});

	it("counts a quiz as finished only on an accepted completion of that quiz", () => {
		expect(quizCompleted([], "quiz")).toBe(false);
		expect(quizCompleted([receipt("complete-quiz", "quiz", "completed")], "quiz")).toBe(true);
		expect(quizCompleted([receipt("complete-quiz", "quiz", "accepted")], "quiz")).toBe(true);
		expect(quizCompleted([receipt("complete-quiz", "quiz", "rejected")], "quiz")).toBe(false);
		expect(quizCompleted([receipt("complete-quiz", "other", "completed")], "quiz")).toBe(false);
		expect(quizCompleted([receipt("submit-answer", "quiz", "completed")], "quiz")).toBe(false);
	});
});

describe("flashcard preview in the materials panel", () => {
	it("shows each front with its back behind a reveal, and says the schedule is untouched", () => {
		const html = renderToStaticMarkup(<DeckPreview node={deck} />);
		expect(html).toContain("2 cards");
		expect(html.match(/<details/g)).toHaveLength(2);
		expect(html).toContain("Eigenvector");
		expect(html).toContain("The stretch factor.");
		expect(html).toContain("review schedule only changes");
		expect(html).not.toContain("<button");
	});
});
