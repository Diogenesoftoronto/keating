import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { SandboxFilesPanel } from "../components/sandbox/SandboxFilesPanel";
import { SandboxHistoryPanel } from "../components/sandbox/SandboxHistoryPanel";
import type { SandboxFiles } from "../components/sandbox/useSandboxFiles";
import type { SandboxHistory } from "../components/sandbox/useSandboxHistory";

describe("sandbox panels", () => {
	test("inactive NodePod shows the start prompt instead of controls", () => {
		const files = renderToStaticMarkup(<SandboxFilesPanel files={{} as SandboxFiles} nodePodActive={false} />);
		expect(files).toContain("Start NodePod to use the file system.");
		const history = renderToStaticMarkup(<SandboxHistoryPanel history={{} as SandboxHistory} nodePodActive={false} />);
		expect(history).toContain("Start NodePod to use version control.");
	});

	test("history panel renders branch, empty commits and commit controls", () => {
		const noop = () => {};
		const history = {
			vcBranches: [{ id: "main", name: "main" }, { id: "exp", name: "exp" }],
			vcCommits: [],
			vcActiveBranch: "main",
			vcCommitMessage: "",
			vcNewBranchName: "",
			vcLoading: false,
			vcDiff: null,
			portableBusy: false,
			importInputRef: { current: null },
			setVcCommitMessage: noop,
			setVcNewBranchName: noop,
			setVcDiff: noop,
			refreshVc: noop,
			createBranchAction: noop,
			switchBranchAction: noop,
			commitToVcAction: noop,
			diffCommitsAction: noop,
			restoreCommitAction: noop,
			exportPortableAction: noop,
			importPortableAction: noop,
		} as unknown as SandboxHistory;
		const html = renderToStaticMarkup(<SandboxHistoryPanel history={history} nodePodActive />);
		expect(html).toContain("Branch: ");
		expect(html).toContain("No commits yet.");
		expect(html).toContain('aria-label="Commit message"');
		expect(html).toContain("Switch");
	});
});
