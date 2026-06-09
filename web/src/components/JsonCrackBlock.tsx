import { useEffect, useRef, useState, useCallback } from "react";
import { Copy, ExternalLink, Eye, FileJson, Loader2 } from "lucide-react";

interface JsonCrackBlockProps {
  value: unknown;
  maxHeight?: string;
  className?: string;
  title?: string;
  defaultMode?: "raw" | "graph";
}

/**
 * Reusable JSON display block with JSON Crack graph visualization.
 *
 * Two modes:
 *   - "graph": embeds jsoncrack.com/widget via iframe + postMessage
 *   - "editor": opens https://jsoncrack.com/editor in a new tab with the JSON payload
 *
 * The iframe widget can be flaky with third-party cookie blockers / CSP, so
 * we also provide a reliable "Open in JSON Crack" button that always works.
 */
export function JsonCrackBlock({
  value,
  maxHeight = "24rem",
  className = "",
  title,
  defaultMode = "raw",
}: JsonCrackBlockProps) {
  const [mode, setMode] = useState<"raw" | "graph">(defaultMode);
  const [graphState, setGraphState] = useState<"loading" | "ready" | "error">("loading");
  const [graphError, setGraphError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const sentRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const jsonText = typeof value === "string" ? value : safeStringify(value);

  const sendToWidget = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow || sentRef.current) return;
    try {
      iframe.contentWindow.postMessage(
        {
          json: jsonText,
          options: {
            theme: document.documentElement.classList.contains("dark") ? "dark" : "light",
            direction: "DOWN",
          },
        },
        "*"
      );
      sentRef.current = true;
    } catch {
      setGraphState("error");
      setGraphError("Could not send data to JSON Crack widget.");
    }
  }, [jsonText]);

  // Reset state when switching modes
  useEffect(() => {
    if (mode === "graph") {
      setGraphState("loading");
      setGraphError(null);
      sentRef.current = false;
      // Safety timeout: if widget never signals ready, show error
      timerRef.current = setTimeout(() => {
        if (!sentRef.current) {
          setGraphState("error");
          setGraphError(
            "JSON Crack widget did not load. This may be due to a third-party cookie blocker or network issue. Try opening in a new tab instead."
          );
        }
      }, 8000);
    } else {
      sentRef.current = false;
      if (timerRef.current) clearTimeout(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [mode]);

  // Listen for widget ready signal + iframe onLoad
  useEffect(() => {
    if (mode !== "graph") return;

    const handler = (event: MessageEvent) => {
      // JSON Crack widget signals ready by posting its iframe id back
      const isReady =
        event.data === "json-crack-embed" ||
        event.data?.source === "jsoncrack" ||
        event.data?.type === "ready" ||
        (typeof event.data === "string" && event.data.includes("jsoncrack"));

      if (isReady) {
        setGraphState("ready");
        sendToWidget();
      }
    };

    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [mode, sendToWidget]);

  const copyText = useCallback(async () => {
    await navigator.clipboard.writeText(jsonText);
  }, [jsonText]);

  const openInJsonCrack = useCallback(() => {
    try {
      // Encode JSON as base64 data URI so we can pass it inline
      const base64 = btoa(unescape(encodeURIComponent(jsonText)));
      const dataUri = `data:application/json;base64,${base64}`;
      const url = `https://jsoncrack.com/editor?json=${encodeURIComponent(dataUri)}`;
      window.open(url, "_blank", "noopener,noreferrer");
    } catch {
      // Fallback: open editor empty and user can paste
      window.open("https://jsoncrack.com/editor", "_blank", "noopener,noreferrer");
    }
  }, [jsonText]);

  const isValidJson = (() => {
    try {
      JSON.parse(jsonText);
      return true;
    } catch {
      return false;
    }
  })();

  return (
    <div className={`rounded-md border border-border ${className}`}>
      {/* toolbar */}
      <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/20 px-3 py-2">
        <div className="flex items-center gap-2">
          <FileJson size={13} className="text-muted-foreground" />
          {title && <span className="text-xs font-medium">{title}</span>}
          <span className="text-[10px] text-muted-foreground">
            {jsonText.length > 1024 ? `${(jsonText.length / 1024).toFixed(1)} KB` : `${jsonText.length} B`}
          </span>
        </div>
        <div className="flex items-center gap-1">
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
              {mode === "graph" ? "Graph" : "Visualize"}
            </button>
          )}
          <button
            type="button"
            onClick={copyText}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[11px] hover:bg-accent"
          >
            <Copy size={11} /> Copy
          </button>
          <button
            type="button"
            onClick={openInJsonCrack}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-[11px] hover:bg-accent"
            title="Open in JSON Crack"
          >
            <ExternalLink size={11} />
          </button>
        </div>
      </div>

      {/* body */}
      {mode === "raw" ? (
        <pre
          className="overflow-auto whitespace-pre-wrap break-words p-3 text-[11px] font-mono leading-relaxed"
          style={{ maxHeight }}
        >
          {jsonText.length > 10000 ? jsonText.slice(0, 10000) + "\n\n… (truncated)" : jsonText}
        </pre>
      ) : (
        <div className="relative" style={{ height: maxHeight }}>
          {graphState === "loading" && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-background">
              <Loader2 size={18} className="animate-spin text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Loading graph…</span>
            </div>
          )}
          {graphState === "error" && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background p-6 text-center">
              <div className="text-xs text-destructive">{graphError}</div>
              <button
                type="button"
                onClick={openInJsonCrack}
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent"
              >
                <ExternalLink size={12} /> Open in JSON Crack
              </button>
            </div>
          )}
          <iframe
            ref={iframeRef}
            id="json-crack-embed"
            src="https://jsoncrack.com/widget"
            className="h-full w-full border-0"
            style={{ opacity: graphState === "ready" ? 1 : 0 }}
            onLoad={() => {
              // Try sending data immediately on load as well
              sendToWidget();
            }}
          />
        </div>
      )}
    </div>
  );
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
