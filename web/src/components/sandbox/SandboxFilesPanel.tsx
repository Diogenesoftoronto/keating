/**
 * Files tab of the sandbox runtime dialog: directory listing, create-item row,
 * and the selected-file editor with baseline diff. State comes from
 * useSandboxFiles.
 */
import ChevronLeft from "reicon-react/icons/ChevronLeft";
import FileCode from "reicon-react/icons/CodeFile";
import FolderOpen from "reicon-react/icons/FolderOpen";
import GitCompare from "reicon-react/icons/Code2";
import Home from "reicon-react/icons/Home";
import Plus from "reicon-react/icons/Plus";
import Save from "reicon-react/icons/Save";
import Trash2 from "reicon-react/icons/Trash2";
import { css, cx } from "../../../styled-system/css";
import { KeatingIcon } from "../KeatingIcon";
import { Select } from "../Select";
import { fmtBytes } from "./sandbox-helpers";
import { RuntimeSpinner, styles } from "./sandbox-shared";
import type { SandboxFiles } from "./useSandboxFiles";

export function SandboxFilesPanel({ files, nodePodActive }: { files: SandboxFiles; nodePodActive: boolean }) {
  const {
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
    openDir,
    goUp,
    openFile,
    toggleDiff,
    editContent,
    saveFile,
    deleteSelected,
    createItem,
  } = files;
  if (!nodePodActive) {
    return (
      <div className={styles.textXsMuted}>
        Start NodePod to use the file system.
      </div>
    );
  }
  return (
    <div className={styles.grid3}>
      <div className={styles.flexCenter}>
        <button type="button" onClick={() => openDir("/workspace")} className={css({ display: "inline-flex", height: "1.75rem", width: "1.75rem", alignItems: "center", justifyContent: "center", borderRadius: "0.375rem", borderWidth: "1px", borderColor: "var(--border)", _hover: { background: "var(--accent)" } })} aria-label="Go to workspace" title="Go to /workspace"><KeatingIcon icon={Home} size={13} /></button>
        <button type="button" onClick={goUp} className={css({ display: "inline-flex", height: "1.75rem", width: "1.75rem", alignItems: "center", justifyContent: "center", borderRadius: "0.375rem", borderWidth: "1px", borderColor: "var(--border)", _hover: { background: "var(--accent)" } })} aria-label="Go to parent folder" title="Go up"><KeatingIcon icon={ChevronLeft} size={13} /></button>
        <span className="runtime-file-path runtime-mono-xs">{vfsPath}</span>
      </div>

      {vfsLoading ? (
        <div className={css({ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.75rem", color: "var(--muted-foreground)" })}><RuntimeSpinner size={13} /> Loading…</div>
      ) : (
        <div className={styles.card}>
          {vfsEntries.length === 0 ? (
            <div className={css({ padding: "0.75rem", fontSize: "0.75rem", color: "var(--muted-foreground)" })}>Empty directory</div>
          ) : (
            vfsEntries.map((entry) => (
              <div key={entry.path} data-file-row className={css({ display: "flex", alignItems: "center", gap: "0.5rem", borderBottomWidth: "1px", borderColor: "var(--border)", padding: "0.5rem 0.75rem", fontSize: "0.75rem", _last: { borderBottomWidth: 0 }, _hover: { background: "rgb(from var(--muted) r g b / 0.3)" } })}>
                <span className={css({ flexShrink: 0 })}>{entry.isDir ? <KeatingIcon icon={FolderOpen} size={14} className={css({ color: "var(--primary)" })} /> : <KeatingIcon icon={FileCode} size={14} className={css({ color: "var(--muted-foreground)" })} />}</span>
                <button
                  type="button"
                  className={css({ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textAlign: "left", fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)", _hover: { color: "var(--primary)" } })}
                  onClick={() => entry.isDir ? openDir(entry.path) : openFile(entry.path)}
                >
                  {entry.name}
                </button>
                <span className={css({ marginLeft: "auto", flexShrink: 0, fontSize: "0.75rem", color: "var(--muted-foreground)" })}>{entry.isDir ? "dir" : fmtBytes(entry.size)}</span>
                <button type="button" className={css({ flexShrink: 0, color: "rgb(from var(--destructive) r g b / 0.7)", _hover: { color: "var(--destructive)" } })} aria-label={`Delete ${entry.name}`} onClick={() => deleteSelected(entry.path, entry.isDir)}><KeatingIcon icon={Trash2} size={12} /></button>
              </div>
            ))
          )}
        </div>
      )}

      {/* create + editor */}
      <div className="runtime-create-item">
        <input
          className={css({ flex: 1, borderRadius: "0.375rem", borderWidth: "1px", borderColor: "var(--border)", background: "var(--background)", padding: "0.375rem 0.5rem", fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)", fontSize: "0.75rem" })}
          aria-label="New file or folder name" placeholder="new_name.js"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && createItem()}
        />
        <Select aria-label="New item type" className={cx("runtime-item-type", css({ borderRadius: "0.375rem", borderWidth: "1px", borderColor: "var(--border)", background: "var(--background)", padding: "0.375rem 0.5rem", fontSize: "0.75rem" }))} value={createType} onValueChange={(value) => setCreateType(value as "file" | "dir")}>
          <option value="file">File</option>
          <option value="dir">Folder</option>
        </Select>
        <button type="button" onClick={createItem} className={css({ display: "inline-flex", height: "2rem", alignItems: "center", gap: "0.25rem", borderRadius: "0.375rem", borderWidth: "1px", borderColor: "var(--border)", paddingInline: "0.5rem", fontSize: "0.75rem", _hover: { background: "var(--accent)" } })}>
          <KeatingIcon icon={Plus} size={12} /> Add
        </button>
      </div>

      {selectedFile && (
        <div className={styles.card}>
          <div className="runtime-file-toolbar">
            <span className={styles.semiboldXs}>{selectedFile}</span>
            <div className={css({ display: "flex", alignItems: "center", gap: "0.25rem" })}>
              {fileDirty && <span className={css({ fontSize: "0.75rem", color: "#d97706", _dark: { color: "#fcd34d" } })}>unsaved</span>}
              <button
                type="button"
                onClick={toggleDiff}
                className={cx(
                  css({ display: "inline-flex", height: "1.75rem", alignItems: "center", gap: "0.25rem", borderRadius: "0.375rem", borderWidth: "1px", paddingInline: "0.5rem", fontSize: "0.75rem" }),
                  showDiff
                    ? css({ borderColor: "var(--secondary)", background: "var(--secondary)", color: "var(--secondary-foreground)" })
                    : css({ borderColor: "var(--border)", _hover: { background: "var(--accent)" } })
                )}
              >
                <KeatingIcon icon={GitCompare} size={12} /> {showDiff ? "Hide diff" : "Show diff"}
              </button>
              <button type="button" onClick={saveFile} className={styles.primaryButtonSm}><KeatingIcon icon={Save} size={12} /> Save</button>
            </div>
          </div>

          {showDiff ? (
            <div className={css({ minHeight: "12rem", width: "100%", overflow: "auto", background: "var(--background)", padding: "0.5rem 0.75rem", fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)", fontSize: "0.75rem", lineHeight: 1.625 })}>
              {diffLoading ? (
                <div className={css({ display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--muted-foreground)" })}><RuntimeSpinner size={13} /> Computing diff…</div>
              ) : diffLines.length === 0 ? (
                <div className={css({ color: "var(--muted-foreground)" })}>No changes — file matches baseline.</div>
              ) : (
                <div className={css({ display: "grid", gap: 0 })}>
                  {diffLines.map((line, idx) => (
                    <div
                      key={idx}
                      className={cx(
                        css({ display: "flex", gap: "0.5rem", paddingInline: "0.25rem" }),
                        line.type === "removed"
                          ? css({ background: "rgb(239 68 68 / 0.1)", color: "#b91c1c", _dark: { color: "#fca5a5" } })
                          : line.type === "added"
                          ? css({ background: "rgb(34 197 94 / 0.1)", color: "#15803d", _dark: { color: "#86efac" } })
                          : css({ color: "var(--muted-foreground)" })
                      )}
                    >
                      <span className={css({ width: "1rem", flexShrink: 0, userSelect: "none", textAlign: "center", fontSize: "10px", opacity: 0.5 })}>
                        {line.type === "removed" ? "-" : line.type === "added" ? "+" : " "}
                      </span>
                      <span className={css({ wordBreak: "break-all" })}>{line.content}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <textarea
              className={css({ minHeight: "12rem", width: "100%", resize: "vertical", background: "var(--background)", padding: "0.5rem 0.75rem", fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace)", fontSize: "0.75rem", lineHeight: 1.625 })}
              spellCheck={false}
              aria-label={`Edit ${selectedFile}`}
              value={fileContent}
              onChange={(e) => editContent(e.target.value)}
            />
          )}
        </div>
      )}
    </div>
  );
}
