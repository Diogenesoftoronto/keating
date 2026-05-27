import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  Agent,
  AgentMessage,
  ThinkingLevel,
} from "@earendil-works/pi-agent-core";
import type { ImageContent, TextContent } from "@earendil-works/pi-ai";
import {
  AssistantRuntimeProvider,
  AttachmentPrimitive,
  AuiIf,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  type AppendMessage,
  type AttachmentAdapter,
  type ThreadMessageLike,
  useExternalStoreRuntime,
  useMessage,
} from "@assistant-ui/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import {
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CopyPlus,
  KeyRound,
  LibraryBig,
  Lightbulb,
  Loader2,
  Lock,
  Paperclip,
  Send,
  Server,
  ShieldAlert,
  Square,
  ThumbsDown,
  ThumbsUp,
  User,
  Wifi,
  Wrench,
  X,
} from "lucide-react";
import type {
  ChatPanelHandle,
  ChatPanelSetupCallbacks,
} from "../types/chat-panel";
import {
  loadKeatingUiSettings,
  subscribeKeatingUiSettings,
} from "../keating/ui-settings";
import { getProviderApiKey } from "../lib/provider-models";
import { tutorialApiKeyHref } from "../lib/tutorial-links";
import { QuizRenderer } from "./QuizRenderer";
import { SceneRenderer } from "./SceneRenderer";
import type { Quiz } from "../keating/core";
import { KEATING_VOICE_TOOL_NAME } from "../keating/speech";

const AuthErrorContext = createContext<(provider: string) => Promise<boolean>>(
  () => Promise.resolve(false),
);

const ERROR_TEXT_PREFIX = "\x00__KEATING_ERROR__\x00";

type PromptContent = TextContent | ImageContent;

const PREFILL_STATUS_LINES = [
  "Reading the board before answering...",
  "Finding the bridge from what you know...",
  "Sketching the lesson path...",
  "Checking the example that will do the most work...",
  "Setting up the next question...",
];

const TEXT_ATTACHMENT_ACCEPT = [
  "text/*",
  "application/json",
  "application/xml",
  "application/javascript",
  "application/typescript",
  "application/x-javascript",
  ".txt",
  ".md",
  ".markdown",
  ".csv",
  ".json",
  ".xml",
  ".html",
  ".css",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  ".toml",
  ".yaml",
  ".yml",
].join(",");

const PDF_ATTACHMENT_ACCEPT = "application/pdf,.pdf";
const DOCUMENT_ATTACHMENT_ACCEPT = `${PDF_ATTACHMENT_ACCEPT},${TEXT_ATTACHMENT_ACCEPT}`;

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () =>
      reject(reader.error ?? new Error(`Could not read ${file.name}`));
    reader.readAsText(file);
  });
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () =>
      reject(reader.error ?? new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function attachmentMatchesAccept(file: File, accept: string): boolean {
  if (accept === "*") return true;
  const extension = file.name.includes(".")
    ? `.${file.name.split(".").pop()!.toLowerCase()}`
    : "";
  const mime = file.type.toLowerCase();

  return accept.split(",").some((entry) => {
    const rule = entry.trim().toLowerCase();
    if (!rule) return false;
    if (rule.startsWith(".") && extension === rule) return true;
    if (rule.endsWith("/*")) return mime.startsWith(`${rule.slice(0, -2)}/`);
    return mime === rule;
  });
}

function fileIsPdf(file: File): boolean {
  return attachmentMatchesAccept(file, PDF_ATTACHMENT_ACCEPT);
}

function attachmentContentType(file: File): string {
  if (fileIsPdf(file)) return "application/pdf";
  return file.type;
}

async function readPdfAsAttachmentText(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc ||= new URL(
    "pdfjs-dist/legacy/build/pdf.worker.mjs",
    import.meta.url,
  ).toString();

  const pdf = await pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
    isEvalSupported: false,
  }).promise;

  let extractedText = `<pdf filename="${file.name}">`;
  let hasReadableText = false;
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const pageText = textContent.items
        .map((item: any) => ("str" in item ? item.str : ""))
        .filter((text: string) => text.trim())
        .join(" ");
      if (pageText.trim()) hasReadableText = true;
      extractedText += `\n<page number="${pageNumber}">\n${pageText}\n</page>`;
      page.cleanup();
    }
  } finally {
    await pdf.destroy();
  }
  extractedText += "\n</pdf>";

  if (!hasReadableText) {
    throw new Error(
      `${file.name} did not contain readable PDF text. Scanned PDFs need OCR before attaching.`,
    );
  }
  return `<attachment name="${file.name}" type="application/pdf">\n${extractedText}\n</attachment>`;
}

const keatingAttachmentAdapter: AttachmentAdapter = {
  accept: `image/*,${DOCUMENT_ATTACHMENT_ACCEPT}`,
  async add({ file }) {
    return {
      id: `${file.name}-${file.size}-${file.lastModified}`,
      type: file.type.startsWith("image/") ? "image" : "document",
      name: file.name,
      contentType: attachmentContentType(file),
      file,
      status: { type: "requires-action", reason: "composer-send" },
    };
  },
  async send(attachment) {
    const file = attachment.file;
    if (file.type.startsWith("image/")) {
      return {
        ...attachment,
        type: "image",
        status: { type: "complete" },
        content: [
          {
            type: "image",
            image: await readFileAsDataUrl(file),
            filename: file.name,
          },
        ],
      };
    }

    if (fileIsPdf(file)) {
      return {
        ...attachment,
        type: "document",
        contentType: "application/pdf",
        status: { type: "complete" },
        content: [
          {
            type: "text",
            text: await readPdfAsAttachmentText(file),
          },
        ],
      };
    }

    if (!attachmentMatchesAccept(file, TEXT_ATTACHMENT_ACCEPT)) {
      throw new Error(
        `${file.name} is not a readable text, PDF, or image attachment.`,
      );
    }

    return {
      ...attachment,
      type: "document",
      status: { type: "complete" },
      content: [
        {
          type: "text",
          text: `<attachment name="${file.name}" type="${file.type || "text/plain"}">\n${await readFileAsText(file)}\n</attachment>`,
        },
      ],
    };
  },
  async remove() {
    // Files are only read locally in the browser; there is no remote cleanup.
  },
};

interface AssistantChatPanelProps {
  className?: string;
  speechEnabled?: boolean;
}

function StreamingTextPart({
  text,
  status,
  showRawErrors,
}: {
  text: string;
  status?: { type: string; reason?: string; error?: string };
  showRawErrors?: boolean;
}) {
  const isMarkedError = text.startsWith(ERROR_TEXT_PREFIX);
  const displayText = isMarkedError
    ? text.slice(ERROR_TEXT_PREFIX.length)
    : text;
  const [visibleText, setVisibleText] = useState(displayText);
  const visibleLengthRef = useRef(displayText.length);
  const previousTextRef = useRef(displayText);

  useEffect(() => {
    const isGrowing = displayText.startsWith(previousTextRef.current);
    const shouldAnimate =
      status?.type === "running" &&
      displayText.length > visibleLengthRef.current &&
      isGrowing;

    previousTextRef.current = displayText;

    if (!shouldAnimate) {
      visibleLengthRef.current = displayText.length;
      setVisibleText(displayText);
      return;
    }

    let cancelled = false;
    const tick = () => {
      if (cancelled) return;
      visibleLengthRef.current = Math.min(
        displayText.length,
        visibleLengthRef.current + 3,
      );
      setVisibleText(displayText.slice(0, visibleLengthRef.current));
      if (visibleLengthRef.current < displayText.length) {
        window.setTimeout(tick, 18);
      }
    };
    tick();

    return () => {
      cancelled = true;
    };
  }, [status?.type, displayText]);

  if (isMarkedError) {
    const classified = classifyError(visibleText);
    return (
      <ErrorBadge
        classified={classified}
        rawMessage={visibleText}
        showRaw={!!showRawErrors}
      />
    );
  }

  return (
    <MarkdownText
      text={visibleText}
      isRunning={
        status?.type === "running" && visibleText.length >= displayText.length
      }
    />
  );
}

const artifactLinkPattern = /\[artifact:\/\/([^/]+)\/([^\]]+)\]/g;

function stripArtifactLinks(text: string): string {
  return text.replace(artifactLinkPattern, "").trim();
}

const AUTH_ERROR_PATTERNS =
  /authentication_error|invalid.api.key|unauthorized|401|api.secret.key|auth.*fail|login.fail|key.*invalid|key.*expired/i;
const VOICE_ERROR_PATTERNS =
  /keating_voice|gemini live speech|voice layer|speech model|speech failed|speech timed out/i;

const HTTP_STATUS_PATTERN = /\b(4[0-9]{2}|5[0-9]{2})\b/;

interface ClassifiedError {
  statusCode: number | null;
  title: string;
  description: string;
  icon: typeof CircleAlert;
  category:
    | "auth"
    | "permission"
    | "not-found"
    | "rate-limit"
    | "server"
    | "network"
    | "speech"
    | "unknown";
}

const HTTP_ERROR_MAP: Record<number, Omit<ClassifiedError, "statusCode">> = {
  400: {
    title: "Bad Request",
    description: "The request was malformed or invalid.",
    icon: CircleAlert,
    category: "unknown",
  },
  401: {
    title: "Unauthorized",
    description: "Authentication is required to access this resource.",
    icon: Lock,
    category: "auth",
  },
  403: {
    title: "Forbidden",
    description: "You don't have permission to access this resource.",
    icon: ShieldAlert,
    category: "permission",
  },
  404: {
    title: "Not Found",
    description: "The requested resource does not exist.",
    icon: CircleAlert,
    category: "not-found",
  },
  408: {
    title: "Request Timeout",
    description: "The server took too long to respond.",
    icon: Wifi,
    category: "network",
  },
  409: {
    title: "Conflict",
    description: "The request conflicts with the current state.",
    icon: CircleAlert,
    category: "unknown",
  },
  422: {
    title: "Unprocessable",
    description: "The request was understood but couldn't be processed.",
    icon: CircleAlert,
    category: "unknown",
  },
  429: {
    title: "Too Many Requests",
    description: "Rate limit exceeded. Please wait and try again.",
    icon: Wifi,
    category: "rate-limit",
  },
  500: {
    title: "Internal Server Error",
    description: "Something went wrong on the server side.",
    icon: Server,
    category: "server",
  },
  502: {
    title: "Bad Gateway",
    description:
      "The server received an invalid response from an upstream service.",
    icon: Server,
    category: "server",
  },
  503: {
    title: "Service Unavailable",
    description: "The server is temporarily unavailable. Try again later.",
    icon: Server,
    category: "server",
  },
  504: {
    title: "Gateway Timeout",
    description: "The server didn't respond in time.",
    icon: Wifi,
    category: "network",
  },
};

const NETWORK_ERRORS: Record<string, Omit<ClassifiedError, "statusCode">> = {
  ECONNREFUSED: {
    title: "Connection Refused",
    description: "Could not connect to the server.",
    icon: Wifi,
    category: "network",
  },
  ECONNRESET: {
    title: "Connection Reset",
    description: "The connection was unexpectedly closed.",
    icon: Wifi,
    category: "network",
  },
  ETIMEDOUT: {
    title: "Connection Timeout",
    description: "The connection timed out.",
    icon: Wifi,
    category: "network",
  },
  ENOTFOUND: {
    title: "DNS Error",
    description: "Could not resolve the server address.",
    icon: Wifi,
    category: "network",
  },
  FETCH_ERROR: {
    title: "Network Error",
    description: "A network error occurred while making the request.",
    icon: Wifi,
    category: "network",
  },
};

function classifyError(errorText: string): ClassifiedError {
  const isVoiceError = VOICE_ERROR_PATTERNS.test(errorText);
  if (isVoiceError && AUTH_ERROR_PATTERNS.test(errorText)) {
    return {
      statusCode: errorText.match(HTTP_STATUS_PATTERN)
        ? parseInt(errorText.match(HTTP_STATUS_PATTERN)![1], 10)
        : null,
      title: "Voice Authentication Failed",
      description:
        "The speech model rejected its credentials. The main chat model may still be working.",
      icon: KeyRound,
      category: "speech",
    };
  }
  if (isVoiceError) {
    return {
      statusCode: null,
      title: "Voice Model Error",
      description:
        "The optional speech layer failed. The main chat model may still be working.",
      icon: Wifi,
      category: "speech",
    };
  }

  const httpMatch = errorText.match(HTTP_STATUS_PATTERN);
  if (httpMatch) {
    const code = parseInt(httpMatch[1], 10);
    const mapped = HTTP_ERROR_MAP[code];
    if (mapped) return { ...mapped, statusCode: code };
    if (code >= 400 && code < 500)
      return {
        statusCode: code,
        title: `Client Error (${code})`,
        description: "The request could not be processed.",
        icon: CircleAlert,
        category: "unknown",
      };
    if (code >= 500)
      return {
        statusCode: code,
        title: `Server Error (${code})`,
        description: "An error occurred on the server.",
        icon: Server,
        category: "server",
      };
  }

  for (const [pattern, def] of Object.entries(NETWORK_ERRORS)) {
    if (errorText.toUpperCase().includes(pattern))
      return { ...def, statusCode: null };
  }

  if (AUTH_ERROR_PATTERNS.test(errorText)) {
    return {
      statusCode: null,
      title: "Authentication Failed",
      description: "The selected model provider rejected its credentials.",
      icon: KeyRound,
      category: "auth",
    };
  }

  return {
    statusCode: null,
    title: "Error",
    description: "An unexpected error occurred.",
    icon: CircleAlert,
    category: "unknown",
  };
}

function ErrorBadge({
  classified,
  rawMessage,
  showRaw,
}: {
  classified: ClassifiedError;
  rawMessage: string;
  showRaw: boolean;
}) {
  const ErrorIcon = classified.icon;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5 font-medium">
        <ErrorIcon size={13} />
        <span>{classified.title}</span>
        {classified.statusCode && (
          <span className="rounded bg-background/70 px-1.5 py-0.5 font-mono text-[10px]">
            {classified.statusCode}
          </span>
        )}
      </div>
      <p className="text-muted-foreground">{classified.description}</p>
      {showRaw && (
        <details className="mt-2">
          <summary className="flex cursor-pointer list-none items-center gap-1 text-muted-foreground hover:text-foreground">
            <ChevronRight size={13} />
            Raw details
          </summary>
          <pre className="mt-2 max-h-44 overflow-auto whitespace-pre-wrap text-[11px] text-muted-foreground">
            {rawMessage}
          </pre>
        </details>
      )}
    </div>
  );
}

function ImagePart({ image, filename }: { image: string; filename?: string }) {
  return (
    <figure className="my-2 overflow-hidden rounded-md border border-border bg-background/60">
      <img
        src={image}
        alt={filename ?? "Attached image"}
        className="max-h-80 w-full object-contain"
      />
      {filename ? (
        <figcaption className="border-t border-border px-2 py-1 text-[11px] text-muted-foreground">
          {filename}
        </figcaption>
      ) : null}
    </figure>
  );
}

function FilePart({
  filename,
  mimeType,
}: {
  filename?: string;
  mimeType?: string;
}) {
  return (
    <div className="my-2 inline-flex max-w-full items-center gap-2 rounded-md border border-border bg-background/60 px-2 py-1 text-xs">
      <Paperclip size={13} className="shrink-0 text-muted-foreground" />
      <span className="truncate">{filename ?? "attachment"}</span>
      {mimeType ? (
        <span className="shrink-0 text-muted-foreground">{mimeType}</span>
      ) : null}
    </div>
  );
}

function ComposerAttachmentChip({
  attachment,
}: {
  attachment: { name: string; type?: string; contentType?: string };
}) {
  const isImage = attachment.type === "image";
  return (
    <div className="inline-flex max-w-48 items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs text-foreground">
      <Paperclip size={12} className="shrink-0 text-muted-foreground" />
      <span className="truncate">{attachment.name}</span>
      {isImage ? (
        <span className="shrink-0 text-muted-foreground">image</span>
      ) : null}
      <AttachmentPrimitive.Remove
        className="ml-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        aria-label={`Remove ${attachment.name}`}
        title="Remove attachment"
      >
        <X size={12} />
      </AttachmentPrimitive.Remove>
    </div>
  );
}

type AuthErrorEntry = { provider: string; error: string };

function authErrorFromAgentMessage(msg: any): AuthErrorEntry | null {
  if (msg.role !== "assistant" || msg.stopReason !== "error") return null;
  const errorText = msg.errorMessage ?? "";
  if (!AUTH_ERROR_PATTERNS.test(errorText)) return null;
  if (VOICE_ERROR_PATTERNS.test(errorText)) return null;
  const provider =
    msg.provider ??
    msg.model?.provider ??
    msg.model?.split?.("/", 2)?.[0] ??
    "unknown";
  return { provider, error: errorText };
}

function ArtifactChips({ text }: { text: string }) {
  const matches = Array.from(text.matchAll(artifactLinkPattern));
  if (matches.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 mb-3">
      {matches.map((m, i) => {
        const type = m[1];
        const id = m[2];
        const label = type.replace(/-/g, " ");
        return (
          <button
            key={i}
            className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2 py-1 text-xs font-medium text-primary hover:bg-primary/20 transition-colors"
            onClick={() =>
              window.dispatchEvent(
                new CustomEvent("keating:open-artifact", {
                  detail: { type, id },
                }),
              )
            }
            title={`View ${label}`}
          >
            <LibraryBig size={12} />
            <span className="capitalize">{label}</span>
          </button>
        );
      })}
    </div>
  );
}

const quizTagPattern = /<keating-quiz\s+json=([^>]+)\s*\/>/g;
const sceneTagPattern = /<keating-scene\s+markdown=([^>]+)\s*\/>/g;
const URL_IN_TEXT_PATTERN = /\bhttps?:\/\/[^\s<>"')\]]+/i;

function parseInteractiveSegments(
  text: string,
): Array<
  | { type: "text"; content: string }
  | { type: "quiz"; json: string }
  | { type: "scene"; markdown: string }
> {
  const segments: ReturnType<typeof parseInteractiveSegments> = [];
  let lastIndex = 0;

  // Try quiz tags first
  for (const match of text.matchAll(quizTagPattern)) {
    if (match.index !== undefined && match.index > lastIndex) {
      segments.push({
        type: "text",
        content: text.slice(lastIndex, match.index),
      });
    }
    segments.push({ type: "quiz", json: match[1] });
    lastIndex = match.index + match[0].length;
  }

  // Then scene tags on remaining text
  let sceneText = text.slice(lastIndex);
  let sceneLast = 0;
  for (const match of sceneText.matchAll(sceneTagPattern)) {
    if (match.index !== undefined && match.index > sceneLast) {
      segments.push({
        type: "text",
        content: sceneText.slice(sceneLast, match.index),
      });
    }
    segments.push({ type: "scene", markdown: JSON.parse(match[1]) });
    sceneLast = match.index + match[0].length;
  }
  if (sceneLast < sceneText.length) {
    segments.push({ type: "text", content: sceneText.slice(sceneLast) });
  }

  if (segments.length === 0) segments.push({ type: "text", content: text });
  return segments;
}

function MarkdownText({
  text,
  isRunning,
}: {
  text: string;
  isRunning?: boolean;
}) {
  const cleanText = stripArtifactLinks(text);
  const segments = parseInteractiveSegments(cleanText);
  return (
    <div className="break-words text-sm leading-6">
      <ArtifactChips text={text} />
      {segments.map((seg, i) => {
        if (seg.type === "quiz") {
          try {
            const parsed = JSON.parse(JSON.parse(seg.json)) as Quiz;
            return (
              <QuizRenderer
                key={i}
                quiz={parsed}
                onSubmit={(answers, score) => {
                  window.dispatchEvent(
                    new CustomEvent("keating:quiz-submitted", {
                      detail: { quizId: parsed.slug, answers, score },
                    }),
                  );
                }}
              />
            );
          } catch {
            return null;
          }
        }
        if (seg.type === "scene") {
          return <SceneRenderer key={i} storyboard={seg.markdown} />;
        }
        return (
          <ReactMarkdown
            key={i}
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeKatex]}
            components={{
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              pre: ({ children }: any) => (
                <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
                  {children}
                </pre>
              ),
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              code: ({ className, children, ...props }: any) => {
                const isInline = !className?.includes("language-");
                if (isInline) {
                  return (
                    <code
                      className="rounded bg-muted px-1.5 py-0.5 text-sm font-mono"
                      {...props}
                    >
                      {children}
                    </code>
                  );
                }
                return (
                  <code className="font-mono text-sm" {...props}>
                    {children}
                  </code>
                );
              },
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              p: ({ children }: any) => (
                <p className="mb-3 last:mb-0">{children}</p>
              ),
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              ul: ({ children }: any) => (
                <ul className="mb-3 list-disc pl-5">{children}</ul>
              ),
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              ol: ({ children }: any) => (
                <ol className="mb-3 list-decimal pl-5">{children}</ol>
              ),
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              li: ({ children }: any) => <li className="mb-1">{children}</li>,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              h1: ({ children }: any) => (
                <h1 className="mb-2 mt-4 text-lg font-semibold">{children}</h1>
              ),
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              h2: ({ children }: any) => (
                <h2 className="mb-2 mt-3 text-base font-semibold">
                  {children}
                </h2>
              ),
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              h3: ({ children }: any) => (
                <h3 className="mb-1 mt-2 text-sm font-semibold">{children}</h3>
              ),
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              strong: ({ children }: any) => (
                <strong className="font-semibold">{children}</strong>
              ),
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              em: ({ children }: any) => <em className="italic">{children}</em>,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              a: ({ children, href }: any) => (
                <a
                  href={href}
                  className="text-primary underline text-green-600"
                  target="_blank"
                  rel="noreferrer"
                >
                  {children}
                </a>
              ),
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              blockquote: ({ children }: any) => (
                <blockquote className="my-2 border-l-2 border-border pl-3 text-muted-foreground">
                  {children}
                </blockquote>
              ),
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              table: ({ children }: any) => (
                <table className="mb-3 w-full border-collapse text-sm">
                  {children}
                </table>
              ),
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              thead: ({ children }: any) => (
                <thead className="border-b border-border bg-muted/50">
                  {children}
                </thead>
              ),
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              th: ({ children }: any) => (
                <th className="px-3 py-2 text-left font-semibold">
                  {children}
                </th>
              ),
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              td: ({ children }: any) => (
                <td className="border-b border-border px-3 py-2">{children}</td>
              ),
            }}
          >
            {seg.content}
          </ReactMarkdown>
        );
      })}
      {isRunning ? <span className="ml-0.5 animate-pulse">|</span> : null}
    </div>
  );
}

function ReasoningPart({ text }: { text: string }) {
  const [open, setOpen] = useState(true);
  if (!text.trim()) return null;
  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="mb-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
    >
      <summary className="cursor-pointer font-medium">Reasoning</summary>
      <div className="mt-2 whitespace-pre-wrap">{text}</div>
    </details>
  );
}

function formatToolResult(result: unknown) {
  if (result === undefined) return "";
  if (typeof result === "string") return result;
  if (Array.isArray(result)) {
    const text = result
      .map((part) => {
        if (part?.type === "text" && typeof part.text === "string")
          return part.text;
        return "";
      })
      .filter(Boolean)
      .join("\n");
    if (text) return text;
  }
  return JSON.stringify(result, null, 2);
}

function ToolPart({
  toolName,
  args,
  result,
  isError,
  status,
  showDetails,
  showRawErrors,
}: {
  toolName: string;
  args?: unknown;
  result?: unknown;
  isError?: boolean;
  status?: { type: string };
  showDetails?: boolean;
  showRawErrors?: boolean;
}) {
  const resultText = formatToolResult(result);
  const state =
    result === undefined ? "running" : isError ? "error" : "success";
  const stateClass =
    state === "error"
      ? "border-destructive/60 bg-destructive/10 text-destructive"
      : state === "running"
        ? "border-amber-500/60 bg-amber-500/10 text-amber-600 dark:text-amber-300"
        : "border-emerald-500/60 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  const StateIcon =
    state === "error"
      ? CircleAlert
      : state === "running"
        ? Loader2
        : CircleCheck;
  const classifiedError = state === "error" ? classifyError(resultText) : null;
  return (
    <div
      className={`my-2 w-full rounded-md border-l-4 px-3 py-2 text-xs ${stateClass}`}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <StateIcon
          size={14}
          className={state === "running" ? "animate-spin" : ""}
        />
        <Wrench size={13} />
        <span className="font-medium">Tool</span>
        <span className="max-w-full truncate rounded bg-background/70 px-1.5 py-0.5 font-mono text-foreground">
          {toolName}
        </span>
        <span className="ml-auto shrink-0 uppercase tracking-wide">
          {state}
        </span>
      </div>
      {showDetails &&
      args !== undefined &&
      Object.keys(args as Record<string, unknown>).length > 0 ? (
        <details className="mt-2 text-foreground/80">
          <summary className="flex cursor-pointer list-none items-center gap-1">
            <ChevronRight size={13} />
            Arguments
          </summary>
          <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-muted-foreground">
            {JSON.stringify(args, null, 2)}
          </pre>
        </details>
      ) : null}
      {state === "error" && classifiedError ? (
        <div className="mt-2">
          <ErrorBadge
            classified={classifiedError}
            rawMessage={resultText}
            showRaw={!!showRawErrors}
          />
        </div>
      ) : showDetails && resultText ? (
        <div className="mt-2 text-foreground">
          <pre className="max-h-44 overflow-auto whitespace-pre-wrap font-mono leading-5">
            {resultText}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

function messagePartComponents(showToolUi: boolean, showRawErrors: boolean) {
  return {
    Text: (props: any) => (
      <StreamingTextPart {...props} showRawErrors={showRawErrors} />
    ),
    Image: ImagePart,
    File: FilePart,
    Reasoning: ReasoningPart,
    tools: {
      Fallback: (props: Parameters<typeof ToolPart>[0]) => (
        <ToolPart
          {...props}
          showDetails={showToolUi}
          showRawErrors={showRawErrors}
        />
      ),
    },
  };
}

function dataUrlToImageContent(dataUrl: string): ImageContent | null {
  const match = dataUrl.match(/^data:([^;,]+);base64,(.*)$/);
  if (!match) return null;
  return { type: "image", mimeType: match[1], data: match[2] };
}

function modelSupportsImages(model: unknown): boolean {
  const input = (model as { input?: unknown })?.input;
  return Array.isArray(input) && input.includes("image");
}

function modelDisplayName(model: unknown): string {
  const m = model as { name?: string; id?: string };
  return m?.name ?? m?.id ?? "The selected model";
}

function visionCapabilityError(model: unknown): string {
  return `${modelDisplayName(model)} cannot read image attachments. Choose a vision-capable model from the model selector, such as Gemini Flash/Pro or GPT-4o, then send the image again.`;
}

function displayTextFromAgentText(text: string): string {
  const match = text.match(/^<attachment name="([^"]+)"/);
  if (match) return `[attached file: ${match[1]}]`;
  return text;
}

function contentFromAppendMessage(message: AppendMessage): PromptContent[] {
  const content: PromptContent[] = [];
  for (const part of message.content) {
    if (part.type === "text" && part.text.trim()) {
      content.push({ type: "text", text: part.text });
    } else if (part.type === "image") {
      const image = dataUrlToImageContent(part.image);
      if (image) content.push(image);
    } else if (part.type === "file") {
      content.push({
        type: "text",
        text: `[file: ${part.filename ?? "attachment"}]\n${part.data}`,
      });
    }
  }

  for (const attachment of message.attachments ?? []) {
    for (const part of attachment.content ?? []) {
      if (part.type === "text" && part.text.trim()) {
        content.push({ type: "text", text: part.text });
      } else if (part.type === "image") {
        const image = dataUrlToImageContent(part.image);
        if (image) content.push(image);
      } else if (part.type === "file") {
        content.push({
          type: "text",
          text: `[file: ${part.filename ?? attachment.name}]\n${part.data}`,
        });
      }
    }
  }

  return content;
}

function assistantContentFromAgentContent(content: unknown) {
  if (typeof content === "string") return [{ type: "text" as const, text: content }];
  if (!Array.isArray(content)) return [{ type: "text" as const, text: "" }];
  return content
    .map((part: any) => {
      if (part?.type === "text") {
        return {
          type: "text" as const,
          text: displayTextFromAgentText(part.text ?? ""),
        };
      }
      if (part?.type === "image") {
        return {
          type: "image" as const,
          image: `data:${part.mimeType};base64,${part.data}`,
          filename: part.filename,
        };
      }
      return { type: "text" as const, text: textFromContent([part]) };
    })
    .filter((part) => part.type !== "text" || part.text);
}

function textFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (part?.type === "text" && typeof part.text === "string")
        return part.text;
      if (part?.type === "thinking" && typeof part.thinking === "string")
        return part.thinking;
      if (part?.type === "image") return "[image]";
      if (part?.type === "toolCall") return `[tool: ${part.name ?? "unknown"}]`;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function foldToolResults(messages: AgentMessage[]): AgentMessage[] {
  const folded: AgentMessage[] = [];
  const assistantByToolCallId = new Map<string, any>();

  for (const message of messages) {
    const msg = message as any;
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      const clone = {
        ...msg,
        content: msg.content.map((part: any) => ({ ...part })),
      };
      for (const part of clone.content) {
        if (part?.type === "toolCall" && part.id) {
          assistantByToolCallId.set(part.id, part);
        }
      }
      folded.push(clone as AgentMessage);
      continue;
    }

    if (msg.role === "toolResult") {
      const toolCall = assistantByToolCallId.get(msg.toolCallId);
      if (toolCall) {
        toolCall.__toolResult = msg.content;
        toolCall.__toolDetails = msg.details;
        toolCall.__toolError = msg.isError;
        continue;
      }
    }

    folded.push(message);
  }

  return folded;
}

function filterSpeechMessages(
  messages: AgentMessage[],
  speechEnabled: boolean,
): AgentMessage[] {
  if (speechEnabled) return messages;
  return messages
    .map((message) => {
      const msg = message as any;
      if (msg.role === "toolResult" && msg.toolName === KEATING_VOICE_TOOL_NAME)
        return null;
      if (msg.role !== "assistant" || !Array.isArray(msg.content))
        return message;

      const content = msg.content.filter(
        (part: any) =>
          !(part?.type === "toolCall" && part.name === KEATING_VOICE_TOOL_NAME),
      );
      if (content.length === msg.content.length) return message;
      return { ...msg, content } as AgentMessage;
    })
    .filter((message): message is AgentMessage => message !== null);
}

function hasRenderableAssistantContent(content: unknown): boolean {
  if (!Array.isArray(content)) return typeof content === "string" && content.trim().length > 0;
  return content.some((part: any) => {
    if (part?.type === "text") return typeof part.text === "string" && part.text.trim().length > 0;
    if (part?.type === "thinking") return typeof part.thinking === "string" && part.thinking.trim().length > 0;
    if (part?.type === "toolCall") return true;
    if (part?.type === "image") return true;
    return false;
  });
}

function isSameStreamingAssistantMessage(message: unknown, streamingMessage: unknown): boolean {
  const left = message as any;
  const right = streamingMessage as any;
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.role !== "assistant" || right.role !== "assistant") return false;
  if (left.timestamp !== right.timestamp) return false;
  return JSON.stringify(left.content ?? null) === JSON.stringify(right.content ?? null);
}

function visibleAgentMessages(agent: Agent | null, speechEnabled: boolean): AgentMessage[] {
  if (!agent) return [];
  const messages = [...agent.state.messages];
  const streamingMessage = agent.state.streamingMessage as any;
  if (
    streamingMessage?.role === "assistant" &&
    hasRenderableAssistantContent(streamingMessage.content)
  ) {
    const alreadyVisible = messages.some((message) =>
      isSameStreamingAssistantMessage(message, streamingMessage),
    );
    if (!alreadyVisible) {
      messages.push({
        ...streamingMessage,
        __keatingStreaming: true,
        content: Array.isArray(streamingMessage.content)
          ? streamingMessage.content.map((part: any) => ({ ...part }))
          : streamingMessage.content,
      } as AgentMessage);
    }
  }
  return foldToolResults(filterSpeechMessages(messages, speechEnabled));
}

function toAssistantMessage(
  message: AgentMessage,
  index: number,
  totalMessages: number,
  isRunning: boolean,
): ThreadMessageLike {
  const msg = message as any;
  const timestamp =
    typeof msg.timestamp === "number" ? new Date(msg.timestamp) : new Date();

  // Only the last assistant message should show "running" status.
  // During tool execution, isRunning is still true, but the assistant message
  // is already complete (followed by toolResult messages).
  const isLastMessage = index === totalMessages - 1;
  const hasStopReason = msg.stopReason != null;
  const isActivelyStreaming =
    isRunning &&
    msg.role === "assistant" &&
    isLastMessage &&
    (msg.__keatingStreaming === true || !hasStopReason);
  const status = isActivelyStreaming
    ? { type: "running" as const }
    : msg.stopReason === "error"
      ? {
          type: "incomplete" as const,
          reason: "error" as const,
          error: msg.errorMessage ?? "Assistant response failed",
        }
      : msg.stopReason === "aborted"
        ? { type: "incomplete" as const, reason: "cancelled" as const }
        : { type: "complete" as const, reason: "stop" as const };

  if (msg.role === "assistant") {
    const content = Array.isArray(msg.content)
      ? msg.content.map((part: any) => {
          if (part?.type === "thinking")
            return { type: "reasoning" as const, text: part.thinking ?? "" };
          if (part?.type === "toolCall") {
            return {
              type: "tool-call" as const,
              toolCallId: part.id ?? `tool-${index}`,
              toolName: part.name ?? "tool",
              args: part.arguments ?? {},
              argsText: JSON.stringify(part.arguments ?? {}),
              result: part.__toolResult ?? part.__toolDetails,
              isError: part.__toolError,
            };
          }
          return { type: "text" as const, text: part?.text ?? "" };
        })
      : [{ type: "text" as const, text: textFromContent(msg.content) }];

    const id = `assistant-${index}-${msg.timestamp ?? ""}`;

    if (status.type === "incomplete" && status.reason === "error") {
      const errorText = msg.errorMessage ?? "Assistant response failed";
      if (!content.some((c: any) => c.type === "text" && c.text)) {
        content.unshift({
          type: "text" as const,
          text: `${ERROR_TEXT_PREFIX}${errorText}`,
        });
      }
    }

    const authError = authErrorFromAgentMessage(msg);
    return {
      id,
      role: "assistant",
      createdAt: timestamp,
      status,
      content,
      metadata: authError
        ? { custom: { keatingAuthError: authError } }
        : undefined,
    };
  }

  if (msg.role === "toolResult") {
    const summary =
      textFromContent(msg.content) ||
      JSON.stringify(msg.details ?? {}, null, 2);
    const id = `tool-${index}-${msg.toolCallId ?? ""}`;
    const errorPrefix = msg.isError ? ERROR_TEXT_PREFIX : "";
    return {
      id,
      role: "assistant",
      createdAt: timestamp,
      status: msg.isError
        ? { type: "incomplete", reason: "error", error: summary }
        : { type: "complete", reason: "stop" },
      content: [
        {
          type: "text",
          text: `${errorPrefix}Tool ${msg.toolName ?? "result"}:\n${summary}`,
        },
      ],
    };
  }

  return {
    id: `user-${index}-${msg.timestamp ?? ""}`,
    role: "user",
    createdAt: timestamp,
    content: assistantContentFromAgentContent(msg.content),
  };
}

function makeUserMessageFromAppend(message: AppendMessage): AgentMessage | null {
  const content = contentFromAppendMessage(message);
  if (content.length === 0) return null;
  return {
    role: "user",
    content,
    timestamp: Date.now(),
  } as AgentMessage;
}

function makeAttachmentErrorMessage(agent: Agent, errorMessage: string): AgentMessage {
  return {
    role: "assistant",
    content: [],
    api: agent.state.model.api,
    provider: agent.state.model.provider,
    model: agent.state.model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
    },
    stopReason: "error",
    errorMessage,
    timestamp: Date.now(),
  } as AgentMessage;
}

function makePrefillStatusMessage(agent: Agent, step: number): AgentMessage {
  return {
    role: "assistant",
    content: [
      {
        type: "text",
        text: PREFILL_STATUS_LINES[step % PREFILL_STATUS_LINES.length],
      },
    ],
    api: agent.state.model.api,
    provider: agent.state.model.provider,
    model: agent.state.model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        total: 0,
      },
    },
    timestamp: Date.now(),
  } as AgentMessage;
}

const ALL_PROMPTS = [
  { label: "Learn", text: "Explain quantum entanglement simply" },
  { label: "Learn", text: "Why does gradient descent work?" },
  { label: "Plan", text: "Plan a 4-week ML course" },
  { label: "Plan", text: "Study roadmap for AWS cert" },
  { label: "Map", text: "Map probability to statistics" },
  { label: "Map", text: "Map web dev from HTML to React" },
  { label: "Assess", text: "Quiz me on the Krebs cycle" },
  { label: "Assess", text: "Test my async/await knowledge" },
  { label: "Create", text: "Animate how DNS works" },
  { label: "Create", text: "Flashcards for Spanish verbs" },
];

function pickN(pool: typeof ALL_PROMPTS, n: number): typeof ALL_PROMPTS {
  const shuffled = [...pool].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(n, shuffled.length));
}

function SuggestedPrompts({ onSelect }: { onSelect: (text: string) => void }) {
  const [prompts, setPrompts] = useState(() => pickN(ALL_PROMPTS, 3));
  const scrollRef = useRef<HTMLDivElement>(null);

  const remaining = ALL_PROMPTS.filter(
    (p) => !prompts.some((existing) => existing.text === p.text),
  );
  const exhausted = remaining.length === 0;

  const appendMore = (count = 3) => {
    if (remaining.length === 0) return false;
    setPrompts((prev) => [...prev, ...pickN(remaining, count)]);
    return true;
  };

  const scroll = (dir: "left" | "right") => {
    const el = scrollRef.current;
    if (!el) return;
    if (dir === "right") {
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 4;
      if (atEnd && appendMore()) {
        requestAnimationFrame(() => {
          scrollRef.current?.scrollBy({ left: 220, behavior: "smooth" });
        });
        return;
      }
    }
    el.scrollBy({
      left: dir === "left" ? -220 : 220,
      behavior: "smooth",
    });
  };

  const refresh = () => appendMore();

  return (
    <div className="mx-auto flex h-full w-full min-w-0 max-w-3xl flex-col items-center justify-center gap-3 px-1 sm:px-4">
      <div className="text-sm text-muted-foreground font-terminal">
        Start a conversation
      </div>
      <div className="flex w-full min-w-0 items-center gap-1">
        <button
          type="button"
          onClick={() => scroll("left")}
          className="shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          aria-label="Scroll left"
        >
          <ChevronRight size={14} className="rotate-180" />
        </button>
        <div
          ref={scrollRef}
          className="flex min-w-0 flex-1 gap-2 overflow-x-auto scroll-smooth snap-x snap-mandatory scrollbar-hide py-1"
          style={{ scrollbarWidth: "none" }}
        >
          {prompts.map((p) => (
            <button
              key={p.text}
              type="button"
              onClick={() => onSelect(p.text)}
              className="snap-start w-[min(13rem,calc(100vw-7rem))] shrink-0 rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-left transition-all hover:border-primary hover:bg-primary/10 hover:text-primary hover:shadow-sm active:scale-[0.98]"
            >
              <span className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                {p.label}
              </span>
              <span className="block text-xs leading-snug">{p.text}</span>
            </button>
          ))}
          {!exhausted && (
            <button
              type="button"
              onClick={refresh}
              className="snap-start shrink-0 w-20 rounded-lg border border-dashed border-border text-muted-foreground hover:border-primary hover:text-primary hover:bg-primary/5 transition-all flex items-center justify-center"
            >
              <span className="text-xs">More</span>
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => scroll("right")}
          title={exhausted ? "No more suggestions" : "Scroll right"}
          className="shrink-0 inline-flex h-8 w-8 items-center justify-center rounded-full border border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          aria-label="Scroll right"
        >
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}

const REASONING_OPTIONS: {
  value: ThinkingLevel;
  label: string;
  short: string;
}[] = [
  { value: "off", label: "Off", short: "Off" },
  { value: "minimal", label: "Minimal", short: "Min" },
  { value: "low", label: "Low", short: "Low" },
  { value: "medium", label: "Medium", short: "Med" },
  { value: "high", label: "High", short: "High" },
  { value: "xhigh", label: "Max", short: "Max" },
];

function ReasoningLevelSelector({
  level,
  onChange,
  disabled,
}: {
  level: ThinkingLevel;
  onChange: (level: ThinkingLevel) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const current =
    REASONING_OPTIONS.find((o) => o.value === level) ?? REASONING_OPTIONS[3];
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className={`hidden h-9 shrink-0 items-center gap-1 rounded-md border border-border px-2 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50 sm:inline-flex ${level === "off" ? "" : "border-primary/50 text-primary"}`}
        disabled={disabled}
        title={`Reasoning: ${current.label}`}
        onClick={() => setOpen((o) => !o)}
      >
        <Lightbulb size={12} />
        <span className="font-medium">{current.short}</span>
      </button>
      {open && (
        <div className="absolute bottom-full right-0 z-50 mb-1 w-40 rounded-md border border-border bg-background shadow-lg font-terminal">
          <div className="flex flex-col p-1">
            <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Reasoning
            </div>
            {REASONING_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={`flex items-center gap-2 rounded px-2 py-1.5 text-xs text-left transition-colors ${opt.value === level ? "bg-primary/10 text-primary font-medium" : "text-foreground hover:bg-accent hover:text-accent-foreground"}`}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
              >
                <span
                  className="w-2 h-2 rounded-full"
                  style={{
                    background:
                      opt.value === "off"
                        ? "var(--muted-foreground, #888)"
                        : opt.value === "xhigh"
                          ? "#dc2626"
                          : opt.value === "high"
                            ? "#ea580c"
                            : opt.value === "medium"
                              ? "#10b981"
                              : "#3b82f6",
                  }}
                />
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function WebGroundingHint({
  hasUrl,
  hasGoogleKey,
  groundingEnabled,
  usingGoogleModel,
}: {
  hasUrl: boolean;
  hasGoogleKey: boolean | null;
  groundingEnabled: boolean;
  usingGoogleModel: boolean;
}) {
  if (!hasUrl) return null;

  const needsKey = hasGoogleKey === false;
  const needsGrounding = !groundingEnabled;
  const needsGoogleModel = !usingGoogleModel;
  if (!needsKey && !needsGrounding && !needsGoogleModel) return null;

  return (
    <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-xs leading-5 text-muted-foreground">
      <span className="font-medium text-foreground">URL detected.</span>{" "}
      To let Keating read current web pages, use a Google Gemini model with Google web grounding enabled
      {needsKey ? " and add a Google API key" : ""}.
      {needsKey && (
        <>
          {" "}Get one from{" "}
          <a
            className="text-primary underline underline-offset-2"
            href="https://aistudio.google.com/app/apikey"
            target="_blank"
            rel="noreferrer"
          >
            Google AI Studio
          </a>
          , then paste it in Settings → Providers & Models → Google Gemini.
        </>
      )}
      {needsGrounding && " Turn on Settings → Interface → Google web grounding."}
      {needsGoogleModel && " Select a Google Gemini model for grounded web results."}
    </div>
  );
}

function AssistantThread({
  agent,
  callbacks,
  version,
  speechEnabled,
}: {
  agent: Agent | null;
  callbacks: ChatPanelSetupCallbacks;
  version: number;
  speechEnabled: boolean;
}) {
  const [uiSettings, setUiSettings] = useState(() => loadKeatingUiSettings());
  const [localVersion, setLocalVersion] = useState(0);
  const [loadingStep, setLoadingStep] = useState(0);
  const [composerHasUrl, setComposerHasUrl] = useState(false);
  const [hasGoogleKey, setHasGoogleKey] = useState<boolean | null>(null);
  const isRunning = agent?.state.isStreaming ?? false;
  const messages = useMemo(
    () => {
      const visibleMessages = visibleAgentMessages(agent, speechEnabled);
      const lastMessage = visibleMessages.at(-1) as any;
      if (agent && isRunning && lastMessage?.role === "user") {
        return [...visibleMessages, makePrefillStatusMessage(agent, loadingStep)];
      }
      return visibleMessages;
    },
    [agent, version, localVersion, speechEnabled, isRunning, loadingStep],
  );
  const components = useMemo(
    () =>
      messagePartComponents(uiSettings.showToolUi, uiSettings.showRawErrors),
    [uiSettings.showToolUi, uiSettings.showRawErrors],
  );
  const modelRef = useRef(agent?.state.model);
  if (agent) modelRef.current = agent.state.model;

  const totalMessages = messages.length;
  const convertMessage = useCallback(
    (message: AgentMessage, index: number) =>
      toAssistantMessage(message, index, totalMessages, isRunning),
    [totalMessages, isRunning],
  );

  const sendText = useCallback(
    async (text: string) => {
      if (!agent || !text.trim()) return;
      const provider = agent.state.model.provider;
      if (
        callbacks.onApiKeyRequired &&
        !(await callbacks.onApiKeyRequired(provider))
      )
        return;
      await callbacks.onBeforeSend?.();
      setComposerHasUrl(false);
      await agent.prompt(text);
    },
    [agent, callbacks],
  );

  const onNew = useCallback(
    async (message: AppendMessage) => {
      if (!agent) return;
      const userMessage = makeUserMessageFromAppend(message);
      if (!userMessage) return;

      const content = (userMessage as any).content;
      const hasImage =
        Array.isArray(content) &&
        content.some((part: any) => part?.type === "image");
      if (hasImage && !modelSupportsImages(agent.state.model)) {
        agent.state.messages.push(userMessage);
        agent.state.messages.push(
          makeAttachmentErrorMessage(
            agent,
            visionCapabilityError(agent.state.model),
          ),
        );
        setLocalVersion((current) => current + 1);
        return;
      }

      const provider = agent.state.model.provider;
      if (
        callbacks.onApiKeyRequired &&
        !(await callbacks.onApiKeyRequired(provider))
      )
        return;
      await callbacks.onBeforeSend?.();
      setComposerHasUrl(false);
      await agent.prompt(userMessage);
    },
    [agent, callbacks],
  );

  const onCancel = useCallback(async () => {
    agent?.abort();
  }, [agent]);

  const storeAdapter = useMemo(
    () => ({
      messages,
      isRunning,
      convertMessage,
      onNew,
      onCancel,
      adapters: {
        attachments: keatingAttachmentAdapter,
      },
    }),
    [messages, isRunning, convertMessage, onNew, onCancel],
  );

  const runtime = useExternalStoreRuntime<AgentMessage>(storeAdapter);
  const modelLabel = modelRef.current?.name ?? modelRef.current?.id ?? "Model";
  const usingGoogleModel = modelRef.current?.provider === "google";

  useEffect(() => subscribeKeatingUiSettings(setUiSettings), []);

  useEffect(() => {
    if (!composerHasUrl) {
      setHasGoogleKey(null);
      return;
    }

    let cancelled = false;
    getProviderApiKey("google")
      .then((key) => {
        if (!cancelled) setHasGoogleKey(!!key);
      })
      .catch(() => {
        if (!cancelled) setHasGoogleKey(false);
      });

    return () => {
      cancelled = true;
    };
  }, [composerHasUrl]);

  useEffect(() => {
    if (!isRunning) {
      setLoadingStep(0);
      return;
    }
    const id = window.setInterval(
      () => setLoadingStep((current) => current + 1),
      2200,
    );
    return () => window.clearInterval(id);
  }, [isRunning]);

  const UserMessageComponent = useCallback(
    () => (
      <UserMessage
        components={components}
        profileImage={uiSettings.userProfileImage}
      />
    ),
    [components, uiSettings.userProfileImage],
  );
  const AssistantMessageComponent = useCallback(
    () => (
      <AssistantMessage components={components} onFork={callbacks.onFork} />
    ),
    [components, callbacks.onFork],
  );
  const threadComponents = useMemo(
    () => ({
      UserMessage: UserMessageComponent,
      AssistantMessage: AssistantMessageComponent,
    }),
    [UserMessageComponent, AssistantMessageComponent],
  );

  return (
    <AuthErrorContext.Provider
      value={callbacks.onAuthError ?? (() => Promise.resolve(false))}
    >
      <AssistantRuntimeProvider runtime={runtime}>
        <ThreadPrimitive.Root className="flex h-full min-h-0 flex-col bg-background text-foreground">
          <ThreadPrimitive.Viewport className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-4 sm:px-4 sm:py-6">
            <div className="flex flex-1 flex-col">
              <AuiIf condition={(state) => state.thread.isEmpty}>
                <SuggestedPrompts onSelect={sendText} />
              </AuiIf>
              <ThreadPrimitive.Messages components={threadComponents} />
            </div>
            <ThreadPrimitive.ViewportFooter className="sticky bottom-0 min-w-0 bg-background/95 pt-3 backdrop-blur">
              <ComposerPrimitive.Root className="composer-root mx-auto flex w-[calc(100%-6px)] max-w-3xl flex-col gap-2 rounded-lg border border-border bg-background p-2 shadow-sm sm:w-full">
                <WebGroundingHint
                  hasUrl={composerHasUrl}
                  hasGoogleKey={hasGoogleKey}
                  groundingEnabled={uiSettings.googleGrounding === "auto"}
                  usingGoogleModel={usingGoogleModel}
                />
                <ComposerPrimitive.Attachments>
                  {({ attachment }) => (
                    <ComposerAttachmentChip attachment={attachment} />
                  )}
                </ComposerPrimitive.Attachments>
                <div className="flex w-full min-w-0 items-center gap-1.5 sm:gap-2">
                  <button
                    type="button"
                    className="inline-flex h-9 max-w-20 shrink-0 items-center overflow-hidden truncate whitespace-nowrap rounded-md border border-border px-2 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50 sm:max-w-36"
                    disabled={!callbacks.onModelSelect}
                    onClick={() => callbacks.onModelSelect?.()}
                    title={modelLabel}
                  >
                    {modelLabel}
                  </button>
                  {/* Reasoning level — visible on landscape/tablet+ */}
                  <ReasoningLevelSelector
                    level={
                      agent?.state.thinkingLevel ??
                      callbacks.thinkingLevel ??
                      "medium"
                    }
                    onChange={callbacks.onThinkingLevelChange ?? (() => {})}
                    disabled={isRunning}
                  />
                  <ComposerPrimitive.AddAttachment
                    multiple
                    className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
                    title="Attach files or images"
                    aria-label="Attach files or images"
                  >
                    <Paperclip size={16} />
                  </ComposerPrimitive.AddAttachment>
                  <ComposerPrimitive.Input
                    className="max-h-40 min-h-9 min-w-0 flex-1 resize-none self-center bg-transparent px-1 py-2 text-sm leading-5 text-foreground outline-none placeholder:text-muted-foreground sm:px-2"
                    placeholder="Message Keating"
                    rows={1}
                    onChange={(event) => setComposerHasUrl(URL_IN_TEXT_PATTERN.test(event.currentTarget.value))}
                  />
                  {/* Only show Send OR Cancel — never both */}
                  {isRunning ? (
                    <ComposerPrimitive.Cancel className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border-2 border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground animate-pulse">
                      <Square size={16} />
                    </ComposerPrimitive.Cancel>
                  ) : (
                    <ComposerPrimitive.Send className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground disabled:opacity-50">
                      <Send size={16} />
                    </ComposerPrimitive.Send>
                  )}
                </div>
              </ComposerPrimitive.Root>
            </ThreadPrimitive.ViewportFooter>
          </ThreadPrimitive.Viewport>
        </ThreadPrimitive.Root>
      </AssistantRuntimeProvider>
    </AuthErrorContext.Provider>
  );
}

function UserMessage({
  components,
  profileImage,
}: {
  components: ReturnType<typeof messagePartComponents>;
  profileImage?: string | null;
}) {
  return (
    <MessagePrimitive.Root className="mx-auto mb-4 flex w-full max-w-3xl justify-end">
      <div className="flex max-w-[88%] gap-3 rounded-lg border-2 border-amber-700 bg-amber-500 px-4 py-3 text-sm text-black shadow-sm dark:border-amber-300 dark:bg-amber-300 sm:max-w-[82%]">
        <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center overflow-hidden rounded bg-black/10">
          {profileImage ? (
            <img
              src={profileImage}
              alt="You"
              className="h-full w-full object-cover"
            />
          ) : (
            <User className="h-4 w-4 shrink-0" />
          )}
        </div>
        <div className="min-w-0">
          <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-black/70">
            Learner
          </div>
          <div className="whitespace-pre-wrap leading-6 font-ui">
            <MessagePrimitive.Content components={components} />
          </div>
        </div>
      </div>
    </MessagePrimitive.Root>
  );
}

function FeedbackModal({
  open,
  type,
  onClose,
  onSubmit,
}: {
  open: boolean;
  type: "up" | "down";
  onClose: () => void;
  onSubmit: (type: "up" | "down", comment: string) => void;
}) {
  const [comment, setComment] = useState("");

  useEffect(() => {
    if (open) setComment("");
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg border border-border bg-background p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-foreground">
            {type === "up" ? "What was helpful?" : "What could be improved?"}
          </h3>
          <button
            type="button"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>
        <textarea
          className="w-full rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-foreground outline-none placeholder:text-muted-foreground resize-none"
          rows={4}
          placeholder="Optional comment..."
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          autoFocus
        />
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            className="inline-flex h-8 items-center justify-center rounded-md border border-border px-3 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            onClick={onClose}
          >
            Skip
          </button>
          <button
            type="button"
            className="inline-flex h-8 items-center justify-center rounded-md bg-primary px-3 text-xs text-primary-foreground hover:bg-primary/90"
            onClick={() => onSubmit(type, comment)}
          >
            Submit
          </button>
        </div>
      </div>
    </div>
  );
}

function AssistantMessage({
  components,
  onFork,
}: {
  components: ReturnType<typeof messagePartComponents>;
  onFork?: () => void | Promise<void>;
}) {
  const [feedback, setFeedback] = useState<"up" | "down" | null>(null);
  const [feedbackModalOpen, setFeedbackModalOpen] = useState(false);
  const [feedbackType, setFeedbackType] = useState<"up" | "down">("up");
  const onAuthError = useContext(AuthErrorContext);
  const authError = useMessage(
    (message) =>
      message.metadata.custom?.keatingAuthError as AuthErrorEntry | undefined,
  );
  const [retrying, setRetrying] = useState(false);

  const handleFeedbackClick = (type: "up" | "down") => {
    setFeedbackType(type);
    setFeedbackModalOpen(true);
  };

  const handleFeedbackSubmit = (type: "up" | "down", comment: string) => {
    setFeedback(type);
    setFeedbackModalOpen(false);
    try {
      window.dispatchEvent(
        new CustomEvent("keating:message-feedback", {
          detail: { type, comment },
        }),
      );
    } catch {
      /* noop */
    }
  };

  const handleAuthRetry = async () => {
    if (!authError) return;
    setRetrying(true);
    await onAuthError(authError.provider);
    setRetrying(false);
  };

  return (
    <>
      <MessagePrimitive.Root className="group mx-auto mb-4 flex w-full max-w-3xl justify-start">
        <div className="flex w-full gap-3 px-1 text-sm text-foreground">
          <img
            src="/logo.png"
            alt="Keating"
            className="mt-1 h-5 w-5 shrink-0 rounded object-contain"
          />
          <div className="min-w-0 flex-1 leading-6">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-primary">
              Keating
            </div>
            <MessagePrimitive.Content components={components} />
            {authError && (
              <div className="my-2 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm">
                <div className="flex items-start gap-2">
                  <KeyRound
                    size={16}
                    className="mt-0.5 shrink-0 text-destructive"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-destructive mb-1">
                      Authentication failed
                    </p>
                    <p className="text-xs text-muted-foreground mb-2">
                      {authError.error}
                    </p>
                    <button
                      type="button"
                      onClick={handleAuthRetry}
                      disabled={retrying}
                      className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
                    >
                      {retrying ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <KeyRound size={12} />
                      )}
                      Re-enter API key
                    </button>
                    <a
                      href={tutorialApiKeyHref(authError.provider)}
                      target="_blank"
                      rel="noreferrer"
                      className="ml-2 inline-flex items-center text-xs text-primary underline underline-offset-2"
                    >
                      Need a key?
                    </a>
                  </div>
                </div>
              </div>
            )}
            <div className="mt-2 flex items-center gap-1">
              <button
                type="button"
                className={`inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors ${
                  feedback === "up"
                    ? "bg-primary/20 text-primary"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                }`}
                title="Helpful"
                onClick={() => handleFeedbackClick("up")}
                aria-pressed={feedback === "up"}
              >
                <ThumbsUp size={13} />
              </button>
              <button
                type="button"
                className={`inline-flex h-6 w-6 items-center justify-center rounded-md transition-colors ${
                  feedback === "down"
                    ? "bg-destructive/20 text-destructive"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                }`}
                title="Not helpful"
                onClick={() => handleFeedbackClick("down")}
                aria-pressed={feedback === "down"}
              >
                <ThumbsDown size={13} />
              </button>
              {onFork && (
                <button
                  type="button"
                  className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-all opacity-0 group-hover:opacity-100"
                  title="Fork session"
                  onClick={onFork}
                  aria-label="Fork session"
                >
                  <CopyPlus size={13} />
                </button>
              )}
            </div>
          </div>
        </div>
      </MessagePrimitive.Root>
      <FeedbackModal
        open={feedbackModalOpen}
        type={feedbackType}
        onClose={() => setFeedbackModalOpen(false)}
        onSubmit={handleFeedbackSubmit}
      />
    </>
  );
}

export const AssistantChatPanel = forwardRef<
  ChatPanelHandle,
  AssistantChatPanelProps
>(({ className, speechEnabled = false }, ref) => {
  const [agent, setAgentState] = useState<Agent | null>(null);
  const [callbacks, setCallbacks] = useState<ChatPanelSetupCallbacks>({});
  const [version, setVersion] = useState(0);

  const refresh = useCallback(() => setVersion((current) => current + 1), []);

  useImperativeHandle(
    ref,
    () => ({
      async setAgent(nextAgent, nextCallbacks = {}) {
        setAgentState(nextAgent);
        setCallbacks(nextCallbacks);
        refresh();
      },
    }),
    [refresh],
  );

  return (
    <div className={className}>
      <AgentSubscription agent={agent} onChange={refresh} />
      <AssistantThread
        agent={agent}
        callbacks={callbacks}
        version={version}
        speechEnabled={speechEnabled}
      />
    </div>
  );
});

AssistantChatPanel.displayName = "AssistantChatPanel";

function AgentSubscription({
  agent,
  onChange,
}: {
  agent: Agent | null;
  onChange: () => void;
}) {
  useEffect(() => {
    if (!agent) return undefined;
    const unsubscribe = agent.subscribe(() => onChange());
    onChange();
    return unsubscribe;
  }, [agent, onChange]);
  return null;
}
