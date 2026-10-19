/**
 * History tab of the sandbox runtime dialog: branch/commit controls, portable
 * export/import, commit list and commit diff. State and actions come from
 * useSandboxHistory.
 */
import Download from "reicon-react/icons/Download";
import GitBranch from "reicon-react/icons/BranchUp";
import GitCommit from "reicon-react/icons/Save";
import GitCompare from "reicon-react/icons/Code2";
import RefreshCw from "reicon-react/icons/Refresh";
import RotateCcw from "reicon-react/icons/RotateLeft";
import Upload from "reicon-react/icons/Upload";
import { css, cx } from "../../../styled-system/css";
import { KeatingIcon } from "../KeatingIcon";
import { visibleChanges } from "./sandbox-helpers";
import { styles } from "./sandbox-shared";
import type { SandboxHistory } from "./useSandboxHistory";

export function SandboxHistoryPanel({ history, nodePodActive }: { history: SandboxHistory; nodePodActive: boolean }) {
  const {
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
  } = history;
  if (!nodePodActive) {
    return (
      <div className={styles.textXsMuted}>
        Start NodePod to use version control.
      </div>
    );
  }
  return (
    <div className={styles.grid3}>
      <div className="runtime-view-intro"><h3>History</h3></div>
      {/* Branch controls */}
      <div className="runtime-wrap-toolbar">
        <span className={styles.semiboldXs}>
          Branch: <span className={styles.mono}>{vcActiveBranch}</span>
        </span>
        <div className={css({ display: "flex", alignItems: "center", gap: "0.375rem" })}>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            className={styles.hidden}
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void importPortableAction(file);
            }}
          />
          <button
            type="button"
            onClick={exportPortableAction}
            disabled={portableBusy}
            className={styles.outlineButtonSmBg}
          >
            <KeatingIcon icon={Download} size={12} /> Export
          </button>
          <button
            type="button"
            onClick={() => importInputRef.current?.click()}
            disabled={portableBusy}
            className={styles.outlineButtonSmBg}
          >
            <KeatingIcon icon={Upload} size={12} /> Import
          </button>
          <button
            type="button"
            onClick={refreshVc}
            className={styles.outlineButtonSmBg}
          >
            <KeatingIcon icon={RefreshCw} size={12} /> Refresh
          </button>
        </div>
      </div>

      {/* New branch */}
      <div className={css({ display: "flex", gap: "0.5rem" })}>
        <input
          className={styles.inputMono}
          aria-label="New branch name" placeholder="experiment-name"
          value={vcNewBranchName}
          onChange={(e) => setVcNewBranchName(e.target.value)}
        />
        <button
          type="button"
          onClick={createBranchAction}
          disabled={vcLoading || !vcNewBranchName.trim()}
          className={styles.primaryButton}
        >
          <KeatingIcon icon={GitBranch} size={13} /> Branch
        </button>
      </div>

      {/* Commit */}
      <div className={css({ display: "flex", gap: "0.5rem" })}>
        <input
          className={cx(styles.inputBase, css({ flex: 1 }))}
          aria-label="Commit message" placeholder="Describe your changes"
          value={vcCommitMessage}
          onChange={(e) => setVcCommitMessage(e.target.value)}
        />
        <button
          type="button"
          onClick={commitToVcAction}
          disabled={vcLoading}
          className={styles.primaryButton}
        >
          <KeatingIcon icon={GitCommit} size={13} /> Commit
        </button>
      </div>

      {/* Branches list */}
      {vcBranches.length > 0 && (
        <div className={css({ display: "grid", gap: "0.25rem" })}>
          <span className={css({ fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.025em", color: "var(--muted-foreground)" })}>Branches</span>
          {vcBranches.map((b) => (
            <div key={b.id} className={css({ display: "flex", alignItems: "center", justifyContent: "space-between", borderRadius: "0.375rem", borderWidth: "1px", borderColor: "var(--border)", padding: "0.375rem 0.75rem" })}>
              <span className={styles.monoXs}>{b.name}</span>
              {b.id !== vcActiveBranch && (
                <button
                  type="button"
                  onClick={() => switchBranchAction(b.id)}
                  disabled={vcLoading}
                  className={css({ display: "inline-flex", height: "1.5rem", alignItems: "center", gap: "0.25rem", borderRadius: "0.375rem", borderWidth: "1px", borderColor: "var(--border)", paddingInline: "0.5rem", fontSize: "10px", _hover: { background: "var(--accent)" }, _disabled: { opacity: 0.5 } })}
                >
                  <KeatingIcon icon={RotateCcw} size={10} /> Switch
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Commits list */}
      {vcCommits.length > 0 ? (
        <div className={styles.grid2}>
          <span className={css({ fontSize: "10px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.025em", color: "var(--muted-foreground)" })}>Commits</span>
          {vcCommits.map((c, i) => (
            <div key={c.id} className={css({ borderRadius: "0.375rem", borderWidth: "1px", borderColor: "var(--border)", padding: "0.5rem 0.75rem" })}>
              <div className="runtime-wrap-toolbar">
                <span className={css({ fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)", fontSize: "0.75rem", fontWeight: 500 })}>{c.id.slice(0, 24)}</span>
                <span className={styles.text10Muted}>{c.fileCount} files</span>
              </div>
              <div className={css({ marginTop: "0.125rem", fontSize: "0.75rem" })}>{c.message}</div>
              <div className={styles.text10Muted}>{new Date(c.createdAt).toLocaleString()}</div>
              <div className={css({ marginTop: "0.375rem", display: "flex", flexWrap: "wrap", gap: "0.25rem" })}>
                {i < vcCommits.length - 1 && (
                  <button
                    type="button"
                    onClick={() => diffCommitsAction(c.id, vcCommits[i + 1].id)}
                    className={css({ display: "inline-flex", height: "1.5rem", alignItems: "center", gap: "0.25rem", borderRadius: "0.375rem", borderWidth: "1px", borderColor: "var(--border)", paddingInline: "0.5rem", fontSize: "10px", _hover: { background: "var(--accent)" } })}
                  >
                    <KeatingIcon icon={GitCompare} size={10} /> Diff with next
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => restoreCommitAction(c.id)}
                  disabled={vcLoading}
                  title="Write this commit's files back into the sandbox"
                  className={css({ display: "inline-flex", height: "1.5rem", alignItems: "center", gap: "0.25rem", borderRadius: "0.375rem", borderWidth: "1px", borderColor: "var(--border)", paddingInline: "0.5rem", fontSize: "10px", _hover: { background: "var(--accent)" }, _disabled: { opacity: 0.5 } })}
                >
                  <KeatingIcon icon={RotateCcw} size={10} /> Restore
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className={styles.textXsMuted}>
          No commits yet. Edit a file, then commit to save a version.
        </div>
      )}

      {/* Diff view */}
      {vcDiff && (
        <div className={css({ borderRadius: "0.375rem", borderWidth: "1px", borderColor: "var(--border)", background: "rgb(from var(--muted) r g b / 0.1)", padding: "0.75rem" })}>
          <div className={css({ marginBottom: "0.5rem", display: "flex", alignItems: "center", justifyContent: "space-between" })}>
            <span className={styles.semiboldXs}>Diff</span>
            <button
              type="button"
              onClick={() => setVcDiff(null)}
              className={css({ fontSize: "10px", color: "var(--muted-foreground)", _hover: { color: "var(--foreground)" } })}
            >
              Close
            </button>
          </div>
          <div className={css({ display: "grid", maxHeight: "15rem", gap: "0.25rem", overflow: "auto" })}>
            {visibleChanges(vcDiff.changes).map((c) => (
              <div key={c.path} className={css({ display: "flex", alignItems: "center", gap: "0.5rem", fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)", fontSize: "0.75rem" })}>
                <span className={cx(css({ width: "4rem", flexShrink: 0, fontSize: "10px", fontWeight: 700 }), c.status === "added" ? css({ color: "#16a34a" }) : c.status === "removed" ? css({ color: "#dc2626" }) : css({ color: "#d97706" }))}>
                  {c.status.toUpperCase()}
                </span>
                <span className={css({ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" })}>{c.path}</span>
              </div>
            ))}
            {visibleChanges(vcDiff.changes).length === 0 && (
              <div className={styles.textXsMuted}>No changes</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
