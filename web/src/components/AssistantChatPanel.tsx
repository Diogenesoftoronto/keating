import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useImperativeHandle,
  memo,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Key, ReactNode } from "react";
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
  useComposerRuntime,
  useExternalStoreRuntime,
  useMessage,
} from "@assistant-ui/react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import {
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleDollarSign,
  Check,
  Copy,
  CopyPlus,
  KeyRound,
  LibraryBig,
  Lightbulb,
  Loader2,
  Lock,
  Mic,
  MicOff,
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
import { handleTutorialLinkClick, tutorialApiKeyHref } from "../lib/tutorial-links";
import { QuizRenderer } from "./QuizRenderer";
import type { QuizResult } from "./QuizRenderer";
import { QuizSessionPanel } from "./QuizSessionPanel";
import { QuizResultCard } from "./QuizResultCard";
import { SceneRenderer } from "./SceneRenderer";
import { AnimatedScene, parseAnimationPayload } from "./AnimatedScene";
import { QuestionRenderer, normalizeQuestionForm } from "./QuestionRenderer";
import type { AnsweredQuestion, QuestionFormData } from "./QuestionRenderer";
import { GoalRenderer } from "./GoalRenderer";
import { normalizeGoal } from "../keating/goals";
import type { Quiz, QuizGradePayload, QuizQuestionGrade } from "../keating/core";
import { QuizGradesContext, type QuizGradesContextValue } from "./quiz-grades-context";
import {
  getSpeechProvider,
  KEATING_VOICE_TOOL_NAME,
  loadWebSpeechSettings,
  resolveSpeechCredential,
  speechInputMode,
  type LiveSpeechSession,
  type LiveSpeechState,
} from "../keating/speech";
import { startMicRecording, transcribeAudio, type MicRecorder } from "../keating/speech-providers/stt";
import { JsonCrackBlock } from "./JsonCrackBlock";
import { FlashcardRenderer } from "./FlashcardRenderer";
import type { FlashcardDeck } from "../keating/srs";

const AuthErrorContext = createContext<(provider: string) => Promise<boolean>>(
  () => Promise.resolve(false),
);

/**
 * Renders nothing visible beyond a small confirmation; its job is to push the
 * model's grade payload into QuizGradesContext when the grade tag mounts.
 */
function QuizGradeApplier({ payload }: { payload: QuizGradePayload }) {
  const { applyGrades } = useContext(QuizGradesContext);
  useEffect(() => {
    if (payload.resultId && payload.grades.length > 0) {
      applyGrades(payload.resultId, payload.grades);
    }
  }, [payload, applyGrades]);
  return (
    <p className="my-1 text-xs text-muted-foreground italic">
      Reviewed your open-ended answers above.
    </p>
  );
}

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
const BILLING_ERROR_PATTERNS =
  /insufficient_quota|insufficient.?(funds|quota|credits?|balance)|exceeded your current quota|not enough (credits?|balance)|billing|payment required|\b402\b/i;
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
    | "billing"
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

  // Billing/quota errors are often surfaced as a 429 or 402; classify them
  // before the generic HTTP handling so they read as a credits problem rather
  // than a transient rate-limit.
  if (BILLING_ERROR_PATTERNS.test(errorText)) {
    return {
      statusCode: errorText.match(HTTP_STATUS_PATTERN)
        ? parseInt(errorText.match(HTTP_STATUS_PATTERN)![1], 10)
        : null,
      title: "Insufficient Credits or Quota",
      description:
        "The provider rejected the request for billing reasons — your account is out of credits or over its quota. Add funds or check your billing settings.",
      icon: CircleDollarSign,
      category: "billing",
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

// Adaptive speech input for the composer. Shown only when a usable speech
// credential (genuine OpenAI key, or Google/Gemini key) is configured. Push to
// talk: records the mic, transcribes via the resolved provider, and inserts the
// text into the composer for review before sending.
function SpeechMicButton() {
  const composer = useComposerRuntime();
  const [available, setAvailable] = useState(false);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [liveOpen, setLiveOpen] = useState(false);
  const recorderRef = useRef<MicRecorder | null>(null);

  useEffect(() => {
    let cancelled = false;
    const check = () => {
      resolveSpeechCredential(getProviderApiKey)
        .then((cred) => {
          if (!cancelled) setAvailable(cred !== null);
        })
        .catch(() => {
          if (!cancelled) setAvailable(false);
        });
    };
    check();
    // Re-check when a key is added/changed via the API-key prompt.
    window.addEventListener("keating:api-key-prompt-changed", check);
    return () => {
      cancelled = true;
      window.removeEventListener("keating:api-key-prompt-changed", check);
    };
  }, []);

  const appendToComposer = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const existing = composer.getState().text;
    composer.setText(existing ? `${existing.trimEnd()} ${trimmed}` : trimmed);
  };

  // Push-to-talk one-shot dictation (used when no duplex provider is active,
  // and as the fallback when a live session cannot start).
  const runPushToTalk = async () => {
    if (busy) return;
    if (recording) {
      const recorder = recorderRef.current;
      recorderRef.current = null;
      setRecording(false);
      if (!recorder) return;
      setBusy(true);
      try {
        const blob = await recorder.stop();
        const cred = await resolveSpeechCredential(getProviderApiKey);
        if (!cred) throw new Error("No speech credential available.");
        const text = await transcribeAudio(blob, { provider: cred.provider, apiKey: cred.apiKey });
        appendToComposer(text);
      } catch (error) {
        console.warn("[keating:stt] transcription failed", error);
      } finally {
        setBusy(false);
      }
      return;
    }
    try {
      recorderRef.current = await startMicRecording();
      setRecording(true);
    } catch (error) {
      console.warn("[keating:stt] microphone unavailable", error);
    }
  };

  if (!available) return null;

  const mode = speechInputMode(loadWebSpeechSettings());
  const title =
    mode === "duplex"
      ? "Start a live voice conversation with Keating"
      : "Dictate your message (push to talk)";

  const handleClick = () => {
    if (busy) return;
    if (mode === "duplex" && !recording) {
      setLiveOpen(true);
      return;
    }
    void runPushToTalk();
  };

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        title={title}
        aria-label={title}
        aria-pressed={recording}
        className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50 sm:h-9 sm:w-9 ${
          recording ? "animate-pulse border-destructive text-destructive" : ""
        }`}
      >
        {busy ? (
          <Loader2 size={16} className="animate-spin" />
        ) : recording ? (
          <MicOff size={16} />
        ) : (
          <Mic size={16} />
        )}
      </button>
      {liveOpen ? (
        <LiveVoiceOverlay
          onClose={() => setLiveOpen(false)}
          onTranscript={appendToComposer}
          onFallback={() => {
            setLiveOpen(false);
            void runPushToTalk();
          }}
        />
      ) : null}
    </>
  );
}

const LIVE_STATE_LABEL: Record<LiveSpeechState, string> = {
  connecting: "Connecting…",
  listening: "Listening",
  speaking: "Keating is speaking",
  closed: "Ended",
};

// Live bidirectional voice session overlay. Drives the configured duplex
// speech provider (OpenAI Realtime / Gemini Live) and degrades to push-to-talk
// dictation if the live session cannot be established.
function LiveVoiceOverlay({
  onClose,
  onTranscript,
  onFallback,
}: {
  onClose: () => void;
  onTranscript: (text: string) => void;
  onFallback: () => void;
}) {
  const [state, setState] = useState<LiveSpeechState>("connecting");
  const [userText, setUserText] = useState("");
  const [assistantText, setAssistantText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const sessionRef = useRef<LiveSpeechSession | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const userTextRef = useRef("");

  useEffect(() => {
    const abort = new AbortController();
    abortRef.current = abort;
    let active = true;
    // Delta chunks (final=false) append; a standalone final replaces only when
    // no deltas were seen, covering providers that emit either style.
    const merge = (prev: string, text: string, final: boolean) => (final && prev === "" ? text : prev + text);
    (async () => {
      try {
        const settings = loadWebSpeechSettings();
        const provider = await getSpeechProvider(settings.providerId);
        if (!provider?.startLiveSession) {
          throw new Error("The selected speech provider does not support live voice.");
        }
        const session = await provider.startLiveSession({
          settings,
          getApiKey: getProviderApiKey,
          signal: abort.signal,
          onState: (next) => { if (active) setState(next); },
          onUserTranscript: (text, final) => {
            if (!active || !text) return;
            userTextRef.current = merge(userTextRef.current, text, final);
            setUserText(userTextRef.current);
          },
          onAssistantTranscript: (text, final) => {
            if (!active || !text) return;
            setAssistantText((prev) => merge(prev, text, final));
          },
          onError: (err) => { if (active) setError(err.message); },
        });
        if (!active) {
          void session.stop();
          return;
        }
        sessionRef.current = session;
      } catch (err) {
        if (active) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      active = false;
      abort.abort();
      void sessionRef.current?.stop().catch(() => {});
    };
  }, []);

  const finish = () => {
    abortRef.current?.abort();
    void sessionRef.current?.stop().catch(() => {});
    onTranscript(userTextRef.current);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Live voice conversation"
    >
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-xl">
        <div className="flex items-center gap-3">
          <span
            className={`inline-flex h-10 w-10 items-center justify-center rounded-full border ${
              error
                ? "border-destructive text-destructive"
                : state === "speaking"
                  ? "border-primary text-primary"
                  : "border-border text-foreground"
            } ${state === "listening" && !error ? "animate-pulse" : ""}`}
          >
            {error ? <MicOff size={18} /> : state === "connecting" ? <Loader2 size={18} className="animate-spin" /> : <Mic size={18} />}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium">{error ? "Voice session error" : LIVE_STATE_LABEL[state]}</div>
            <div className="truncate text-xs text-muted-foreground">Live voice with Keating</div>
          </div>
          <button
            type="button"
            onClick={finish}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Close live voice"
            title="Close"
          >
            <X size={16} />
          </button>
        </div>

        {error ? (
          <div className="mt-4 space-y-3">
            <p className="text-xs text-destructive">{error}</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onFallback}
                className="dialog-compact-button inline-flex items-center justify-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
              >
                <Mic size={14} /> Use dictation instead
              </button>
              <button
                type="button"
                onClick={finish}
                className="dialog-compact-button inline-flex items-center justify-center rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            <div className="max-h-40 space-y-2 overflow-y-auto text-sm">
              {assistantText ? (
                <p className="rounded-md bg-muted/50 px-3 py-2 text-foreground">{assistantText}</p>
              ) : null}
              {userText ? (
                <p className="text-right text-muted-foreground">{userText}</p>
              ) : null}
              {!assistantText && !userText ? (
                <p className="text-xs text-muted-foreground">Start speaking — Keating is listening.</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={finish}
              className="dialog-compact-button inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive hover:bg-destructive/20"
            >
              <MicOff size={16} /> End conversation
            </button>
          </div>
        )}
      </div>
    </div>
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

function authErrorFromAgentMessage(
  msg: any,
  fallbackProvider?: string,
): AuthErrorEntry | null {
  if (msg.role !== "assistant" || msg.stopReason !== "error") return null;
  const errorText = msg.errorMessage ?? "";
  if (!AUTH_ERROR_PATTERNS.test(errorText)) return null;
  if (VOICE_ERROR_PATTERNS.test(errorText)) return null;
  const provider =
    msg.provider ??
    msg.model?.provider ??
    msg.model?.split?.("/", 2)?.[0] ??
    fallbackProvider ??
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
const questionTagPattern = /<keating-question\s+json=([^>]+)\s*\/>/g;
const goalTagPattern = /<keating-goal\s+json=([^>]+)\s*\/>/g;
const generatedImageTagPattern = /<keating-image\s+json=([^>]+)\s*\/>/g;
const quizResultTagPattern = /<keating-quiz-result\s+json=([^>]+)\s*\/>/g;
const interactiveTagPattern = /<keating-(quiz|scene|question|goal|image|quiz-result|quiz-grade|animation|deck)\s+(json|markdown)=([^>]+)\s*\/>/g;
const URL_IN_TEXT_PATTERN = /\bhttps?:\/\/[^\s<>"')\]]+/i;

function parseInteractiveSegments(
  text: string,
): Array<
  | { type: "text"; content: string }
  | { type: "quiz"; json: string }
  | { type: "scene"; markdown: string }
  | { type: "question"; json: string }
  | { type: "goal"; json: string }
  | { type: "image"; json: string }
  | { type: "quiz-result"; json: string }
  | { type: "quiz-grade"; json: string }
  | { type: "animation"; json: string }
  | { type: "deck"; json: string }
> {
  const segments: ReturnType<typeof parseInteractiveSegments> = [];
  let lastIndex = 0;

  for (const match of text.matchAll(interactiveTagPattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      segments.push({ type: "text", content: text.slice(lastIndex, index) });
    }

    const tag = match[1];
    const payload = match[3];
    if (tag === "quiz") segments.push({ type: "quiz", json: payload });
    if (tag === "quiz-result") segments.push({ type: "quiz-result", json: payload });
    if (tag === "quiz-grade") segments.push({ type: "quiz-grade", json: payload });
    if (tag === "scene") {
      let markdown = payload;
      try {
        markdown = JSON.parse(payload);
      } catch {
        // Older tags may already carry raw markdown.
      }
      segments.push({ type: "scene", markdown });
    }
    if (tag === "question") segments.push({ type: "question", json: payload });
    if (tag === "goal") segments.push({ type: "goal", json: payload });
    if (tag === "image") segments.push({ type: "image", json: payload });
    if (tag === "animation") segments.push({ type: "animation", json: payload });
    if (tag === "deck") segments.push({ type: "deck", json: payload });
    lastIndex = index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ type: "text", content: text.slice(lastIndex) });
  }
  if (segments.length === 0) segments.push({ type: "text", content: text });
  return segments;
}

function stripQuestionTags(text: string): string {
  return text.replace(questionTagPattern, "").trim();
}

function stripQuizTags(text: string): string {
  let result = text;
  for (const _match of text.matchAll(quizTagPattern)) {
    result = result.replace(_match[0], "");
  }
  return result.trim();
}

function stripGoalTags(text: string): string {
  return text.replace(goalTagPattern, "").trim();
}

function stripGeneratedImageTags(text: string): string {
  return text.replace(generatedImageTagPattern, "").trim();
}

function extractLatestTagPayload(text: string, pattern: RegExp, captureIndex = 1): string | null {
  pattern.lastIndex = 0;
  let latest: string | null = null;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const capture = match[captureIndex];
    if (typeof capture === "string") latest = capture;
    if (match[0] === "") pattern.lastIndex += 1;
  }
  pattern.lastIndex = 0;
  return latest;
}

function extractQuestionPayload(text: string): string | null {
  return extractLatestTagPayload(text, questionTagPattern);
}

function parseQuestionPayload(payload: string): QuestionFormData | null {
  try {
    const parsed = JSON.parse(payload);
    return normalizeQuestionForm(typeof parsed === "string" ? JSON.parse(parsed) : parsed);
  } catch {
    return null;
  }
}

/** Scan messages backward and return the most recent unanswered question form. */
function extractActiveQuestion(messages: AgentMessage[]): QuestionFormData | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as any;
    if (msg.role === "user") return null;
    if (msg.role !== "assistant") continue;
    if (!Array.isArray(msg.content)) continue;
    for (const part of msg.content) {
      if (part?.type === "text" && typeof part.text === "string") {
        const payload = extractQuestionPayload(part.text);
        if (payload) {
          const form = parseQuestionPayload(payload);
          if (form) return form;
        }
      }
      if (part?.type === "toolCall" && part.__toolResult !== undefined) {
        let toolText = "";
        if (typeof part.__toolResult === "string") {
          toolText = part.__toolResult;
        } else if (Array.isArray(part.__toolResult)) {
          toolText = part.__toolResult
            .map((p: any) => (p?.type === "text" && typeof p.text === "string" ? p.text : ""))
            .filter(Boolean)
            .join("\n");
        }
        if (toolText) {
          const payload = extractQuestionPayload(toolText);
          if (payload) {
            const form = parseQuestionPayload(payload);
            if (form) return form;
          }
        }
      }
    }
  }
  return null;
}

/** Scan messages backward and return the most recent un-submitted quiz payload. */
function extractActiveQuiz(messages: AgentMessage[]): Quiz | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i] as any;
    if (msg.role === "user") return null;
    if (msg.role !== "assistant") continue;
    if (!Array.isArray(msg.content)) continue;
    for (const part of msg.content) {
      if (part?.type === "text" && typeof part.text === "string") {
        const payload = extractLatestTagPayload(part.text, quizTagPattern);
        if (payload) {
          try {
            const parsed = JSON.parse(JSON.parse(payload)) as Quiz;
            if (parsed && parsed.questions?.length > 0) return parsed;
          } catch {
            // ignore unparseable
          }
        }
      }
      if (part?.type === "toolCall" && part.__toolResult !== undefined) {
        let toolText = "";
        if (typeof part.__toolResult === "string") {
          toolText = part.__toolResult;
        } else if (Array.isArray(part.__toolResult)) {
          toolText = part.__toolResult
            .map((p: any) => (p?.type === "text" && typeof p.text === "string" ? p.text : ""))
            .filter(Boolean)
            .join("\n");
        }
        if (toolText) {
          const payload = extractLatestTagPayload(toolText, quizTagPattern);
          if (payload) {
            try {
              const parsed = JSON.parse(JSON.parse(payload)) as Quiz;
              if (parsed && parsed.questions?.length > 0) return parsed;
            } catch {
              // ignore unparseable
            }
          }
        }
      }
    }
  }
  return null;
}

/**
 * Render a single interactive segment (quiz/scene/question/goal) to its live
 * component. Returns null for plain-text segments and for unparseable payloads.
 * Shared by MarkdownText (assistant text) and ToolPart (tool results) so the
 * cards render no matter which message channel carries the tag.
 */
function renderInteractiveSegment(
  seg: ReturnType<typeof parseInteractiveSegments>[number],
  key: Key,
): ReactNode | null {
  if (seg.type === "quiz") {
    try {
      const parsed = JSON.parse(JSON.parse(seg.json)) as Quiz;
      return (
        <QuizRenderer
          key={key}
          quiz={parsed}
          onSubmit={(result) => {
            window.dispatchEvent(
              new CustomEvent("keating:quiz-submitted", {
                detail: {
                  quizId: parsed.slug,
                  topic: parsed.topic,
                  total: parsed.questions.length,
                  questions: parsed.questions.map((q) => ({
                    id: q.id,
                    question: q.question,
                    correctAnswer: q.correctAnswer,
                    type: q.type,
                  })),
                  answers: result.answers,
                  score: result.score,
                  weightedScore: result.weightedScore,
                  confidence: result.confidence,
                  partialCredits: result.partialCredits,
                  flagged: result.flagged,
                  timing: result.timing,
                },
              }),
            );
          }}
        />
      );
    } catch {
      return null;
    }
  }
  if (seg.type === "quiz-result") {
    try {
      const data = JSON.parse(JSON.parse(seg.json)) as {
        id: string;
        timestamp: number;
        quiz: Quiz;
        result: QuizResult;
      };
      return (
        <QuizResultCard
          key={key}
          data={data}
          onReview={() => {
            // Review logic can be wired later
          }}
        />
      );
    } catch {
      return null;
    }
  }
  if (seg.type === "quiz-grade") {
    try {
      const payload = JSON.parse(JSON.parse(seg.json)) as QuizGradePayload;
      return <QuizGradeApplier key={key} payload={payload} />;
    } catch {
      return null;
    }
  }
  if (seg.type === "scene") {
    return <SceneRenderer key={key} storyboard={seg.markdown} />;
  }
  if (seg.type === "question") {
    try {
      const form = normalizeQuestionForm(JSON.parse(JSON.parse(seg.json)));
      if (!form) return null;
      return (
        <QuestionRenderer
          key={key}
          data={form}
          onSubmit={(answers) => {
            window.dispatchEvent(
              new CustomEvent("keating:question-answered", { detail: { answers } }),
            );
          }}
        />
      );
    } catch {
      return null;
    }
  }
  if (seg.type === "goal") {
    try {
      const goal = normalizeGoal(JSON.parse(JSON.parse(seg.json)));
      if (!goal) return null;
      return <GoalRenderer key={key} goal={goal} />;
    } catch {
      return null;
    }
  }
  if (seg.type === "image") {
    return <GeneratedImageCard key={key} payload={seg.json} />;
  }
  if (seg.type === "animation") {
    try {
      const payloadStr = JSON.parse(seg.json) as string;
      const parsed = parseAnimationPayload(payloadStr);
      if (!parsed) return null;
      return <AnimatedScene key={key} payload={parsed} />;
    } catch {
      return null;
    }
  }
  if (seg.type === "deck") {
    try {
      const payloadStr = JSON.parse(seg.json) as string;
      const parsed = JSON.parse(payloadStr) as FlashcardDeck;
      if (!parsed || !Array.isArray(parsed.cards)) return null;
      const restrictToCardIds = Array.isArray((parsed as FlashcardDeck & { restrictToCardIds?: string[] }).restrictToCardIds)
        ? ((parsed as FlashcardDeck & { restrictToCardIds?: string[] }).restrictToCardIds ?? [])
        : undefined;
      return (
        <FlashcardRenderer
          key={key}
          deck={parsed}
          {...(restrictToCardIds ? { restrictToCardIds } : {})}
          onReview={(result) => {
            window.dispatchEvent(
              new CustomEvent("keating:card-reviewed", {
                detail: { deckId: parsed.id, cardId: result.cardId, rating: result.rating },
              }),
            );
          }}
        />
      );
    } catch {
      return null;
    }
  }
  return null;
}

/** Extract only the interactive cards from a block of text (e.g. a tool result). */
function extractInteractiveCards(text: string): ReactNode[] {
  const cards: ReactNode[] = [];
  parseInteractiveSegments(text).forEach((seg, i) => {
    if (seg.type === "question" || seg.type === "quiz") return;
    const card = renderInteractiveSegment(seg, `card-${i}`);
    if (card !== null) cards.push(card);
  });
  return cards;
}

function CopyButton({
  text,
  label = "Copy",
  className = "",
  variant = "outline",
}: {
  text: string;
  label?: string;
  className?: string;
  /** "outline" = bordered chip; "ghost" = borderless, matches message action-row buttons. */
  variant?: "outline" | "ghost";
}) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch (error) {
      console.warn("Copy failed:", error);
    }
  };

  const base =
    variant === "ghost"
      ? "h-6 w-6 rounded text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      : "h-7 w-7 rounded-md border border-border bg-background/85 text-muted-foreground hover:bg-accent hover:text-accent-foreground";

  return (
    <button
      type="button"
      onClick={copy}
      className={`inline-flex items-center justify-center transition-colors ${base} ${className}`}
      aria-label={copied ? "Copied" : label}
      title={copied ? "Copied" : label}
    >
      {copied ? <Check size={13} className="text-green-500" /> : <Copy size={13} />}
    </button>
  );
}

function copyTextFromReactNode(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(copyTextFromReactNode).join("");
  if (node && typeof node === "object" && "props" in node) {
    return copyTextFromReactNode((node as { props?: { children?: ReactNode } }).props?.children);
  }
  return "";
}

function GeneratedImageCard({ payload }: { payload: string }) {
  let data: { title?: string; alt?: string; svg?: string; dataUrl?: string; mimeType?: string; model?: string; prompt?: string } | null = null;
  try {
    const parsed = JSON.parse(payload);
    data = typeof parsed === "string" ? JSON.parse(parsed) : parsed;
  } catch {
    data = null;
  }

  if (!data?.svg && !data?.dataUrl) return null;

  const src = data.dataUrl ?? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(data.svg ?? "")}`;
  const copyText = data.svg ?? data.dataUrl ?? "";
  return (
    <figure className="my-3 overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <div className="min-w-0">
          <figcaption className="truncate text-xs font-medium text-foreground">
            {data.title ?? "Generated learning image"}
          </figcaption>
          {data.model && (
            <div className="truncate font-terminal text-[10px] text-muted-foreground">
              {data.model}
            </div>
          )}
        </div>
        <CopyButton text={copyText} label={data.svg ? "Copy SVG" : "Copy image"} />
      </div>
      <img
        src={src}
        alt={data.alt ?? data.title ?? "Generated learning image"}
        className="w-full bg-white"
      />
    </figure>
  );
}

// Static renderer map for chat markdown. Hoisted to module scope so it is
// created once instead of rebuilt for every segment on every streaming token.
const MARKDOWN_COMPONENTS: Components = {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              pre: ({ children }: any) => (
                <div className="group/code my-2">
                  <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">
                    {children}
                  </pre>
                  <div className="mt-1 flex justify-end">
                    <CopyButton
                      text={copyTextFromReactNode(children).replace(/\n$/, "")}
                      label="Copy code"
                      className="opacity-0 group-hover/code:opacity-100 focus:opacity-100"
                    />
                  </div>
                </div>
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
};

const MarkdownText = memo(function MarkdownText({
  text,
  isRunning,
}: {
  text: string;
  isRunning?: boolean;
}) {
  const displayText = stripArtifactLinks(text);
  // Parsing segments is non-trivial and runs on every streaming token; memoize
  // it on the text so unchanged messages don't re-parse.
  const segments = useMemo(
    () =>
      parseInteractiveSegments(displayText).filter(
        (s) => s.type !== "question" && s.type !== "quiz",
      ),
    [displayText],
  );
  return (
    <div className="group/text-block break-words text-sm leading-6">
      <ArtifactChips text={text} />
      {segments.map((seg, i) => {
        const card = renderInteractiveSegment(seg, i);
        if (card !== null) return card;
        return (
          <ReactMarkdown
            key={i}
            remarkPlugins={[remarkGfm, remarkMath]}
            rehypePlugins={[rehypeKatex]}
            components={MARKDOWN_COMPONENTS}
          >
            {seg.type === "text" ? seg.content : ""}
          </ReactMarkdown>
        );
      })}
      {isRunning ? <span className="ml-0.5 animate-pulse">|</span> : null}
    </div>
  );
});

function ReasoningPart({
  text,
  status,
}: {
  text: string;
  status?: { type: string };
}) {
  const [open, setOpen] = useState(() => status?.type === "running");
  const userToggledRef = useRef(false);

  useEffect(() => {
    if (status?.type === "running") {
      userToggledRef.current = false;
      setOpen(true);
      return;
    }
    if (!userToggledRef.current) setOpen(false);
  }, [status?.type]);

  if (!text.trim()) return null;
  return (
    <details
      open={open}
      onToggle={(event) => {
        userToggledRef.current = true;
        setOpen(event.currentTarget.open);
      }}
      className="mb-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 font-medium">
        <span>Reasoning</span>
        <CopyButton text={text} label="Copy" />
      </summary>
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

  // Tools emit interactive cards (ask_user_question, quiz, goal, animation) as
  // tags in their result text. Render those as live components — always visible,
  // independent of the "Show tool details" toggle.
  const interactiveCards =
    state === "success" ? extractInteractiveCards(resultText) : [];
  if (interactiveCards.length > 0) {
    return <div className="w-full">{interactiveCards}</div>;
  }

  const stateClass =
    state === "error"
      ? "border-destructive/60 bg-destructive/10 text-destructive"
      : state === "running"
        ? "border-amber-500/60 bg-green-500/10 text-amber-600 dark:text-amber-300"
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
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1">
              <ChevronRight size={13} />
              Arguments
            </span>
            <CopyButton text={JSON.stringify(args, null, 2)} label="Copy" />
          </summary>
          <JsonCrackBlock value={args} maxHeight="16rem" title="Arguments" />
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
          {typeof result === "object" && result !== null ? (
            <JsonCrackBlock value={result} maxHeight="16rem" title="Result" />
          ) : (
            <>
              <div className="mb-1 flex justify-end">
                <CopyButton text={resultText} label="Copy output" />
              </div>
              <pre className="max-h-44 overflow-auto whitespace-pre-wrap font-mono leading-5">
                {resultText}
              </pre>
            </>
          )}
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
      if (part?.type === "reasoning" && typeof part.text === "string")
        return part.text;
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

function mergeConsecutiveAssistantMessages(messages: AgentMessage[]): AgentMessage[] {
 const merged: AgentMessage[] = [];
 for (const message of messages) {
 const msg = message as any;
 if (msg.role === "assistant" && merged.length > 0) {
 const last = merged[merged.length - 1] as any;
 if (last.role === "assistant") {
 const left = Array.isArray(last.content)
 ? last.content.map((p: any) => ({ ...p }))
 : [{ type: "text", text: textFromContent(last.content) }];
 const right = Array.isArray(msg.content)
 ? msg.content.map((p: any) => ({ ...p }))
 : [{ type: "text", text: textFromContent(msg.content) }];
 last.content = [...left, ...right];
 if (msg.timestamp) last.timestamp = msg.timestamp;
 if (msg.stopReason !== undefined) last.stopReason = msg.stopReason;
 if (msg.errorMessage) {
 last.errorMessage = msg.errorMessage;
 last.stopReason = msg.stopReason ?? last.stopReason;
 }
 if (msg.__keatingStreaming) last.__keatingStreaming = msg.__keatingStreaming;
 continue;
 }
 }
 merged.push(message);
 }
 return merged;
}

function hasRenderableAssistantContent(content: unknown): boolean {
  if (!Array.isArray(content)) return typeof content === "string" && content.trim().length > 0;
  return content.some((part: any) => {
    if (part?.type === "text") return typeof part.text === "string" && part.text.trim().length > 0;
    if (part?.type === "thinking") return typeof part.thinking === "string" && part.thinking.trim().length > 0;
    if (part?.type === "reasoning") return typeof part.text === "string" && part.text.trim().length > 0;
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
  return mergeConsecutiveAssistantMessages(
 foldToolResults(filterSpeechMessages(messages, speechEnabled)),
 );
}

type AssistantTextPart =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string };

const THINK_TAG_PATTERN = /<\/?think(?:ing)?>/gi;

function normalizeReasoningText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function normalizeAssistantContentParts(parts: any[]): any[] {
  const normalized: any[] = [];

  for (const part of parts) {
    if (part.type !== "reasoning") {
      normalized.push(part);
      continue;
    }

    const text = part.text ?? "";
    const key = normalizeReasoningText(text);
    if (!key) continue;

    const last = normalized.at(-1);
    if (last?.type === "reasoning") {
      const lastText = last.text ?? "";
      const lastKey = normalizeReasoningText(lastText);
      if (lastKey === key) continue;
      if (lastKey.includes(key)) continue;
      if (key.includes(lastKey)) {
        last.text = text;
        continue;
      }
      last.text = `${lastText.trim()}\n\n${text.trim()}`;
      continue;
    }

    const duplicateIndex = normalized.findIndex((candidate) => {
      if (candidate.type !== "reasoning") return false;
      const candidateKey = normalizeReasoningText(candidate.text ?? "");
      return candidateKey === key || candidateKey.includes(key) || key.includes(candidateKey);
    });
    if (duplicateIndex !== -1) {
      const duplicate = normalized[duplicateIndex];
      const duplicateKey = normalizeReasoningText(duplicate.text ?? "");
      if (key.length > duplicateKey.length) duplicate.text = text;
      continue;
    }

    normalized.push(part);
  }

  return normalized;
}

function assistantTextParts(text: string): AssistantTextPart[] {
  if (!text) return [{ type: "text", text: "" }];

  // Some OpenAI-compatible reasoning models leak malformed closing tags without
  // a matching opening tag. When that happens, the safest behavior is to treat
  // everything before the final closing tag as hidden reasoning and only render
  // the post-close tail as the learner-visible answer.
  if (!/<think(?:ing)?>/i.test(text) && /<\/think(?:ing)?>/i.test(text)) {
    const matches = [...text.matchAll(/<\/think(?:ing)?>/gi)];
    const last = matches.at(-1);
    if (last && typeof last.index === "number") {
      const reasoning = text.slice(0, last.index).trim();
      const visible = text.slice(last.index + last[0].length).trim();
      const parts: AssistantTextPart[] = [];
      if (reasoning) parts.push({ type: "reasoning", text: reasoning });
      if (visible) parts.push({ type: "text", text: visible });
      return parts.length > 0 ? parts : [{ type: "text", text: "" }];
    }
  }

  const parts: AssistantTextPart[] = [];
  let cursor = 0;
  let reasoningStart: number | null = null;

  for (const match of text.matchAll(THINK_TAG_PATTERN)) {
    const tag = match[0].toLowerCase();
    const tagIndex = match.index ?? 0;
    if (!tag.startsWith("</")) {
      if (reasoningStart === null) {
        const visible = text.slice(cursor, tagIndex);
        if (visible) parts.push({ type: "text", text: visible });
        reasoningStart = tagIndex + match[0].length;
        cursor = reasoningStart;
      }
      continue;
    }

    if (reasoningStart !== null) {
      const reasoning = text.slice(reasoningStart, tagIndex);
      if (reasoning.trim()) parts.push({ type: "reasoning", text: reasoning });
      cursor = tagIndex + match[0].length;
      reasoningStart = null;
    }
  }

  if (reasoningStart !== null) {
    const reasoning = text.slice(reasoningStart);
    if (reasoning.trim()) parts.push({ type: "reasoning", text: reasoning });
    return parts.length > 0 ? parts : [{ type: "text", text: "" }];
  }

  const tail = text.slice(cursor);
  if (tail) parts.push({ type: "text", text: tail });
  return parts.length > 0 ? parts : [{ type: "text", text: "" }];
}

function assistantHasPendingToolCalls(content: unknown): boolean {
  if (!Array.isArray(content)) return false;
  return content.some((part: any) =>
    part?.type === "toolCall" &&
    part.__toolResult === undefined &&
    part.__toolDetails === undefined &&
    part.__toolError === undefined,
  );
}

function assistantHasToolCalls(content: unknown): boolean {
  return Array.isArray(content) && content.some((part: any) => part?.type === "toolCall");
}

function toAssistantMessage(
  message: AgentMessage,
  index: number,
  totalMessages: number,
  isRunning: boolean,
  fallbackProvider?: string,
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
    !(assistantHasToolCalls(msg.content) && !assistantHasPendingToolCalls(msg.content)) &&
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
    const content = normalizeAssistantContentParts(Array.isArray(msg.content)
      ? msg.content.flatMap((part: any) => {
          if (part?.type === "thinking")
            return [{ type: "reasoning" as const, text: part.thinking ?? "" }];
          if (part?.type === "toolCall") {
            return [{
              type: "tool-call" as const,
              toolCallId: part.id ?? `tool-${index}`,
              toolName: part.name ?? "tool",
              args: part.arguments ?? {},
              argsText: JSON.stringify(part.arguments ?? {}),
              result: part.__toolResult ?? part.__toolDetails,
              isError: part.__toolError,
            }];
          }
          return assistantTextParts(part?.text ?? "");
        })
      : assistantTextParts(textFromContent(msg.content)));

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

    const authError = authErrorFromAgentMessage(msg, fallbackProvider);
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

function makeUserTextMessage(text: string): AgentMessage {
  return {
    role: "user",
    content: [{ type: "text", text }],
    timestamp: Date.now(),
  } as AgentMessage;
}

function hasUserTextMessage(messages: AgentMessage[], text: string): boolean {
  const normalized = text.trim();
  return messages.some((message) => {
    const msg = message as any;
    if (msg.role !== "user" && msg.role !== "user-with-attachments") return false;
    return textFromContent(msg.content).trim() === normalized;
  });
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

function errorMessageText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function makePromptErrorMessage(agent: Agent, error: unknown): AgentMessage {
  return makeAttachmentErrorMessage(agent, errorMessageText(error));
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
                              ? "#1e9b50"
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
  const activeQuestion = useMemo(
    () => extractActiveQuestion(messages),
    [messages],
  );
  const activeQuiz = useMemo(
    () => extractActiveQuiz(messages),
    [messages],
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
      toAssistantMessage(
        message,
        index,
        totalMessages,
        isRunning,
        modelRef.current?.provider,
      ),
    [totalMessages, isRunning],
  );

  const sendText = useCallback(
    async (text: string) => {
      if (!agent || !text.trim()) return;
      if (agent.state.isStreaming) return;
      const provider = agent.state.model.provider;
      if (
        callbacks.onApiKeyRequired &&
        !(await callbacks.onApiKeyRequired(provider))
      )
        return;
      await callbacks.onBeforeSend?.();
      setComposerHasUrl(false);
      try {
        await agent.prompt(text);
      } catch (error) {
        console.error("Keating send failed before the model stream started:", error);
        if (!hasUserTextMessage(agent.state.messages, text)) {
          agent.state.messages.push(makeUserTextMessage(text));
        }
        agent.state.messages.push(makePromptErrorMessage(agent, error));
        setLocalVersion((current) => current + 1);
        await callbacks.onLocalMessagesChanged?.();
      }
    },
    [agent, callbacks],
  );

  const onNew = useCallback(
    async (message: AppendMessage) => {
      if (!agent) return;
      const userMessage = makeUserMessageFromAppend(message);
      if (!userMessage) return;
      if (agent.state.isStreaming) return;

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
        await callbacks.onLocalMessagesChanged?.();
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
      try {
        await agent.prompt(userMessage);
      } catch (error) {
        console.error("Keating send failed before the model stream started:", error);
        const userText = textFromContent((userMessage as any).content);
        if (!userText || !hasUserTextMessage(agent.state.messages, userText)) {
          agent.state.messages.push(userMessage);
        }
        agent.state.messages.push(makePromptErrorMessage(agent, error));
        setLocalVersion((current) => current + 1);
        await callbacks.onLocalMessagesChanged?.();
      }
    },
    [agent, callbacks],
  );

  const onCancel = useCallback(async () => {
    agent?.abort();
  }, [agent]);

  // System-initiated sends (quiz remediation/reframe requests, etc.) can fire
  // while the agent is mid-stream, where onNew silently drops them. Queue those
  // and flush when the agent goes idle so the request is never lost.
  const [quizGrades, setQuizGrades] = useState<Record<string, QuizQuestionGrade[]>>({});
  const quizGradesContextValue = useMemo<QuizGradesContextValue>(
    () => ({
      grades: quizGrades,
      applyGrades: (resultId, grades) =>
        setQuizGrades((prev) => ({ ...prev, [resultId]: grades })),
    }),
    [quizGrades],
  );

  const pendingSendsRef = useRef<AppendMessage[]>([]);
  const queueOrSend = useCallback(
    (message: AppendMessage) => {
      if (agent && !agent.state.isStreaming) {
        void onNew(message);
      } else {
        pendingSendsRef.current.push(message);
      }
    },
    [agent, onNew],
  );

  useEffect(() => {
    if (isRunning || !agent) return;
    if (pendingSendsRef.current.length === 0) return;
    const next = pendingSendsRef.current.shift();
    if (next) void onNew(next);
  }, [isRunning, agent, onNew]);

  // When the learner submits an ask_user_question form, feed their answers back
  // into the conversation as a user turn so the agent actually receives them.
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | { answers?: AnsweredQuestion[] }
        | undefined;
      const answers = detail?.answers;
      if (!agent || !answers || answers.length === 0) return;
      const text =
        answers.length === 1 && !answers[0].header
          ? answers[0].answer
          : answers
              .map(
                (a) =>
                  `- ${a.header ? `${a.header} — ` : ""}${a.question}: ${a.answer}`,
              )
              .join("\n");
      void onNew({
        role: "user",
        content: [{ type: "text", text }],
      } as unknown as AppendMessage);
    };
    window.addEventListener("keating:question-answered", handler);
    return () => window.removeEventListener("keating:question-answered", handler);
  }, [agent, onNew]);

  // When the learner finishes a quiz, report their score, timing, confidence,
  // partial credits, and flagged questions back to the agent.
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as
	        | {
	            quizId?: string;
	            topic?: string;
	            total?: number;
            score?: number;
            weightedScore?: number;
            confidence?: Record<string, number>;
            partialCredits?: Record<string, number>;
            flagged?: string[];
            timing?: { totalMs: number; perQuestionMs: Record<string, number> };
            questions?: Array<{ id: string; question: string; correctAnswer: string; type?: string }>;
            answers?: Record<string, string>;
          }
        | undefined;
      if (!agent || !detail || typeof detail.score !== "number") return;
      const total = detail.total ?? 0;
      const resultId = `${detail.quizId ?? "quiz"}-${Date.now()}`;
      // Open-ended answers (short answer / transfer / free-text fill-in) have no
      // single correct string, so they're not auto-scored — the model judges them
      // by meaning via grade_quiz. detail.score counts objective questions only.
      const isOpen = (type?: string) =>
        type === "short_answer" || type === "transfer" || type === "fill_in";
      const openEndedTotal = (detail.questions ?? []).filter((q) => isOpen(q.type)).length;
      const objectiveTotal = total - openEndedTotal;
      const seconds = detail.timing ? Math.round(detail.timing.totalMs / 1000) : null;
      const lines: string[] = [
        `I finished the quiz${detail.topic ? ` on "${detail.topic}"` : ""}.`,
        `Objective score: ${detail.score}/${objectiveTotal}${openEndedTotal > 0 ? ` (${openEndedTotal} open-ended pending your review)` : ""}${seconds !== null ? ` in ${seconds}s` : ""}.`,
      ];
      if (typeof detail.weightedScore === "number") {
        lines.push(`Weighted score: ${detail.weightedScore.toFixed(2)}.`);
      }
      if (detail.questions && detail.answers && detail.timing) {
        const perQ = detail.timing.perQuestionMs;
        let hasOpenEnded = false;
        for (const q of detail.questions) {
          const mine = (detail.answers[q.id] ?? "").trim();
          const conf = detail.confidence?.[q.id];
          const parts: string[] = [];
          if (isOpen(q.type)) {
            hasOpenEnded = true;
            parts.push(
              `- [open-ended id=${q.id}] ${q.question} → my answer: "${mine || "(blank)"}" (reference: "${q.correctAnswer}")`,
            );
          } else {
            const correct = mine.toLowerCase() === q.correctAnswer.trim().toLowerCase();
            const pc = detail.partialCredits?.[q.id];
            parts.push(`- ${q.question} → my answer: "${mine || "(blank)"}" ${correct ? "✓" : "✗"}`);
            if (typeof pc === "number" && !correct) {
              parts.push(`(partial credit: ${Math.round(pc * 100)}%)`);
            }
          }
          if (typeof conf === "number") {
            parts.push(`[confidence: ${conf}%]`);
          }
          const t = perQ[q.id] ? ` (${Math.round(perQ[q.id] / 1000)}s)` : "";
          parts.push(t);
          lines.push(parts.join(" "));
        }
        if (hasOpenEnded) {
          lines.push(
            `Grade the open-ended answers (marked [open-ended id=…]) by calling the grade_quiz tool with result_id "${resultId}" and a verdict (correct/partial/incorrect) per question id. Judge by meaning, not exact wording — the reference is one acceptable answer, not the only one. Your verdicts update the result card. Briefly explain anything I got wrong.`,
          );
        }
      }
      if (detail.flagged && detail.flagged.length > 0) {
        lines.push(`Bookmarked ${detail.flagged.length} question${detail.flagged.length > 1 ? "s" : ""} for review.`);
      }
      const lowConfidence = Object.entries(detail.confidence ?? {})
        .filter(([, v]) => v < 70)
        .map(([id]) => detail.questions?.find((q) => q.id === id)?.question)
        .filter(Boolean);
      if (lowConfidence.length > 0) {
        lines.push(`Low confidence on: ${lowConfidence.join("; ")}.`);
      }
      lines.push("Please review my answers and timing, then guide what to work on next.");
      const resultPayload = {
        id: resultId,
        timestamp: Date.now(),
        quiz: {
          slug: detail.quizId ?? "",
          topic: detail.topic ?? "",
          questions: detail.questions ?? [],
        },
        result: {
          answers: detail.answers ?? {},
          score: detail.score ?? 0,
          weightedScore: detail.weightedScore ?? 0,
          timing: detail.timing ?? { totalMs: 0, perQuestionMs: {} },
          confidence: detail.confidence ?? {},
          partialCredits: detail.partialCredits ?? {},
          flagged: detail.flagged ?? [],
        },
      };
      const tag = `<keating-quiz-result json=${JSON.stringify(JSON.stringify(resultPayload))} />`;
      void onNew({
        role: "user",
        content: [{ type: "text", text: lines.join("\n") + "\n\n" + tag }],
      } as unknown as AppendMessage);
    };
    window.addEventListener("keating:quiz-submitted", handler);
    return () => window.removeEventListener("keating:quiz-submitted", handler);
  }, [agent, onNew]);

  // Handle quiz remediation requests: learner clicked "Review" on a missed Bloom's level.
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | { level?: string; topic?: string; slug?: string }
        | undefined;
      if (!detail?.level) return;
      queueOrSend({
        role: "user",
        content: [
          {
            type: "text",
            text: `I need help with "${detail.level}" level questions on "${detail.topic || detail.slug || "this topic"}". Please generate targeted review material for this area.`,
          },
        ],
      } as unknown as AppendMessage);
    };
    window.addEventListener("keating:quiz-remediation-requested", handler);
    return () => window.removeEventListener("keating:quiz-remediation-requested", handler);
  }, [queueOrSend]);

  // Handle quiz reframe requests: learner selected a reframe mode with no pre-generated text.
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | { questionId?: string; mode?: string; topic?: string }
        | undefined;
      if (!detail?.mode || !detail?.questionId) return;
      queueOrSend({
        role: "user",
        content: [
          {
            type: "text",
            text: `Please reframe question "${detail.questionId}" in "${detail.mode}" mode for "${detail.topic || "this topic"}".`,
          },
        ],
      } as unknown as AppendMessage);
    };
    window.addEventListener("keating:quiz-reframe-requested", handler);
    return () => window.removeEventListener("keating:quiz-reframe-requested", handler);
  }, [queueOrSend]);

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
      <QuizGradesContext.Provider value={quizGradesContextValue}>
      <AssistantRuntimeProvider runtime={runtime}>
        <ThreadPrimitive.Root className="flex h-full min-h-0 flex-col bg-background text-foreground">
          <ThreadPrimitive.Viewport className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-3 py-4 sm:px-4 sm:py-6">
            <div className="flex flex-1 flex-col">
              <AuiIf condition={(state) => state.thread.isEmpty}>
                <SuggestedPrompts onSelect={sendText} />
              </AuiIf>
              <ThreadPrimitive.Messages components={threadComponents} />
            </div>
            <ThreadPrimitive.ViewportFooter className="sticky bottom-0 min-w-0 bg-background/95 pt-3 backdrop-blur">
              {activeQuiz && (
                <div className="mx-auto mb-1.5 sm:mb-2 w-full max-w-4xl overflow-x-hidden px-1.5 sm:px-0">
                  <QuizSessionPanel
                    quiz={activeQuiz}
                    onSubmit={(result) => {
                      window.dispatchEvent(
                        new CustomEvent("keating:quiz-submitted", {
                          detail: {
                            quizId: activeQuiz.slug,
                            topic: activeQuiz.topic,
                            total: activeQuiz.questions.length,
                            questions: activeQuiz.questions.map((q) => ({
                              id: q.id,
                              question: q.question,
                              correctAnswer: q.correctAnswer,
                              type: q.type,
                            })),
                            answers: result.answers,
                            score: result.score,
                            weightedScore: result.weightedScore,
                            confidence: result.confidence,
                            partialCredits: result.partialCredits,
                            flagged: result.flagged,
                            timing: result.timing,
                          },
                        }),
                      );
                    }}
                    onDismiss={() => {
                      // Dismiss just hides the active quiz panel; quiz remains
                      // visible in chat thread as a result card if completed.
                    }}
                  />
                </div>
              )}
              {activeQuestion && (
                <div className="mx-auto mb-1.5 sm:mb-2 w-full max-w-4xl overflow-x-hidden px-1.5 sm:px-0">
                  <QuestionRenderer
                    data={activeQuestion}
                    onSubmit={(answers) => {
                      window.dispatchEvent(
                        new CustomEvent("keating:question-answered", {
                          detail: { answers },
                        }),
                      );
                    }}
                  />
                </div>
              )}
              <ComposerPrimitive.Root className="composer-root mx-auto flex w-[calc(100%-6px)] max-w-4xl flex-col gap-1.5 sm:gap-2 rounded-lg border border-border bg-background p-1.5 sm:p-2 shadow-sm sm:w-full">
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
                    className="inline-flex h-8 max-w-16 shrink-0 items-center overflow-hidden truncate whitespace-nowrap rounded-md border border-border px-1.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50 sm:h-9 sm:max-w-20 sm:px-2 sm:text-xs"
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
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-50 sm:h-9 sm:w-9"
                    title="Attach files or images"
                    aria-label="Attach files or images"
                  >
                    <Paperclip size={15} className="sm:size-4" />
                  </ComposerPrimitive.AddAttachment>
                  <SpeechMicButton />
                  <ComposerPrimitive.Input
                    className="max-h-40 min-h-8 min-w-0 flex-1 resize-none self-center bg-transparent px-1 py-1.5 text-sm leading-5 text-foreground outline-none placeholder:text-muted-foreground sm:min-h-9 sm:px-1 sm:py-2"
                    placeholder="Message Keating"
                    rows={1}
                    onChange={(event) => setComposerHasUrl(URL_IN_TEXT_PATTERN.test(event.currentTarget.value))}
                  />
                  {/* Only show Send OR Cancel — never both */}
                  {isRunning ? (
                    <ComposerPrimitive.Cancel className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border-2 border-destructive text-destructive hover:bg-destructive hover:text-destructive-foreground animate-pulse sm:h-9 sm:w-9">
                      <Square size={15} className="sm:size-4" />
                    </ComposerPrimitive.Cancel>
                  ) : (
                    <ComposerPrimitive.Send className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground disabled:opacity-50 sm:h-9 sm:w-9">
                      <Send size={15} className="sm:size-4" />
                    </ComposerPrimitive.Send>
                  )}
                </div>
              </ComposerPrimitive.Root>
              <div className="composer-hint mx-auto flex w-full max-w-4xl justify-between gap-3 px-1 pt-1.5">
                <span>
                  keating won&apos;t give you the answer —{" "}
                  <span className="ok">that&apos;s the point</span>
                </span>
                <span className="hidden sm:inline">
                  enter to send // shift+enter for newline
                </span>
              </div>
            </ThreadPrimitive.ViewportFooter>
          </ThreadPrimitive.Viewport>
        </ThreadPrimitive.Root>
      </AssistantRuntimeProvider>
      </QuizGradesContext.Provider>
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
    <MessagePrimitive.Root className="mx-auto mb-4 flex w-full max-w-4xl justify-end">
      <div className="flex max-w-[88%] flex-row-reverse gap-3 px-1 text-sm text-foreground sm:max-w-[82%]">
        <div className="chat-avatar chat-avatar-you mt-0.5">
          {profileImage ? (
            <img src={profileImage} alt="You" />
          ) : (
            <User className="h-4 w-4 shrink-0" />
          )}
        </div>
        <div className="flex min-w-0 flex-col items-end">
          <div className="msg-meta">
            <b>YOU</b>
          </div>
          <div className="you-bubble whitespace-pre-wrap leading-6 font-ui">
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
  onFork?: (forkPoint?: number) => void | Promise<void>;
}) {
  const [feedback, setFeedback] = useState<"up" | "down" | null>(null);
  const [feedbackModalOpen, setFeedbackModalOpen] = useState(false);
  const [feedbackType, setFeedbackType] = useState<"up" | "down">("up");
  const onAuthError = useContext(AuthErrorContext);
  const authError = useMessage(
    (message) =>
      message.metadata.custom?.keatingAuthError as AuthErrorEntry | undefined,
  );
  // The message id is `assistant-${index}-${timestamp}` (see toAssistantMessage).
  // The trailing timestamp is the stable handle we use to fork at this turn.
  const messageId = useMessage((message) => message.id);
  const messageText = useMessage((message) =>
    (message.content as Array<{ type: string; text?: string }>)
      .filter((part) => part.type === "text")
      .map((part) => part.text ?? "")
      .join("\n\n"),
  );
  const copyText = stripQuizTags(
    stripGeneratedImageTags(stripQuestionTags(stripGoalTags(stripArtifactLinks(messageText)))),
  ).trim();
  const handleFork = () => {
    const ts = Number(messageId.slice(messageId.lastIndexOf("-") + 1));
    onFork?.(Number.isFinite(ts) ? ts : undefined);
  };
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
          detail: { type, comment, messageId },
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
      <MessagePrimitive.Root className="group mx-auto mb-4 flex w-full max-w-4xl justify-start">
        <div className="flex w-full gap-3 px-1 text-sm text-foreground">
          <div className="chat-avatar mt-0.5">
            <img src="/brand/mascot-head.png" alt="Keating" />
          </div>
          <div className="min-w-0 flex-1 leading-6">
            <div className="msg-meta">
              <b>KEATING</b>
            </div>
            <div className="keating-bubble text-foreground">
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
                      onClick={(event) => handleTutorialLinkClick(event.nativeEvent, tutorialApiKeyHref(authError.provider))}
                      className="ml-2 inline-flex items-center text-xs text-primary underline underline-offset-2"
                    >
                      Need a key?
                    </a>
                  </div>
                </div>
              </div>
            )}
            </div>
            <div className="mt-2 flex items-center gap-1">
              {copyText && <CopyButton variant="ghost" text={copyText} label="Copy message" />}
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
                  title="Fork session from here"
                  onClick={handleFork}
                  aria-label="Fork session from here"
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

// Test-only export for parser regressions around malformed reasoning tags from
// OpenAI-compatible providers.
export const __test_assistantTextParts = assistantTextParts;

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
