import { useCallback, useMemo, useState } from "react";
import { ChevronRight, Copy, Eye, FileJson } from "lucide-react";

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
    <div className={`rounded-md border border-border ${className}`}>
      <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/20 px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <FileJson size={13} className="shrink-0 text-muted-foreground" />
          {title && <span className="truncate text-xs font-medium">{title}</span>}
          <span className="shrink-0 text-[10px] text-muted-foreground">
            {jsonText.length > 1024 ? `${(jsonText.length / 1024).toFixed(1)} KB` : `${jsonText.length} B`}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {isValidJson && (
            <button
              type="button"
              onClick={() => setMode((m) => (m === "raw" ? "graph" : "raw"))}
              className={`inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium transition-colors ${
                mode === "graph"
                  ? "bg-primary text-primary-foreground"
                  : "border border-border hover:bg-accent"
              }`}
            >
              <Eye size={11} />
              {mode === "graph" ? "Tree" : "Visualize"}
            </button>
          )}
          <button
            type="button"
            onClick={copyText}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[11px] hover:bg-accent"
          >
            <Copy size={11} /> Copy
          </button>
        </div>
      </div>

      {mode === "raw" || !parsed.ok ? (
        <pre
          className="overflow-auto whitespace-pre-wrap break-words p-3 text-[11px] font-mono leading-relaxed"
          style={{ maxHeight }}
        >
          {jsonText.length > 10000 ? `${jsonText.slice(0, 10000)}\n\n... (truncated)` : jsonText}
        </pre>
      ) : (
        <div className="overflow-auto p-3 text-[11px] font-mono leading-relaxed" style={{ maxHeight }}>
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
      <div className="flex min-w-max items-baseline gap-1" style={{ paddingLeft: depth * 14 }}>
        <span className="text-muted-foreground">{name}:</span>
        <JsonPrimitive value={value} />
      </div>
    );
  }

  const entries = Object.entries(value as JsonNode[] | { [key: string]: JsonNode });
  const summary = isArray ? `Array(${entries.length})` : `Object(${entries.length})`;

  return (
    <div className="min-w-max">
      <button
        type="button"
        onClick={() => setOpen((next) => !next)}
        className="flex items-center gap-1 rounded-sm py-0.5 pr-1 text-left hover:bg-accent"
        style={{ paddingLeft: depth * 14 }}
      >
        <ChevronRight size={12} className={`transition-transform ${open ? "rotate-90" : ""}`} />
        <span className="text-muted-foreground">{name}:</span>
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
  if (value === null) return <span className="text-muted-foreground">null</span>;
  if (typeof value === "string") return <span className="text-emerald-700 dark:text-emerald-300">"{value}"</span>;
  if (typeof value === "number") return <span className="text-sky-700 dark:text-sky-300">{value}</span>;
  return <span className="text-violet-700 dark:text-violet-300">{String(value)}</span>;
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
