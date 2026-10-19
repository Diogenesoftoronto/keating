import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { parseOpenUIMessageSegments } from "../keating/openui/segments";
import { __test_InertOpenUISourceRecovery, __claimOpenUICompileRecovery, __resetOpenUICompileRecovery, KeatingOpenUIActionProvider, KeatingOpenUIRenderer, type KeatingOpenUIActionHandler } from "../keating/openui/renderer";
import { createReactMountHarness } from "./helpers/react-mount";

const metadata = {
	id: "session-message-source",
	lifecycle: "resumable" as const,
	revision: 0,
};
const source = [
	'root = LearningSurface([question], "Bayes check", "", "resumable")',
	'question = Question([{ question: "What changes the posterior?", type: "choice", choices: ["Evidence", "Typography"], allowText: true }], "resumable", "Bayes", "Explain your choice.")',
].join("\n");

describe("completed browser OpenUI source cutover", () => {
	test("keeps unclosed source inert instead of mounting the legacy renderer", () => {
		const html = renderToStaticMarkup(
			<KeatingOpenUIRenderer program={source} source={source} metadata={metadata} sourceComplete={false} isStreaming />,
		);
		expect(html).not.toContain("data-shared-openui-document");
		expect(html).toContain('data-openui-source-recovery="incomplete"');
		expect(html).not.toContain("What changes the posterior?");
		expect(html).toContain("still being prepared");
		expect(html).not.toContain("Submit answers");
	});

	test("switches a closed valid fence to one canonical grouped interaction", () => {
		const html = renderToStaticMarkup(
			<KeatingOpenUIRenderer program={source} metadata={metadata} sourceComplete />,
		);
		expect(html).toContain('data-shared-openui-document="session-message-source"');
		expect(html).toContain("Explain your choice.");
		expect(html).toContain("What changes the posterior?");
		expect(html.match(/Finish check/g)?.length).toBe(1);
		expect(html).not.toContain("canonical migration failed");
	});

	test("fails closed to inert recovery without mounting the legacy interaction", () => {
		const invalid = [
			'root = LearningSurface([question, missing], "Still readable")',
			'question = Question([{ question: "Keep my answer", type: "text" }])',
		].join("\n");
		const html = renderToStaticMarkup(
			<KeatingOpenUIRenderer program={invalid} metadata={metadata} sourceComplete />,
		);
		expect(html).not.toContain("data-shared-openui-document");
		expect(html).not.toContain("data-openui-source-recovery");
		expect(html).not.toContain("could not be displayed");
		expect(html).not.toContain("Keep my answer");
		expect(html).not.toContain("Submit answers");
	});

	test("lowers a persisted animation to a safe handoff without mounting its authored HTML", () => {
		const unsafe = [
			'root = LearningSurface([animation], "Retired component")',
			'animation = LearningAnimation("Topic", "<script>globalThis.__executed = true</script>")',
		].join("\n");
		const html = renderToStaticMarkup(
			<KeatingOpenUIRenderer program={unsafe} source={unsafe} metadata={metadata} sourceComplete />,
		);
		expect(html).toContain('data-shared-openui-document="session-message-source"');
		expect(html).not.toContain('data-openui-source-recovery="rejected"');
		expect(html).not.toContain("<iframe");
		expect(html).not.toContain("<script>");
		expect(html).not.toContain("&lt;script&gt;");
		expect(html).toContain("Open the Topic animation in Keating web");
	});
});


describe("learning surface simulation fence completion", () => {
	const simulation = 'root = LearningSurface([sim], "Growth")\nsim = Simulation({ title: "Growth", parameters: [{ id: "rate", label: "Rate", min: 0, max: 10, value: 2 }], readouts: [{ id: "double", label: "Double", expr: "rate * 2" }] })';
	for (const [name, newline, close] of [["CRLF", "\r\n", "```"], ["trailing whitespace", "\n", "``` \t"], ["indented closing fence", "\n", "   ```"]]) {
		test(`renders a completed simulation with ${name}`, () => {
			const message = `\`\`\`openui${newline}${simulation.replaceAll("\n", newline)}${newline}${close}${newline}Keep exploring.`;
			const segments = parseOpenUIMessageSegments(message);
			const segment = segments[0];
			if (segment.type !== "openui") throw new Error("Expected simulation source");
			expect(segment.complete).toBe(true);
			const html = renderToStaticMarkup(<KeatingOpenUIRenderer program={segment.program} source={segment.rawProgram} sourceComplete={segment.complete} metadata={segment.metadata} />);
			expect(html).toContain("data-shared-openui-document");
			expect(html).toContain("Double");
			expect(html).not.toContain("data-openui-source-recovery");
			expect(segments[1]).toEqual({ type: "text", content: "Keep exploring." });
		});
	}
	test("keeps compiler diagnostics and source available in developer mode", () => {
		const broken = 'root = LearningSurface([missing], "Readable lesson")';
		const html = renderToStaticMarkup(<KeatingOpenUIRenderer program={broken} metadata={metadata} developerMode />);
		expect(html).toContain("Development details");
		expect(html).toContain("Readable lesson");
		expect(html).toContain("missing");
	});
});


test("a stopped unfinished simulation removes inert content instead of claiming it is still streaming", () => {
	const html = renderToStaticMarkup(<KeatingOpenUIRenderer program={source} source={source} metadata={metadata} sourceComplete={false} />);
	expect(html).not.toContain("data-openui-source-recovery");
	expect(html).not.toContain("ask Keating to rebuild");
	expect(html).not.toContain("still being prepared");
	expect(html).not.toContain("data-shared-openui-document");
	expect(html).not.toContain("LearningSurface");
});


test("automatic repair claims are bounded and deduplicated", () => {
	__resetOpenUICompileRecovery();
	expect(__claimOpenUICompileRecovery("first", "invalid")).toBe(1);
	expect(__claimOpenUICompileRecovery("first", "invalid")).toBeNull();
	expect(__claimOpenUICompileRecovery("second", "unsupported")).toBe(2);
	expect(__claimOpenUICompileRecovery("third", "invalid")).toBe(3);
	expect(__claimOpenUICompileRecovery("fourth", "invalid")).toBeNull();
	__resetOpenUICompileRecovery();
});

test("mounted repair requests deduplicate remounts and stay isolated by document and session", async () => {
	__resetOpenUICompileRecovery();
	const attempts: number[] = [];
	const documentIds: string[] = [];
	const onAction: KeatingOpenUIActionHandler = action => {
		attempts.push(Number(action.params.attempt));
		documentIds.push(action.document.id);
		return true;
	};
	const invalid = 'root = LearningSurface([missing], "Broken interaction")';
	const elementFor = (id: string) => (
		<KeatingOpenUIActionProvider onAction={onAction}>
			<KeatingOpenUIRenderer program={invalid} metadata={{ ...metadata, id }} developerMode />
		</KeatingOpenUIActionProvider>
	);
	const firstSession = createReactMountHarness();
	await firstSession.render(elementFor("document-a"));
	await firstSession.unmount();
	await firstSession.render(elementFor("document-a"));
	await firstSession.render(elementFor("document-b"));
	expect(attempts).toEqual([1, 2]);
	expect(documentIds).toEqual(["document-a", "document-b"]);
	await firstSession.unmount();

	__resetOpenUICompileRecovery();
	const secondSession = createReactMountHarness();
	await secondSession.render(elementFor("document-a"));
	expect(attempts).toEqual([1, 2, 1]);
	expect(documentIds).toEqual(["document-a", "document-b", "document-a"]);
	await secondSession.unmount();
	__resetOpenUICompileRecovery();
});


test("developer mode preserves inert source and compiler error during automatic rebuilding", () => {
	const html = renderToStaticMarkup(<__test_InertOpenUISourceRecovery source={source} state="rebuilding" developerMode error="Missing simulation parameter" attempt={2} />);
	expect(html).toContain("Rebuilding this interaction");
	expect(html).toContain("Development details");
	expect(html).toContain("Missing simulation parameter");
	expect(html).toContain("LearningSurface");
	expect(html).not.toContain("data-shared-openui-document");
});
