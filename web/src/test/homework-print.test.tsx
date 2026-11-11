import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { UiDocument, UiTaskNode } from "@keating/learner-contracts";
import {
	assignmentFileName,
	buildAssignmentMarkdown,
	buildAssignmentPrintHtml,
	markdownToPrintHtml,
	submissionLines,
} from "../keating/homework/print-assignment";
import { projectAssignments } from "../keating/homework/open-assignments";
import { OpenAssignmentsSection } from "../components/homework/OpenAssignmentsSection";
import { PrintAssignmentButton } from "../components/homework/PrintAssignmentButton";
import { EarlierRounds, HomeworkRoundsContext } from "../components/homework/EarlierRounds";
import { SharedUiDocumentRenderer } from "../keating/openui/shared-renderer";

const HOSTILE = "</style><script>alert(1)</script><img src=x onerror=alert(2)>";
const NOW = Date.parse("2026-11-10T12:00:00.000Z");
const AT = "2026-11-01T09:00:00.000Z";

function task(overrides: Partial<UiTaskNode> = {}): UiTaskNode {
	return {
		type: "task",
		kind: "practice",
		id: "drills",
		title: "Update drills",
		brief: "Work each update **by hand**.\n\n- Show the prior\n- Show the posterior",
		criteria: ["States the prior", "Shows the arithmetic"],
		items: [{ id: "one", title: "Clean prior", detail: "Use 1 in 10." }, { id: "two", title: "Rare condition" }],
		estimatedMinutes: 30,
		dueAt: "2026-11-12T17:00:00.000Z",
		submission: { format: "text", targetWords: 200 },
		...overrides,
	};
}

function count(haystack: string, needle: string): number {
	return haystack.split(needle).length - 1;
}

describe("printable assignment", () => {
	test("escapes hostile model and learner text and contains no script", () => {
		const html = buildAssignmentPrintHtml(task({ title: HOSTILE, brief: HOSTILE, criteria: [HOSTILE], items: [{ id: "one", title: HOSTILE, detail: HOSTILE }] }), {
			mode: "answers",
			answers: { submission: HOSTILE, notes: { one: HOSTILE } },
			sessionTitle: HOSTILE,
		});
		expect(html).not.toContain("<script");
		expect(html).not.toContain("<img");
		expect(count(html, "</style>")).toBe(1);
		expect(html).toContain("&lt;/style&gt;&lt;script&gt;");
		expect(html).toContain("default-src 'none'");
	});

	test("prints the parts a learner needs on paper", () => {
		const html = buildAssignmentPrintHtml(task());
		expect(html).toStartWith("<!doctype html>");
		expect(html).toContain("Practice");
		expect(html).toContain("Update drills");
		expect(html).toContain("<strong>by hand</strong>");
		expect(html).toContain("<li>Show the prior</li>");
		expect(html).toContain("States the prior");
		expect(html).toContain("About 30 minutes");
		expect(html).toContain("Due:");
		expect(html).toContain("<span>Name</span><span>Date</span>");
		expect(html).toContain("@page");
		expect(html).toContain("break-inside: avoid");
	});

	test("gives every item its own writing space, and sizes the hand-in to the target length", () => {
		const html = buildAssignmentPrintHtml(task());
		expect(html).toContain('aria-label="Space to write for Clean prior"');
		expect(html).toContain('aria-label="Space to write for Rare condition"');
		expect(submissionLines(task())).toBe(20);
		expect(submissionLines(task({ submission: { format: "link" } }))).toBe(1);
		expect(submissionLines(task({ submission: { format: "none" } }))).toBe(0);
		expect(count(html, '<div class="line"></div>')).toBe(5 + 5 + 20);
	});

	test("blank and with-answers copies differ only by what the learner wrote", () => {
		const answers = { submission: "My worked answer", notes: { one: "Posterior is 0.47" } };
		const blank = buildAssignmentPrintHtml(task(), { mode: "blank", answers });
		const filled = buildAssignmentPrintHtml(task(), { mode: "answers", answers });
		expect(blank).not.toContain("My worked answer");
		expect(blank).not.toContain("Posterior is 0.47");
		expect(filled).toContain("My worked answer");
		expect(filled).toContain("Posterior is 0.47");
		expect(filled).toContain("with my answers");
	});

	test("describes an interactive diagram in plain language instead of a widget", () => {
		const html = buildAssignmentPrintHtml(task({
			kind: "assignment",
			diagram: { components: [{ id: "c", label: "Client", kind: "client" }], connections: [], checks: [{ id: "k", label: "Client reaches a cache", type: "path", from: "client", to: "cache" }], kinds: ["client", "cache"] } as unknown as NonNullable<UiTaskNode["diagram"]>,
		}));
		expect(html).toContain("interactive diagram on screen");
		expect(html).toContain("labelled box");
		expect(html).toContain("Client reaches a cache");
		expect(html).not.toContain("<svg");
		const recorded = buildAssignmentPrintHtml(task({ submission: { format: "text", capture: { kind: "audio", timeLimitSeconds: 120 } } }));
		expect(recorded).toContain("asks for an audio recording of about 2 minutes");
	});

	test("reduces brief markdown safely", () => {
		expect(markdownToPrintHtml("# Title\n\n1. one\n2. two\n\n[link](https://example.test)")).toBe("<h3>Title</h3>\n<ol>\n<li>one</li>\n<li>two</li>\n</ol>\n<p>link (https://example.test)</p>");
	});

	test("exports Markdown with and without answers", () => {
		const blank = buildAssignmentMarkdown(task());
		expect(blank).toStartWith("# Update drills\n");
		expect(blank).toContain("## Success criteria\n\n- States the prior");
		expect(blank).toContain("1. **Clean prior** — Use 1 in 10.");
		expect(blank).toContain("_Write your answer here._");
		const filled = buildAssignmentMarkdown(task(), { mode: "answers", answers: { submission: "Done by hand", notes: { two: "Base rate dominates" } } });
		expect(filled).toContain("Done by hand");
		expect(filled).toContain("   > Base rate dominates");
		expect(assignmentFileName(task({ title: "Update drills: round 2!" }), "md")).toBe("update-drills-round-2.md");
	});

	test("print control offers blank and with-answers only when there is something written", () => {
		const blank = renderToStaticMarkup(<PrintAssignmentButton node={task()} />);
		expect(blank).toContain(">Print<");
		expect(blank).not.toContain("Print with my answers");
		expect(blank).toContain("Download as Markdown");
		const written = renderToStaticMarkup(<PrintAssignmentButton node={task()} answers={{ submission: "half done" }} />);
		expect(written).toContain("Print blank");
		expect(written).toContain("Print with my answers");
	});
});

function doc(id: string, nodes: UiTaskNode[]): UiDocument {
	return { schemaVersion: 1, id, revision: 0, lifecycle: "ready", supportedSurfaces: ["web"], nodes, createdAt: AT, updatedAt: AT };
}

describe("Coming Up assignments section", () => {
	test("renders rows with what is asked, the due date in words and a session action", () => {
		const entries = projectAssignments([
			{ sessionId: "session-b", sessionTitle: "Bayes", documentId: "d1", presentedAt: NOW - 1_000, document: doc("d1", [task({ dueAt: "2026-11-08T12:00:00.000Z" })]), receipts: [] },
		], {}, NOW);
		const html = renderToStaticMarkup(<OpenAssignmentsSection open={entries} now={NOW} onOpen={() => undefined} />);
		expect(html).toContain("Open assignments");
		expect(html).toContain('data-session="session-b"');
		expect(html).toContain("Work each update by hand.");
		expect(html).toContain("Was due 2 days ago");
		expect(html).toContain("You can still hand it in.");
		expect(html).toContain("Not started");
		expect(html).toContain("0 of 2 exercises done");
		expect(html).toContain("Start in session");
		expect(html).toContain("From “Bayes”");
		expect(html).toContain("Download as Markdown");
	});

	test("explains how homework appears when there is none", () => {
		const html = renderToStaticMarkup(<OpenAssignmentsSection open={[]} now={NOW} onOpen={() => undefined} />);
		expect(html).toContain("data-open-assignments-empty");
		expect(html).toContain("When your tutor sets homework in a session");
	});
});

describe("revise loop in the task card", () => {
	test("shows the earlier round's submission and feedback with the current round", () => {
		const roundOne = { round: 1, documentId: "doc-r1", presentedAt: NOW - 10_000, submission: { text: "My first draft", attachments: [], submittedAt: NOW - 9_000 }, feedback: { text: "Lead with the **concrete case**.", at: NOW - 8_000 } };
		const current = doc("doc-r2", [task({ kind: "draft", round: 2, items: [] })]);
		const html = renderToStaticMarkup(<HomeworkRoundsContext.Provider value={{ peek: () => [roundOne], load: async () => [roundOne] }}>
			<SharedUiDocumentRenderer document={current} />
		</HomeworkRoundsContext.Provider>);
		expect(html).toContain("data-task-earlier-rounds");
		expect(html).toContain("Round 1: your work and the tutor&#x27;s feedback");
		expect(html).toContain("My first draft");
		expect(html).toContain("concrete case");
		expect(html).toContain("Round 2");
		expect(html.indexOf("data-task-earlier-rounds")).toBeLessThan(html.indexOf("Submit draft"));
	});

	test("a first round shows no earlier rounds, and the card says paper work can be attached", () => {
		const html = renderToStaticMarkup(<SharedUiDocumentRenderer document={doc("doc-1", [task({ kind: "assignment" })])} />);
		expect(html).not.toContain("data-task-earlier-rounds");
		expect(html).toContain("data-print-assignment");
		expect(html).toContain("Worked on paper? Attach a photo or scan");
	});

	test("an earlier round without a reply says so", () => {
		const html = renderToStaticMarkup(<EarlierRounds rounds={[{ round: 1, documentId: "x", presentedAt: 0, submission: { text: "t", attachments: [], submittedAt: 1 } }]} />);
		expect(html).toContain("no reply recorded yet");
	});
});
