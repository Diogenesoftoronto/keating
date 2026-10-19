/**
 * Sandbox file browser state: current directory, entries, selected file,
 * editor content, dirty flag and baseline diff, plus the actions that mutate
 * the NodePod VFS. Decisions that can be tested without React live in
 * ./sandbox-helpers.
 */
import { useCallback, useEffect, useState } from "react";
import {
  nodePodCreatePath,
  nodePodDeletePath,
  nodePodDiffFile,
  nodePodReaddir,
  nodePodReadTextFile,
  nodePodWriteTextFile,
  type VfsEntry,
} from "../../keating/nodepod-runtime";
import type { LineDiff } from "../../keating/sandbox-engine";
import {
  WORKSPACE_ROOT,
  diffAgainstBaseline,
  errorMessage,
  fileReadFailureContent,
  parentDirectory,
  shouldComputeDiffOnToggle,
  type PushSandboxEvent,
} from "./sandbox-helpers";

export function useSandboxFiles({
  pushEvent,
  active,
}: {
  pushEvent: PushSandboxEvent;
  /** True while the Files tab is visible and NodePod is running; refreshes the listing. */
  active: boolean;
}) {
  const [vfsPath, setVfsPath] = useState(WORKSPACE_ROOT);
  const [vfsEntries, setVfsEntries] = useState<VfsEntry[]>([]);
  const [vfsLoading, setVfsLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState("");
  const [fileDirty, setFileDirty] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [diffLines, setDiffLines] = useState<LineDiff[]>([]);
  const [diffLoading, setDiffLoading] = useState(false);
  const [newName, setNewName] = useState("");
  const [createType, setCreateType] = useState<"file" | "dir">("file");

  const refreshVfs = useCallback(async () => {
    setVfsLoading(true);
    try {
      const entries = await nodePodReaddir(vfsPath).catch(() => []);
      setVfsEntries(entries);
    } catch {
      setVfsEntries([]);
    } finally {
      setVfsLoading(false);
    }
  }, [vfsPath]);

  useEffect(() => {
    if (active) void refreshVfs();
  }, [active, refreshVfs]);

  const openDir = useCallback((path: string) => {
    setVfsPath(path);
  }, []);

  const goUp = useCallback(() => {
    openDir(parentDirectory(vfsPath));
  }, [vfsPath, openDir]);

  const openFile = useCallback(async (path: string) => {
    setSelectedFile(path);
    setShowDiff(false);
    setDiffLines([]);
    try {
      const content = await nodePodReadTextFile(path);
      setFileContent(content);
      setFileDirty(false);
    } catch (e) {
      setFileContent(fileReadFailureContent(e));
      setFileDirty(false);
    }
  }, []);

  const computeDiff = useCallback(async () => {
    if (!selectedFile) return;
    setDiffLoading(true);
    try {
      setDiffLines(diffAgainstBaseline(await nodePodDiffFile(selectedFile)));
    } catch {
      setDiffLines([]);
    } finally {
      setDiffLoading(false);
    }
  }, [selectedFile]);

  const toggleDiff = useCallback(() => {
    setShowDiff((s) => !s);
    if (shouldComputeDiffOnToggle(showDiff)) void computeDiff();
  }, [showDiff, computeDiff]);

  const editContent = useCallback((value: string) => {
    setFileContent(value);
    setFileDirty(true);
  }, []);

  const saveFile = useCallback(async () => {
    if (!selectedFile) return;
    try {
      await nodePodWriteTextFile(selectedFile, fileContent);
      setFileDirty(false);
      pushEvent("vfs", `write ${selectedFile}`, true, { bytes: fileContent.length });
      refreshVfs();
    } catch (e) {
      pushEvent("vfs", `write ${selectedFile}`, false, { error: errorMessage(e) });
    }
  }, [selectedFile, fileContent, pushEvent, refreshVfs]);

  const deleteSelected = useCallback(async (path: string, isDir: boolean) => {
    try {
      await nodePodDeletePath(path, isDir);
      if (selectedFile === path) {
        setSelectedFile(null);
        setFileContent("");
      }
      pushEvent("vfs", `delete ${path}`, true, {});
      refreshVfs();
    } catch (e) {
      pushEvent("vfs", `delete ${path}`, false, { error: errorMessage(e) });
    }
  }, [selectedFile, pushEvent, refreshVfs]);

  const createItem = useCallback(async () => {
    if (!newName.trim()) return;
    try {
      await nodePodCreatePath(vfsPath, newName.trim(), createType === "dir");
      pushEvent("vfs", `create ${createType} ${newName}`, true, {});
      setNewName("");
      refreshVfs();
    } catch (e) {
      pushEvent("vfs", `create ${createType} ${newName}`, false, { error: errorMessage(e) });
    }
  }, [newName, vfsPath, createType, pushEvent, refreshVfs]);

  /** Drops the listing and selection after NodePod is torn down. */
  const resetAfterTeardown = useCallback(() => {
    setVfsEntries([]);
    setSelectedFile(null);
    setFileContent("");
  }, []);

  return {
    vfsPath,
    vfsEntries,
    vfsLoading,
    selectedFile,
    fileContent,
    fileDirty,
    showDiff,
    diffLines,
    diffLoading,
    newName,
    createType,
    setNewName,
    setCreateType,
    refreshVfs,
    openDir,
    goUp,
    openFile,
    toggleDiff,
    editContent,
    saveFile,
    deleteSelected,
    createItem,
    resetAfterTeardown,
  };
}

export type SandboxFiles = ReturnType<typeof useSandboxFiles>;
