/**
 * Sandbox version-control state: branches, commits, active branch, commit and
 * branch inputs, commit diff, and portable export/import. Actions report to
 * the activity log through the injected pushEvent and ask the host to refresh
 * the VFS / saved snapshots when they change them.
 */
import { useCallback, useRef, useState } from "react";
import {
  nodePodGetAllFileContents,
  nodePodWriteTextFile,
} from "../../keating/nodepod-runtime";
import {
  getSandboxRepo,
  sandboxCheckoutBranch,
  sandboxCommit,
  sandboxCreateBranch,
  sandboxDiffCommits,
  sandboxListBranches,
  sandboxListCommits,
  sandboxReadCommitFiles,
  type SandboxBranch,
  type SandboxCommit,
} from "../../keating/sandbox-git";
import {
  buildSandboxPortableBundle,
  importSandboxPortableBundle,
  type KeatingSandboxPortableBundle,
} from "../../keating/sandbox-export";
import {
  commitMessageOrDefault,
  errorMessage,
  portableExportFilename,
  type PushSandboxEvent,
} from "./sandbox-helpers";

export type SandboxDiffChange = Awaited<ReturnType<typeof sandboxDiffCommits>>[number];

export interface SandboxCommitDiff {
  fromCommit: string;
  toCommit: string;
  changes: SandboxDiffChange[];
}

export function useSandboxHistory({
  pushEvent,
  refreshVfs,
  refreshDbSnapshots,
}: {
  pushEvent: PushSandboxEvent;
  refreshVfs: () => Promise<void>;
  refreshDbSnapshots: () => Promise<void>;
}) {
  const [vcBranches, setVcBranches] = useState<SandboxBranch[]>([]);
  const [vcCommits, setVcCommits] = useState<SandboxCommit[]>([]);
  const [vcActiveBranch, setVcActiveBranch] = useState<string>("main");
  const [vcCommitMessage, setVcCommitMessage] = useState("");
  const [vcNewBranchName, setVcNewBranchName] = useState("");
  const [vcLoading, setVcLoading] = useState(false);
  const [vcDiff, setVcDiff] = useState<SandboxCommitDiff | null>(null);
  const [portableBusy, setPortableBusy] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  const refreshVc = useCallback(async () => {
    try {
      const [branches, commits] = await Promise.all([
        sandboxListBranches(),
        sandboxListCommits(),
      ]);
      const repo = await getSandboxRepo();
      const activeId = await repo.activeBranchId();
      setVcBranches(branches);
      setVcCommits(commits);
      setVcActiveBranch(activeId);
    } catch {
      setVcBranches([]);
      setVcCommits([]);
    }
  }, []);

  const createBranchAction = useCallback(async () => {
    if (!vcNewBranchName.trim()) return;
    setVcLoading(true);
    try {
      await sandboxCreateBranch(vcNewBranchName.trim());
      setVcNewBranchName("");
      await refreshVc();
      pushEvent("vc", "branch.create", true, { name: vcNewBranchName.trim() });
    } catch (e) {
      pushEvent("vc", "branch.create", false, { error: errorMessage(e) });
    } finally {
      setVcLoading(false);
    }
  }, [vcNewBranchName, refreshVc, pushEvent]);

  const switchBranchAction = useCallback(async (branchId: string) => {
    setVcLoading(true);
    try {
      await sandboxCheckoutBranch(branchId);
      await refreshVc();
      pushEvent("vc", "branch.switch", true, { branchId });
    } catch (e) {
      pushEvent("vc", "branch.switch", false, { error: errorMessage(e) });
    } finally {
      setVcLoading(false);
    }
  }, [refreshVc, pushEvent]);

  const commitToVcAction = useCallback(async () => {
    const message = commitMessageOrDefault(vcCommitMessage, Date.now());
    setVcLoading(true);
    try {
      const files = await nodePodGetAllFileContents();
      const commitId = await sandboxCommit(files, message);
      setVcCommitMessage("");
      await refreshVc();
      pushEvent("vc", "commit", true, { commitId, files: files.length });
    } catch (e) {
      pushEvent("vc", "commit", false, { error: errorMessage(e) });
    } finally {
      setVcLoading(false);
    }
  }, [vcCommitMessage, refreshVc, pushEvent]);

  const diffCommitsAction = useCallback(async (fromCommitId: string, toCommitId: string) => {
    setVcLoading(true);
    try {
      const changes = await sandboxDiffCommits(fromCommitId, toCommitId);
      setVcDiff({ fromCommit: fromCommitId, toCommit: toCommitId, changes });
    } catch {
      setVcDiff(null);
    } finally {
      setVcLoading(false);
    }
  }, []);

  const restoreCommitAction = useCallback(async (commitId: string) => {
    const started = performance.now();
    setVcLoading(true);
    try {
      const files = await sandboxReadCommitFiles(commitId);
      for (const file of files) {
        await nodePodWriteTextFile(file.path, file.content);
      }
      await refreshVfs();
      pushEvent("vc", "commit.restore", true, { commitId, files: files.length }, Math.round(performance.now() - started));
    } catch (e) {
      pushEvent("vc", "commit.restore", false, { error: errorMessage(e) }, Math.round(performance.now() - started));
    } finally {
      setVcLoading(false);
    }
  }, [pushEvent, refreshVfs]);

  const exportPortableAction = useCallback(async () => {
    setPortableBusy(true);
    try {
      const bundle = await buildSandboxPortableBundle();
      const text = `${JSON.stringify(bundle, null, 2)}\n`;
      const blob = new Blob([text], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = portableExportFilename(new Date());
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      pushEvent("vc", "portable.export", true, {
        files: bundle.nodepod.files.length,
        snapshots: bundle.nodepod.snapshots.length,
        gitObjects: Object.keys(bundle.vc.objects).length,
      });
    } catch (e) {
      pushEvent("vc", "portable.export", false, { error: errorMessage(e) });
    } finally {
      setPortableBusy(false);
    }
  }, [pushEvent]);

  const importPortableAction = useCallback(async (file: File) => {
    setPortableBusy(true);
    try {
      const text = await file.text();
      const bundle = JSON.parse(text) as KeatingSandboxPortableBundle;
      const result = await importSandboxPortableBundle(bundle);
      await Promise.all([refreshVc(), refreshDbSnapshots()]);
      await refreshVfs();
      pushEvent("vc", "portable.import", true, result);
    } catch (e) {
      pushEvent("vc", "portable.import", false, { error: errorMessage(e) });
    } finally {
      setPortableBusy(false);
      if (importInputRef.current) importInputRef.current.value = "";
    }
  }, [pushEvent, refreshDbSnapshots, refreshVc, refreshVfs]);

  return {
    vcBranches,
    vcCommits,
    vcActiveBranch,
    vcCommitMessage,
    vcNewBranchName,
    vcLoading,
    vcDiff,
    portableBusy,
    importInputRef,
    setVcCommitMessage,
    setVcNewBranchName,
    setVcDiff,
    refreshVc,
    createBranchAction,
    switchBranchAction,
    commitToVcAction,
    diffCommitsAction,
    restoreCommitAction,
    exportPortableAction,
    importPortableAction,
  };
}

export type SandboxHistory = ReturnType<typeof useSandboxHistory>;
