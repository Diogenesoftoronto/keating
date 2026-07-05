import { useCallback, useMemo, useState } from "react";
import { ChevronRight, Copy, Eye, FileJson } from "lucide-react";

import { css } from "../../styled-system/css";
interface JsonCrackBlockProps {
  value: unknown;
  maxHeight?: string;
  className?: string;
  title?: string;
  defaultMode?: "raw" | "graph";
}

type JsonNode = null | boolean | number | string | JsonNode[] | { [key: string]: JsonNode };

export function JsonCrackBlock({
  value,
  maxHeight = "24rem",
  className = "",
  title,
  defaultMode = "raw",
}: JsonCrackBlockProps) {
  const [mode, setMode] = useState<"raw" | "graph">(defaultMode);
  const jsonText = typeof value === "string" ? value : safeStringify(value);
  const parsed = useMemo(() => parseJson(jsonText), [jsonText]);
  const isValidJson = parsed.ok;

  const copyText = useCallback(async () => {
    await navigator.clipboard.writeText(jsonText);
  }, [jsonText]);

  return (
    <div className={`${css({ borderRadius: "0.375rem", border: "1px solid var(--border)" })} ${className}`}>
      <div className={css({ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem", borderBottom: "1px solid var(--border)", backgroundColor: "color-mix(in srgb, var(--muted) 20%, transparent)", paddingInline: "0.75rem", paddingBlock: "0.5rem" })}>
        <div className={css({ display: "flex", minWidth: 0, alignItems: "center", gap: "0.5rem" })}>
          <FileJson size={13} className={css({ flexShrink: 0, color: "var(--muted-foreground)" })} />
          {title && <span className={css({ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "0.75rem", fontWeight: 500 })}>{title}</span>}
          <span className={css({ flexShrink: 0, fontSize: "10px", color: "var(--muted-foreground)" })}>
            {jsonText.length > 1024 ? `${(jsonText.length / 1024).toFixed(1)} KB` : `${jsonText.length} B`}
          </span>
        </div>
        <div className={css({ display: "flex", flexShrink: 0, alignItems: "center", gap: "0.25rem" })}>
          {isValidJson && (
            <button
              type="button"
              onClick={() => setMode((m) => (m === "raw" ? "graph" : "raw"))}
              className={css({
                display: "inline-flex",
                height: "1.75rem",
                alignItems: "center",
                gap: "0.25rem",
                borderRadius: "0.375rem",
                paddingInline: "0.5rem",
                fontSize: "11px",
                fontWeight: 500,
                transitionProperty: "color, background-color, border-color",
                transitionDuration: "150ms",
                ...(mode === "graph"
                  ? { backgroundColor: "var(--primary)", color: "var(--primary-foreground)" }
                  : { border: "1px solid var(--border)", _hover: { background: "var(--accent)" } }),
              })}
            >
              <Eye size={11} />
              {mode === "graph" ? "Tree" : "Visualize"}
            </button>
          )}
          <button
            type="button"
            onClick={copyText}
            className={css({ display: "inline-flex", height: "1.75rem", alignItems: "center", gap: "0.25rem", borderRadius: "0.375rem", border: "1px solid var(--border)", paddingInline: "0.5rem", fontSize: "11px", transitionProperty: "color, background-color, border-color", transitionDuration: "150ms", _hover: { background: "var(--accent)" } })}
          >
            <Copy size={11} /> Copy
          </button>
        </div>
      </div>

      {mode === "raw" || !parsed.ok ? (
        <pre
          className={css({ overflow: "auto", whiteSpace: "pre-wrap", overflowWrap: "break-word", padding: "0.75rem", fontSize: "11px", fontFamily: "var(--mono-display)", lineHeight: "1.625" })}
          style={{ maxHeight }}
        >
          {jsonText.length > 10000 ? `${jsonText.slice(0, 10000)}\n\n... (truncated)` : jsonText}
        </pre>
      ) : (
        <div className={css({ overflow: "auto", padding: "0.75rem", fontSize: "11px", fontFamily: "var(--mono-display)", lineHeight: "1.625" })} style={{ maxHeight }}>
          <JsonTree value={parsed.value} name="root" depth={0} initiallyOpen />
        </div>
      )}
    </div>
  );
}

function JsonTree({
  name,
  value,
  depth,
  initiallyOpen = false,
}: {
  name: string;
  value: JsonNode;
  depth: number;
  initiallyOpen?: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen || depth < 2);
  const isArray = Array.isArray(value);
  const isObject = value !== null && typeof value === "object";

  if (!isArray && !isObject) {
    return (
      <div className={css({ display: "flex", minWidth: "max-content", alignItems: "baseline", gap: "0.25rem" })} style={{ paddingLeft: depth * 14 }}>
        <span className={css({ color: "var(--muted-foreground)" })}>{name}:</span>
        <JsonPrimitive value={value} />
      </div>
    );
  }

  const entries = Object.entries(value as JsonNode[] | { [key: string]: JsonNode });
  const summary = isArray ? `Array(${entries.length})` : `Object(${entries.length})`;

  return (
    <div className={css({ minWidth: "max-content" })}>
      <button
        type="button"
        onClick={() => setOpen((next) => !next)}
        className={css({ display: "flex", alignItems: "center", gap: "0.25rem", borderRadius: "0.125rem", paddingBlock: "0.125rem", paddingRight: "0.25rem", textAlign: "left", transitionProperty: "color, background-color, border-color", transitionDuration: "150ms", _hover: { background: "var(--accent)" } })}
        style={{ paddingLeft: depth * 14 }}
      >
        <ChevronRight
          size={12}
          className={css({ transitionProperty: "transform", transitionDuration: "150ms", transform: open ? "rotate(90deg)" : "rotate(0deg)" })}
        />
        <span className={css({ color: "var(--muted-foreground)" })}>{name}:</span>
        <span>{summary}</span>
      </button>
      {open && (
        <div>
          {entries.map(([key, child]) => (
            <JsonTree key={key} name={isArray ? `[${key}]` : key} value={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

function JsonPrimitive({ value }: { value: Exclude<JsonNode, JsonNode[] | { [key: string]: JsonNode }> }) {
  if (value === null) return <span className={css({ color: "var(--muted-foreground)" })}>null</span>;
  if (typeof value === "string") return <span className={css({ color: "#047857" })}>"{value}"</span>;
  if (typeof value === "number") return <span className={css({ color: "#0369a1" })}>{value}</span>;
  return <span className={css({ color: "#6d28d9" })}>{String(value)}</span>;
}

function parseJson(value: string): { ok: true; value: JsonNode } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(value) as JsonNode };
  } catch {
    return { ok: false };
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
