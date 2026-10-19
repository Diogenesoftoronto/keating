/**
 * Artifact library: preview, copy path, export and recoverable trash.
 */
import { exportTuiArtifact, libraryArtifactOption, listTuiLibraryArtifacts, previewTuiArtifact, trashTuiArtifact } from "../../library.js";
import { sanitizeDiagnostic } from "../../view-model.js";
import type { HostContext } from "../context.js";
import { busySurfaceNotice, restoreIdleStatus, sourceBlock } from "./common.js";

export type LibraryDeps = Pick<HostContext, "cwd" | "dialogs" | "state" | "surface" | "view">;

export async function showLibrary(deps: LibraryDeps): Promise<void> {
  const { cwd, surface, dialogs } = deps;
  const { appendEntry, status, composer: input } = deps.view;
  const { presentSelect } = dialogs;
  if (busySurfaceNotice(deps, "Library")) return;
  status.content = "Loading artifact library…";
  try {
    const artifacts = await listTuiLibraryArtifacts(cwd);
    if (artifacts.length === 0) {
      appendEntry({ id: `library-empty-${Date.now()}`, kind: "notice", title: "Library is empty", body: "Generated plans, maps, decks, exports, benchmarks, and other artifacts will appear here." });
      return;
    }
    const artifactOptions = artifacts.map(libraryArtifactOption);
    const selected = await presentSelect("Library · newest artifacts first", artifactOptions);
    if (selected === undefined) return;
    const artifact = artifacts[artifactOptions.indexOf(selected)];
    if (!artifact) return;
    const action = await presentSelect(artifact.path, ["Open preview", "Copy path to composer", "Export copy", "Move to recoverable trash", "Cancel"]);
    if (action === undefined || action === "Cancel") return;
    if (action === "Open preview") {
      const preview = await previewTuiArtifact(cwd, artifact.path);
      appendEntry({
        id: `library-preview-${Date.now()}`,
        kind: "artifact",
        title: artifact.path,
        body: preview.kind === "text"
          ? preview.sourceOnly ? sourceBlock(artifact.path, preview.content) : preview.content
          : `${preview.message}\n\nSaved path: ${preview.path}`,
        detail: preview.kind === "text" && !preview.sourceOnly ? "Rendered through terminal Markdown" : "Safe handoff",
      });
      return;
    }
    if (action === "Copy path to composer") {
      input.value = artifact.path;
      appendEntry({
        id: `library-copy-${Date.now()}`,
        kind: "notice",
        title: "Artifact path prepared",
        body: `${artifact.path}\n\nThe path is in the composer. Edit or send it when ready.`,
      });
      return;
    }
    if (action === "Export copy") {
      const exported = await exportTuiArtifact(cwd, artifact.path);
      appendEntry({ id: `library-export-${Date.now()}`, kind: "notice", title: "Artifact exported", body: `Saved a separate copy at ${exported}. The source remains unchanged.` });
      return;
    }
    if (action === "Move to recoverable trash") {
      const confirmed = await surface.presentConfirm("Move artifact to trash?", `${artifact.path}\n\nThe file leaves the Library but remains recoverable under .keating/state/trash/.`);
      if (!confirmed) return;
      const trashPath = await trashTuiArtifact(cwd, artifact.path);
      appendEntry({ id: `library-trash-${Date.now()}`, kind: "notice", title: "Artifact moved to trash", body: `Recoverable path: ${trashPath}` });
    }
  } catch (error) {
    appendEntry({ id: `library-error-${Date.now()}`, kind: "error", title: "Library action failed", body: `${sanitizeDiagnostic(error)}\n\nNo successful-looking fallback was applied. Retry or use /shell with the preserved path.` });
  } finally {
    restoreIdleStatus(deps);
  }
}
