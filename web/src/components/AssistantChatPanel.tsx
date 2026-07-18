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
import type { Api, Model } from "@earendil-works/pi-ai/compat";
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
import { css, cx } from "../../styled-system/css";
import {
  ChevronRight,
  CircleAlert,
  CircleCheck,
  CircleDollarSign,
  Check,
  Copy,
  CopyPlus,
  KeyRound,
	Keyboard,
  LibraryBig,
  Lightbulb,
  Loader2,
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
import { usePostHog } from "@posthog/react";
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
import { Spinner } from "./Spinner";
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
	getLiveSpeechBridge,
  KEATING_VOICE_TOOL_NAME,
  loadWebSpeechSettings,
  resolveSpeechCredential,
  speechInputMode,
  type LiveSpeechSession,
  type LiveSpeechState,
} from "../keating/speech";
import { startMicRecording, transcribeAudio, type MicRecorder } from "../keating/speech-providers/stt";
import { JsonCrackBlock } from "./JsonCrackBlock";
import { RetryResponseButton } from "./RetryResponseButton";
import { FlashcardRenderer } from "./FlashcardRenderer";
import type { FlashcardDeck } from "../keating/srs";
import { MermaidRenderer } from "./MermaidRenderer";
import {
  pickDiverseStarterPrompts,
  STARTER_PROMPTS,
  type StarterPrompt,
} from "../keating/starter-prompts";
import { getTailoredOpening } from "../keating/tailored-opening";
import {
  parseOpenUIMessageSegments,
  stripOpenUIPrograms,
} from "../keating/openui/segments";
import {
  KeatingOpenUIActionProvider,
  KeatingOpenUIRenderer,
} from "../keating/openui/renderer";
import type { KeatingOpenUIAction } from "../keating/openui/types";
import {
  createOpenUIActionLearnerResponse,
  createQuestionLearnerResponse,
  parseLearnerResponse,
  serializeLearnerResponse,
} from "../keating/learner-response";
import { LearnerResponseReview } from "./LearnerResponseReview";
import {
  classifyLlmError,
  type LlmErrorDetails,
} from "../core/api-retry";
import type { ToolConfirmationRequestDetail } from "../keating/security";

const AuthErrorContext = createContext<(provider: string) => Promise<boolean>>(
  () => Promise.resolve(false),
);

const capturedApiErrorKeys = new Set<string>();
const MAX_CAPTURED_API_ERROR_KEYS = 256;

const mutedTextClass = css({ color: "var(--muted-foreground)" });
const foregroundTextClass = css({ color: "var(--foreground)" });
const destructiveTextClass = css({ color: "var(--destructive)" });
const primaryTextClass = css({ color: "var(--primary)" });
const pulseClass = css({ animation: "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite" });
const srInteractiveClass = css({
  transitionProperty: "color, background-color, border-color, opacity, box-shadow, transform",
  transitionDuration: "150ms",
});
const iconButtonClass = css({
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: "0.375rem",
  color: "var(--muted-foreground)",
  _hover: {
    backgroundColor: "var(--accent)",
    color: "var(--accent-foreground)",
  },
  _disabled: { opacity: 0.5 },
});
const composerIconButtonClass = cx(
  srInteractiveClass,
  css({
    display: "inline-flex",
    width: "2rem",
    height: "2rem",
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "0.375rem",
    border: "1px solid var(--border)",
    color: "var(--muted-foreground)",
    _hover: {
      backgroundColor: "var(--accent)",
      color: "var(--accent-foreground)",
    },
    _disabled: { opacity: 0.5 },
    sm: { width: "2.25rem", height: "2.25rem" },
  }),
);
const dialogButtonClass = cx(
  "dialog-compact-button",
  css({
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: "0.375rem",
    border: "1px solid var(--border)",
    paddingInline: "0.75rem",
    paddingBlock: "0.375rem",
    fontSize: "0.75rem",
    _hover: { backgroundColor: "var(--muted)" },
  }),
);
const messageActionButtonClass = cx(
  srInteractiveClass,
  iconButtonClass,
  css({ width: "1.5rem", height: "1.5rem" }),
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
    <p
      className={css({
        marginBlock: "0.25rem",
        fontSize: "0.75rem",
        fontStyle: "italic",
        color: "var(--muted-foreground)",
      })}
    >
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
  responseComparison?: ReactNode;
}

function ToolConfirmationDialog({ request, onDone }: {
  request: ToolConfirmationRequestDetail;
  onDone: () => void;
}) {
  const approveRef = useRef<HTMLButtonElement>(null);
  const finish = useCallback((approved: boolean) => {
    if (approved) request.approve();
    else request.cancel();
    onDone();
  }, [onDone, request]);

  useEffect(() => {
    approveRef.current?.focus();
    const remaining = Math.max(0, request.review.expiresAt - Date.now());
    const timeout = window.setTimeout(() => finish(false), remaining);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") finish(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [finish, request.review.expiresAt]);

  return (
    <div
      role="presentation"
      className={css({
        position: "fixed", inset: 0, zIndex: 100, display: "flex", alignItems: "center",
        justifyContent: "center", padding: "1rem", backgroundColor: "rgba(0, 0, 0, 0.55)",
      })}
      onMouseDown={(event) => { if (event.target === event.currentTarget) finish(false); }}
    >
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="keating-tool-confirmation-title"
        aria-describedby="keating-tool-confirmation-description"
        className={css({
          width: "100%", maxWidth: "28rem", borderRadius: "0.75rem", border: "1px solid var(--border)",
          backgroundColor: "var(--card)", padding: "1.25rem", boxShadow: "0 24px 80px rgba(0,0,0,.35)",
        })}
      >
        <div className={css({ display: "flex", alignItems: "flex-start", gap: "0.75rem" })}>
          <ShieldAlert aria-hidden="true" className={css({ marginTop: "0.125rem", flexShrink: 0, color: "var(--destructive)" })} />
          <div>
            <h2 id="keating-tool-confirmation-title" className={css({ fontSize: "1rem", fontWeight: 700 })}>
              Review tool action
            </h2>
            <p id="keating-tool-confirmation-description" className={css({ marginTop: "0.375rem", fontSize: "0.875rem", color: "var(--muted-foreground)" })}>
              Keating wants to run <strong className={foregroundTextClass}>{request.review.toolName}</strong>.
              This is classified as <strong className={foregroundTextClass}>{request.review.risk}</strong>.
              {request.review.surface === "voice" ? " This request came from voice and requires a separate visual confirmation." : ""}
            </p>
            <p className={css({ marginTop: "0.5rem", fontSize: "0.75rem", color: "var(--muted-foreground)" })}>
              Arguments and credentials are intentionally hidden. Cancel if you did not independently request this action.
            </p>
          </div>
        </div>
        <div className={css({ marginTop: "1rem", display: "flex", justifyContent: "flex-end", gap: "0.5rem" })}>
          <button type="button" className={dialogButtonClass} onClick={() => finish(false)}>Cancel</button>
          <button ref={approveRef} type="button" className={cx(dialogButtonClass, css({ backgroundColor: "var(--primary)", color: "var(--primary-foreground)" }))} onClick={() => finish(true)}>
            Confirm action
          </button>
        </div>
      </section>
    </div>
  );
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
  const posthog = usePostHog();
  const messageId = useMessage((message) => message.id);
  const isMarkedError = text.startsWith(ERROR_TEXT_PREFIX);
  const displayText = isMarkedError
    ? text.slice(ERROR_TEXT_PREFIX.length)
    : text;
  const [visibleText, setVisibleText] = useState(displayText);
  const visibleLengthRef = useRef(displayText.length);
  const previousTextRef = useRef(displayText);
  const capturedErrorRef = useRef<string | null>(null);

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

  useEffect(() => {
    if (!isMarkedError || status?.type === "running") return;
    const capturedKey = displayText.slice(0, 2048);
    if (capturedErrorRef.current === capturedKey || capturedApiErrorKeys.has(capturedKey)) return;
    capturedErrorRef.current = capturedKey;
    capturedApiErrorKeys.add(capturedKey);
    if (capturedApiErrorKeys.size > MAX_CAPTURED_API_ERROR_KEYS) {
      const oldest = capturedApiErrorKeys.values().next().value;
      if (oldest) capturedApiErrorKeys.delete(oldest);
    }
    const classified = classifyError(displayText);
    posthog.capture('api_error', { error_type: classified.category, status_code: classified.statusCode });
  }, [displayText, isMarkedError, posthog, status?.type]);

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

  const learnerResponse = parseLearnerResponse(visibleText);
  if (learnerResponse) {
    return <LearnerResponseReview response={learnerResponse} />;
  }

  return (
    <MarkdownText
      text={visibleText}
      documentScope={messageId}
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

const VOICE_ERROR_PATTERNS =
  /keating_voice|gemini live speech|voice layer|speech model|speech failed|speech timed out/i;

interface ClassifiedError extends LlmErrorDetails {
  icon: typeof CircleAlert;
}

function classifyError(errorText: string): ClassifiedError {
  const isVoiceError = VOICE_ERROR_PATTERNS.test(errorText);
  if (isVoiceError) {
    const underlying = classifyLlmError(errorText);
    return {
      ...underlying,
      title: underlying.category === "auth" ? "Voice sign-in failed" : "Voice model failed",
      description:
        "The optional speech layer failed. The main chat model may still be working.",
      recovery: underlying.category === "auth"
        ? "Update the speech provider credentials, or turn speech off and continue with text."
        : "Turn speech off and continue with text, or retry the voice connection.",
      icon: underlying.category === "auth" ? KeyRound : Wifi,
    };
  }

  const details = classifyLlmError(errorText);
  const icon = details.category === "auth"
    ? KeyRound
    : details.category === "billing"
      ? CircleDollarSign
      : details.category === "permission" || details.category === "safety"
        ? ShieldAlert
        : details.category === "server" || details.category === "model-unavailable"
          ? Server
          : details.category === "network" || details.category === "rate-limit" || details.category === "timeout"
            ? Wifi
            : details.category === "aborted"
              ? Square
              : CircleAlert;
  return { ...details, icon };
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
    <div className={css({ display: "grid", gap: "0.375rem" })}>
      <div className={css({ display: "flex", alignItems: "center", gap: "0.375rem", fontWeight: 500 })}>
        <ErrorIcon size={13} />
        <span>{classified.title}</span>
        {classified.statusCode && (
          <span
            className={css({
              borderRadius: "0.25rem",
              backgroundColor: "color-mix(in srgb, var(--background) 70%, transparent)",
              paddingInline: "0.375rem",
              paddingBlock: "0.125rem",
              fontFamily: "var(--mono-body)",
              fontSize: "10px",
            })}
          >
            {classified.statusCode}
          </span>
        )}
      </div>
      <p className={mutedTextClass}>{classified.description}</p>
      <p className={css({ fontSize: "0.75rem", color: "var(--foreground)" })}>
        <span className={css({ fontWeight: 600 })}>Recovery: </span>
        {classified.recovery}
      </p>
      {showRaw && (
        <details className={css({ marginTop: "0.5rem" })}>
          <summary
            className={css({
              display: "flex",
              cursor: "pointer",
              listStyle: "none",
              alignItems: "center",
              gap: "0.25rem",
              color: "var(--muted-foreground)",
              _hover: { color: "var(--foreground)" },
            })}
          >
            <ChevronRight size={13} />
            Raw details
          </summary>
          <pre
            className={css({
              marginTop: "0.5rem",
              maxHeight: "11rem",
              overflow: "auto",
              whiteSpace: "pre-wrap",
              fontSize: "11px",
              color: "var(--muted-foreground)",
            })}
          >
            {rawMessage}
          </pre>
        </details>
      )}
    </div>
  );
}

function ImagePart({ image, filename }: { image: string; filename?: string }) {
  return (
    <figure
      className={css({
        marginBlock: "0.5rem",
        overflow: "hidden",
        borderRadius: "0.375rem",
        border: "1px solid var(--border)",
        backgroundColor: "color-mix(in srgb, var(--background) 60%, transparent)",
      })}
    >
      <img
        src={image}
        alt={filename ?? "Attached image"}
        className={css({ maxHeight: "20rem", width: "100%", objectFit: "contain" })}
      />
      {filename ? (
        <figcaption
          className={css({
            borderTop: "1px solid var(--border)",
            paddingInline: "0.5rem",
            paddingBlock: "0.25rem",
            fontSize: "11px",
            color: "var(--muted-foreground)",
          })}
        >
          {filename}
        </figcaption>
      ) : null}
    </figure>
  );
}

// Voice is a real composer mode, not a small attachment action. Duplex models
// open the realtime surface; other providers use press-and-hold dictation and
// place the transcript back into the text composer for review.
function SpeechComposerControl({
	expanded,
	onExpandedChange,
}: {
	expanded: boolean;
	onExpandedChange: (expanded: boolean) => void;
}) {
  const composer = useComposerRuntime();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [liveOpen, setLiveOpen] = useState(false);
	const [forceStt, setForceStt] = useState(false);
  const recorderRef = useRef<MicRecorder | null>(null);
	const recordingPromiseRef = useRef<Promise<MicRecorder> | null>(null);

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

	useEffect(() => {
		if (available === false && expanded) onExpandedChange(false);
	}, [available, expanded, onExpandedChange]);

  const appendToComposer = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const existing = composer.getState().text;
    composer.setText(existing ? `${existing.trimEnd()} ${trimmed}` : trimmed);
  };

  const beginPushToTalk = () => {
		if (busy || recordingPromiseRef.current) return;
		setRecording(true);
		const pending = startMicRecording();
		recordingPromiseRef.current = pending;
		void pending.then((recorder) => {
			recorderRef.current = recorder;
		}).catch((error) => {
			recordingPromiseRef.current = null;
			setRecording(false);
			console.warn("[keating:stt] microphone unavailable", error);
		});
	};

	const finishPushToTalk = async () => {
		const pending = recordingPromiseRef.current;
		if (!pending) return;
		setRecording(false);
		setBusy(true);
		try {
			const recorder = recorderRef.current ?? await pending;
			const blob = await recorder.stop();
			const cred = await resolveSpeechCredential(getProviderApiKey);
			if (!cred) throw new Error("No speech credential available.");
			const text = await transcribeAudio(blob, { provider: cred.provider, apiKey: cred.apiKey });
			appendToComposer(text);
			onExpandedChange(false);
		} catch (error) {
			console.warn("[keating:stt] transcription failed", error);
		} finally {
			recorderRef.current = null;
			recordingPromiseRef.current = null;
			setBusy(false);
		}
	};

  if (!available) return null;

	const mode = forceStt ? "stt" : speechInputMode(loadWebSpeechSettings());
  if (!expanded) {
		return (
			<button
				type="button"
				onClick={() => onExpandedChange(true)}
				title="Switch to voice"
				aria-label="Switch to voice"
				className={cx(composerIconButtonClass, css({ _hover: { backgroundColor: "var(--muted)", color: "var(--foreground)" } }))}
			>
				<Mic size={16} />
			</button>
		);
	}

  return (
    <>
			<div className={css({ display: "flex", minWidth: 0, flex: 1, alignItems: "center", gap: "0.375rem" })}>
				<button
					type="button"
					disabled={busy}
					onClick={mode === "duplex" ? () => setLiveOpen(true) : undefined}
					onPointerDown={mode === "stt" ? (event) => {
						event.currentTarget.setPointerCapture(event.pointerId);
						beginPushToTalk();
					} : undefined}
					onPointerUp={mode === "stt" ? () => void finishPushToTalk() : undefined}
					onPointerCancel={mode === "stt" ? () => void finishPushToTalk() : undefined}
					onKeyDown={mode === "stt" ? (event) => {
						if ((event.key === " " || event.key === "Enter") && !event.repeat) {
							event.preventDefault();
							beginPushToTalk();
						}
					} : undefined}
					onKeyUp={mode === "stt" ? (event) => {
						if (event.key === " " || event.key === "Enter") {
							event.preventDefault();
							void finishPushToTalk();
						}
					} : undefined}
					aria-label={mode === "duplex" ? "Start live voice conversation" : "Hold to speak"}
					aria-pressed={recording}
					className={cx(
						css({
							display: "inline-flex",
							minWidth: 0,
							minHeight: "2.25rem",
							flex: 1,
							alignItems: "center",
							justifyContent: "center",
							gap: "0.5rem",
							borderRadius: "0.375rem",
							backgroundColor: "var(--primary)",
							paddingInline: "0.75rem",
							fontSize: "0.8125rem",
							fontWeight: 650,
							color: "var(--primary-foreground)",
							touchAction: "none",
							userSelect: "none",
							_hover: { backgroundColor: "color-mix(in srgb, var(--primary) 88%, black)" },
							_disabled: { opacity: 0.65 },
						}),
						recording ? pulseClass : "",
					)}
				>
					{busy ? <Spinner size={16} /> : recording ? <MicOff size={16} /> : <Mic size={16} />}
					<span>{busy ? "Transcribing" : recording ? "Release to transcribe" : mode === "duplex" ? "Talk with Keating" : "Hold to speak"}</span>
				</button>
				<button type="button" onClick={() => onExpandedChange(false)} aria-label="Switch to keyboard" title="Switch to keyboard" className={composerIconButtonClass}>
					<Keyboard size={16} />
				</button>
			</div>
      {liveOpen ? (
        <LiveVoiceOverlay
          onClose={() => setLiveOpen(false)}
          onTranscript={appendToComposer}
          onFallback={() => {
            setLiveOpen(false);
							setForceStt(true);
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
		const bridge = getLiveSpeechBridge();
		const conversationDetail: { ids?: { sessionId: string } } = {};
		window.dispatchEvent(new CustomEvent("keating:conversation-ids", { detail: conversationDetail }));
        const session = await provider.startLiveSession({
          settings,
          getApiKey: getProviderApiKey,
          signal: abort.signal,
		  instructions: "You are Keating, a warm collaborative teacher. Use tools whenever they improve the lesson, especially for current facts, quizzes, goals, and visual learning artifacts. Keep spoken turns concise and invite interruption.",
		  tools: bridge?.tools,
		  onToolCall: bridge ? (call) => bridge.execute(call, abort.signal) : undefined,
		  onConversationEvent: (event) => window.dispatchEvent(new CustomEvent("keating:conversation-event", { detail: event })),
		  conversationIds: conversationDetail.ids,
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
      className={css({
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "flex",
				alignItems: "stretch",
        justifyContent: "center",
        backgroundColor: "color-mix(in srgb, var(--background) 80%, transparent)",
				padding: 0,
        backdropFilter: "blur(4px)",
				sm: { alignItems: "center", padding: "1rem" },
      })}
      role="dialog"
      aria-modal="true"
      aria-label="Live voice conversation"
    >
      <div
        className={css({
          width: "100%",
					height: "100dvh",
          maxWidth: "28rem",
					display: "flex",
					flexDirection: "column",
          backgroundColor: "var(--card)",
					padding: "1rem",
					sm: { height: "auto", maxHeight: "min(80dvh, 42rem)", borderRadius: "0.75rem", border: "1px solid var(--border)", padding: "1.25rem" },
        })}
      >
        <div className={css({ display: "flex", alignItems: "center", gap: "0.75rem" })}>
						<span
            className={cx(
              css({
								position: "relative",
                display: "inline-flex",
								width: "3.5rem",
								height: "3.5rem",
                alignItems: "center",
                justifyContent: "center",
								borderRadius: "0.75rem",
                border: "1px solid",
								backgroundColor: "var(--background)",
              }),
              error
                ? css({ borderColor: "var(--destructive)", color: "var(--destructive)" })
                : state === "speaking"
                  ? css({ borderColor: "var(--primary)", color: "var(--primary)" })
                  : css({ borderColor: "var(--border)", color: "var(--foreground)" }),
              state === "listening" && !error ? pulseClass : "",
            )}
          >
							<img src="/brand/mascot-head.png" alt="" className={css({ width: "2.5rem", height: "auto" })} />
							<span className={css({ position: "absolute", right: "-0.25rem", bottom: "-0.25rem", display: "inline-flex", height: "1.5rem", width: "1.5rem", alignItems: "center", justifyContent: "center", borderRadius: "9999px", border: "1px solid var(--border)", backgroundColor: "var(--background)" })}>
								{error ? <MicOff size={13} /> : state === "connecting" ? <Spinner size={13} /> : <Mic size={13} />}
							</span>
          </span>
          <div className={css({ minWidth: 0, flex: 1 })}>
            <div className={css({ fontSize: "0.875rem", fontWeight: 500 })}>{error ? "Voice session error" : LIVE_STATE_LABEL[state]}</div>
            <div
              className={css({
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontSize: "0.75rem",
                color: "var(--muted-foreground)",
              })}
            >
              Live voice with Keating
            </div>
          </div>
          <button
            type="button"
            onClick={finish}
            className={cx(
              composerIconButtonClass,
              css({
                _hover: { backgroundColor: "var(--muted)", color: "var(--foreground)" },
                sm: { width: "2rem", height: "2rem" },
              }),
            )}
            aria-label="Close live voice"
            title="Close"
          >
            <X size={16} />
          </button>
        </div>

        {error ? (
						<div className={css({ marginTop: "1rem", display: "flex", minHeight: 0, flex: 1, flexDirection: "column", gap: "0.75rem" })}>
            <p className={css({ fontSize: "0.75rem", color: "var(--destructive)" })}>{error}</p>
            <div className={css({ display: "flex", gap: "0.5rem" })}>
              <button
                type="button"
                onClick={onFallback}
                className={cx(dialogButtonClass, css({ gap: "0.375rem" }))}
              >
                <Mic size={14} /> Use dictation instead
              </button>
              <button
                type="button"
                onClick={finish}
                className={dialogButtonClass}
              >
                Close
              </button>
            </div>
          </div>
        ) : (
						<div className={css({ marginTop: "1rem", display: "flex", minHeight: 0, flex: 1, flexDirection: "column", gap: "0.75rem" })}>
							<div
              className={css({
                display: "grid",
								minHeight: "12rem",
								maxHeight: "none",
								flex: 1,
                gap: "0.5rem",
                overflowY: "auto",
                fontSize: "0.875rem",
								alignContent: "start",
								sm: { minHeight: "8rem", maxHeight: "18rem" },
              })}
            >
              {assistantText ? (
                <p
                  className={css({
                    borderRadius: "0.375rem",
                    backgroundColor: "color-mix(in srgb, var(--muted) 50%, transparent)",
                    paddingInline: "0.75rem",
                    paddingBlock: "0.5rem",
                    color: "var(--foreground)",
                  })}
                >
                  {assistantText}
                </p>
              ) : null}
              {userText ? (
                <p className={css({ textAlign: "right", color: "var(--muted-foreground)" })}>{userText}</p>
              ) : null}
              {!assistantText && !userText ? (
								<p className={css({ fontSize: "0.75rem", color: "var(--muted-foreground)" })}>Start speaking. Keating is listening.</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={finish}
              className={cx(
                "dialog-compact-button",
                css({
                  display: "inline-flex",
                  width: "100%",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "0.375rem",
                  borderRadius: "0.375rem",
                  border: "1px solid var(--destructive)",
                  backgroundColor: "color-mix(in srgb, var(--destructive) 10%, transparent)",
                  paddingInline: "0.75rem",
                  paddingBlock: "0.5rem",
                  fontSize: "0.875rem",
                  color: "var(--destructive)",
                  _hover: {
                    backgroundColor: "color-mix(in srgb, var(--destructive) 20%, transparent)",
                  },
                }),
              )}
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
    <div
      className={css({
        marginBlock: "0.5rem",
        display: "inline-flex",
        maxWidth: "100%",
        alignItems: "center",
        gap: "0.5rem",
        borderRadius: "0.375rem",
        border: "1px solid var(--border)",
        backgroundColor: "color-mix(in srgb, var(--background) 60%, transparent)",
        paddingInline: "0.5rem",
        paddingBlock: "0.25rem",
        fontSize: "0.75rem",
      })}
    >
      <Paperclip size={13} className={css({ flexShrink: 0, color: "var(--muted-foreground)" })} />
      <span className={css({ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" })}>{filename ?? "attachment"}</span>
      {mimeType ? (
        <span className={css({ flexShrink: 0, color: "var(--muted-foreground)" })}>{mimeType}</span>
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
    <div
      className={css({
        display: "inline-flex",
        maxWidth: "12rem",
        alignItems: "center",
        gap: "0.375rem",
        borderRadius: "0.375rem",
        border: "1px solid var(--border)",
        backgroundColor: "color-mix(in srgb, var(--muted) 40%, transparent)",
        paddingInline: "0.5rem",
        paddingBlock: "0.25rem",
        fontSize: "0.75rem",
        color: "var(--foreground)",
      })}
    >
      <Paperclip size={12} className={css({ flexShrink: 0, color: "var(--muted-foreground)" })} />
      <span className={css({ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" })}>{attachment.name}</span>
      {isImage ? (
        <span className={css({ flexShrink: 0, color: "var(--muted-foreground)" })}>image</span>
      ) : null}
      <AttachmentPrimitive.Remove
        className={cx(
          iconButtonClass,
          css({
            marginLeft: "0.125rem",
            width: "1.25rem",
            height: "1.25rem",
            flexShrink: 0,
          }),
        )}
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
  if (VOICE_ERROR_PATTERNS.test(errorText)) return null;
  if (classifyLlmError(errorText).category !== "auth") return null;
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
    <div className={css({ marginBottom: "0.75rem", display: "flex", flexWrap: "wrap", gap: "0.5rem" })}>
      {matches.map((m, i) => {
        const type = m[1];
        const id = m[2];
        const label = type.replace(/-/g, " ");
        return (
          <button
            key={i}
            className={cx(
              srInteractiveClass,
              css({
                display: "inline-flex",
                alignItems: "center",
                gap: "0.25rem",
                borderRadius: "0.375rem",
                border: "1px solid color-mix(in srgb, var(--primary) 40%, transparent)",
                backgroundColor: "color-mix(in srgb, var(--primary) 10%, transparent)",
                paddingInline: "0.5rem",
                paddingBlock: "0.25rem",
                fontSize: "0.75rem",
                fontWeight: 500,
                color: "var(--primary)",
                _hover: {
                  backgroundColor: "color-mix(in srgb, var(--primary) 20%, transparent)",
                },
              }),
            )}
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
            <span className={css({ textTransform: "capitalize" })}>{label}</span>
          </button>
        );
      })}
    </div>
  );
}

// Tag payloads are JSON string literals (double-stringified by the emitting
// tools) and may contain literal ">" characters — e.g. HTML/JS source in an
// animation body — so match a complete quoted string first and only fall back
// to the legacy "anything up to >" form for old unquoted payloads.
const TAG_PAYLOAD = String.raw`("(?:[^"\\]|\\.)*"|[^>]+)`;
const quizTagPattern = new RegExp(String.raw`<keating-quiz\s+json=${TAG_PAYLOAD}\s*\/>`, "g");
const sceneTagPattern = new RegExp(String.raw`<keating-scene\s+markdown=${TAG_PAYLOAD}\s*\/>`, "g");
const questionTagPattern = new RegExp(String.raw`<keating-question\s+json=${TAG_PAYLOAD}\s*\/>`, "g");
const goalTagPattern = new RegExp(String.raw`<keating-goal\s+json=${TAG_PAYLOAD}\s*\/>`, "g");
const generatedImageTagPattern = new RegExp(String.raw`<keating-image\s+json=${TAG_PAYLOAD}\s*\/>`, "g");
const quizResultTagPattern = new RegExp(String.raw`<keating-quiz-result\s+json=${TAG_PAYLOAD}\s*\/>`, "g");
const interactiveTagPattern = new RegExp(
  String.raw`<keating-(quiz|scene|question|goal|image|quiz-result|quiz-grade|animation|deck)\s+(json|markdown)=${TAG_PAYLOAD}\s*\/>`,
  "g",
);
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
              new CustomEvent("keating:question-answered", { detail: { answers, topic: form.topic } }),
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
      ? css({ width: "1.5rem", height: "1.5rem", borderRadius: "0.25rem" })
      : css({
          width: "1.75rem",
          height: "1.75rem",
          borderRadius: "0.375rem",
          border: "1px solid var(--border)",
          backgroundColor: "color-mix(in srgb, var(--background) 85%, transparent)",
        });

  return (
    <button
      type="button"
      onClick={copy}
      data-copy-on-hover
      className={cx(srInteractiveClass, iconButtonClass, base, className)}
      aria-label={copied ? "Copied" : label}
      title={copied ? "Copied" : label}
    >
      {copied ? <Check size={13} className={css({ color: "rgb(34 197 94)" })} /> : <Copy size={13} />}
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
    <figure
      className={css({
        marginBlock: "0.75rem",
        overflow: "hidden",
        borderRadius: "0.5rem",
        border: "1px solid var(--border)",
        backgroundColor: "var(--background)",
      })}
    >
      <div
        className={css({
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.5rem",
          borderBottom: "1px solid var(--border)",
          paddingInline: "0.75rem",
          paddingBlock: "0.5rem",
        })}
      >
        <div className={css({ minWidth: 0 })}>
          <figcaption
            className={css({
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontSize: "0.75rem",
              fontWeight: 500,
              color: "var(--foreground)",
            })}
          >
            {data.title ?? "Generated learning image"}
          </figcaption>
          {data.model && (
            <div
              className={cx(
                "font-terminal",
                css({
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontSize: "10px",
                  color: "var(--muted-foreground)",
                }),
              )}
            >
              {data.model}
            </div>
          )}
        </div>
        <CopyButton text={copyText} label={data.svg ? "Copy SVG" : "Copy image"} />
      </div>
      <img
        src={src}
        alt={data.alt ?? data.title ?? "Generated learning image"}
        className={css({ width: "100%", backgroundColor: "white" })}
      />
    </figure>
  );
}

// Static renderer map for chat markdown. Hoisted to module scope so it is
// created once instead of rebuilt for every segment on every streaming token.
const MARKDOWN_COMPONENTS: Components = {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              pre: ({ children }: any) => {
                const code = Array.isArray(children) ? children[0] : children;
                const props = code?.props as { className?: string; children?: string } | undefined;
                const lang = /language-(\w+)/.exec(props?.className ?? "")?.[1]?.toLowerCase();
                const raw = typeof props?.children === "string" ? props.children : copyTextFromReactNode(children);
                if (lang === "mermaid") {
                  return (
                    <div
                      className={css({
                        marginBlock: "0.5rem",
                        overflow: "auto",
                        borderRadius: "0.5rem",
                        border: "1px solid var(--border)",
                        backgroundColor: "color-mix(in srgb, var(--muted) 30%, transparent)",
                        padding: "1rem",
                        _hover: {
                          "& [data-copy-on-hover]": { opacity: 1 },
                        },
                      })}
                    >
                      <MermaidRenderer content={raw} />
                      <div className={css({ marginTop: "0.25rem", display: "flex", justifyContent: "flex-end" })}>
                        <CopyButton
                          text={raw.replace(/\n$/, "")}
                          label="Copy diagram"
                          className={css({
                            opacity: 0,
                            _focus: { opacity: 1 },
                          })}
                        />
                      </div>
                    </div>
                  );
                }
                return (
                  <div
                    className={css({
                      marginBlock: "0.5rem",
                      _hover: { "& [data-copy-on-hover]": { opacity: 1 } },
                    })}
                  >
                    <pre
                      className={css({
                        overflowX: "auto",
                        borderRadius: "0.375rem",
                        backgroundColor: "var(--muted)",
                        padding: "0.75rem",
                        fontSize: "0.75rem",
                      })}
                    >
                      {children}
                    </pre>
                    <div className={css({ marginTop: "0.25rem", display: "flex", justifyContent: "flex-end" })}>
                      <CopyButton
                        text={raw.replace(/\n$/, "")}
                        label="Copy code"
                        className={css({
                          opacity: 0,
                          _focus: { opacity: 1 },
                        })}
                      />
                    </div>
                  </div>
                );
              },
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              code: ({ className, children, ...props }: any) => {
                const isInline = !className?.includes("language-");
                if (isInline) {
                  return (
                    <code
                      className={css({
                        borderRadius: "0.25rem",
                        backgroundColor: "var(--muted)",
                        paddingInline: "0.375rem",
                        paddingBlock: "0.125rem",
                        fontFamily: "var(--mono-body)",
                        fontSize: "0.875rem",
                      })}
                      {...props}
                    >
                      {children}
                    </code>
                  );
                }
                return (
                  <code className={css({ fontFamily: "var(--mono-body)", fontSize: "0.875rem" })} {...props}>
                    {children}
                  </code>
                );
              },
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              p: ({ children }: any) => (
                <p className={css({ marginBottom: "0.75rem", _last: { marginBottom: 0 } })}>{children}</p>
              ),
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              ul: ({ children }: any) => (
                <ul className={css({ marginBottom: "0.75rem", listStyleType: "disc", paddingLeft: "1.25rem" })}>{children}</ul>
              ),
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              ol: ({ children }: any) => (
                <ol className={css({ marginBottom: "0.75rem", listStyleType: "decimal", paddingLeft: "1.25rem" })}>{children}</ol>
              ),
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              li: ({ children }: any) => <li className={css({ marginBottom: "0.25rem" })}>{children}</li>,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              h1: ({ children }: any) => (
                <h1 className={css({ marginTop: "1rem", marginBottom: "0.5rem", fontSize: "1.125rem", fontWeight: 600 })}>{children}</h1>
              ),
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              h2: ({ children }: any) => (
                <h2 className={css({ marginTop: "0.75rem", marginBottom: "0.5rem", fontSize: "1rem", fontWeight: 600 })}>
                  {children}
                </h2>
              ),
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              h3: ({ children }: any) => (
                <h3 className={css({ marginTop: "0.5rem", marginBottom: "0.25rem", fontSize: "0.875rem", fontWeight: 600 })}>{children}</h3>
              ),
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              strong: ({ children }: any) => (
                <strong className={css({ fontWeight: 600 })}>{children}</strong>
              ),
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              em: ({ children }: any) => <em className={css({ fontStyle: "italic" })}>{children}</em>,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              a: ({ children, href }: any) => (
                <a
                  href={href}
                  className={css({ color: "var(--primary)", textDecoration: "underline" })}
                  target="_blank"
                  rel="noreferrer"
                >
                  {children}
                </a>
              ),
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              blockquote: ({ children }: any) => (
                <blockquote className={css({ marginBlock: "0.5rem", borderLeft: "2px solid var(--border)", paddingLeft: "0.75rem", color: "var(--muted-foreground)" })}>
                  {children}
                </blockquote>
              ),
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              table: ({ children }: any) => (
                <div className={css({ marginBlock: "0.75rem", maxWidth: "100%", overflowX: "auto" })}>
                  <table className={css({ width: "max-content", minWidth: "100%", borderCollapse: "collapse", fontSize: "0.875rem" })}>
                    {children}
                  </table>
                </div>
              ),
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              thead: ({ children }: any) => (
                <thead className={css({ borderBottom: "1px solid var(--border)", backgroundColor: "color-mix(in srgb, var(--muted) 50%, transparent)" })}>
                  {children}
                </thead>
              ),
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              th: ({ children }: any) => (
                <th className={css({ paddingInline: "0.75rem", paddingBlock: "0.5rem", textAlign: "left", fontWeight: 600 })}>
                  {children}
                </th>
              ),
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              td: ({ children }: any) => (
                <td className={css({ borderBottom: "1px solid var(--border)", paddingInline: "0.75rem", paddingBlock: "0.5rem" })}>{children}</td>
              ),
};

const MarkdownText = memo(function MarkdownText({
  text,
  documentScope,
  isRunning,
}: {
  text: string;
  documentScope: string;
  isRunning?: boolean;
}) {
  const displayText = stripArtifactLinks(text);
  // OpenUI is the streamable path. Text segments still flow through the legacy
  // tag parser so saved sessions and existing tools remain compatible.
  const segments = useMemo(
    () => parseOpenUIMessageSegments(displayText, documentScope),
    [displayText, documentScope],
  );
  return (
    <div
      className={css({
        overflowWrap: "break-word",
        fontSize: "0.6875rem",
        lineHeight: "1.125rem",
        sm: { fontSize: "0.875rem", lineHeight: "1.5rem" },
      })}
    >
      <ArtifactChips text={text} />
      {segments.map((seg, i) => {
        if (seg.type === "openui") {
          return (
            <KeatingOpenUIRenderer
              key={`${seg.metadata.id}-${i}`}
              program={seg.program}
              metadata={seg.metadata}
              isStreaming={Boolean(isRunning && !seg.complete)}
            />
          );
        }
        return parseInteractiveSegments(seg.content)
          .filter((legacy) => legacy.type !== "question" && legacy.type !== "quiz")
          .map((legacy, legacyIndex) => {
            const card = renderInteractiveSegment(legacy, `${i}-${legacyIndex}`);
            if (card !== null) return card;
            return (
              <ReactMarkdown
                key={`${i}-${legacyIndex}`}
                remarkPlugins={[remarkGfm, remarkMath]}
                rehypePlugins={[rehypeKatex]}
                components={MARKDOWN_COMPONENTS}
              >
                {legacy.type === "text" ? legacy.content : ""}
              </ReactMarkdown>
            );
          });
      })}
      {isRunning ? <span className={cx(pulseClass, css({ marginLeft: "0.125rem" }))}>|</span> : null}
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
      className={css({
        marginBottom: "0.75rem",
        borderRadius: "0.375rem",
        border: "1px solid var(--border)",
        backgroundColor: "color-mix(in srgb, var(--muted) 40%, transparent)",
        paddingInline: "0.75rem",
        paddingBlock: "0.5rem",
        fontSize: "0.75rem",
        color: "var(--muted-foreground)",
      })}
    >
      <summary
        className={css({
          display: "flex",
          cursor: "pointer",
          listStyle: "none",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "0.5rem",
          fontWeight: 500,
        })}
      >
        <span>Reasoning</span>
        <CopyButton text={text} label="Copy" />
      </summary>
      <div className={css({ marginTop: "0.5rem", whiteSpace: "pre-wrap" })}>{text}</div>
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
    return <div className={css({ width: "100%" })}>{interactiveCards}</div>;
  }

  const stateClass =
    state === "error"
      ? css({
					borderColor: "color-mix(in srgb, var(--destructive) 60%, transparent)",
          backgroundColor: "color-mix(in srgb, var(--destructive) 10%, transparent)",
          color: "var(--destructive)",
        })
      : state === "running"
        ? css({
							borderColor: "rgb(245 158 11 / 0.6)",
            backgroundColor: "rgb(34 197 94 / 0.1)",
            color: "rgb(217 119 6)",
            _dark: { color: "rgb(252 211 77)" },
          })
        : css({
							borderColor: "rgb(16 185 129 / 0.6)",
            backgroundColor: "rgb(16 185 129 / 0.1)",
            color: "rgb(4 120 87)",
            _dark: { color: "rgb(110 231 183)" },
          });
  const StateIcon =
    state === "error"
      ? CircleAlert
      : state === "running"
        ? Loader2
        : CircleCheck;
  const classifiedError = state === "error" ? classifyError(resultText) : null;
  return (
    <div
      className={cx(
        stateClass,
        css({
          marginBlock: "0.5rem",
          width: "100%",
          borderRadius: "0.375rem",
						borderWidth: "1px",
          paddingInline: "0.75rem",
          paddingBlock: "0.5rem",
          fontSize: "0.75rem",
        }),
      )}
    >
      <div className={css({ display: "flex", minWidth: 0, flexWrap: "wrap", alignItems: "center", gap: "0.5rem" })}>
        {state === "running" ? <Spinner size={14} /> : <StateIcon size={14} />}
        <Wrench size={13} />
        <span className={css({ fontWeight: 500 })}>Tool</span>
        <span
          className={css({
            maxWidth: "100%",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            borderRadius: "0.25rem",
            backgroundColor: "color-mix(in srgb, var(--background) 70%, transparent)",
            paddingInline: "0.375rem",
            paddingBlock: "0.125rem",
            fontFamily: "var(--mono-body)",
            color: "var(--foreground)",
          })}
        >
          {toolName}
        </span>
        <span className={css({ marginLeft: "auto", flexShrink: 0, textTransform: "uppercase", letterSpacing: "0.025em" })}>
          {state}
        </span>
      </div>
      {showDetails &&
      args !== undefined &&
      Object.keys(args as Record<string, unknown>).length > 0 ? (
				<details open className={css({ marginTop: "0.5rem", color: "color-mix(in srgb, var(--foreground) 80%, transparent)" })}>
          <summary
            className={css({
              display: "flex",
              cursor: "pointer",
              listStyle: "none",
              alignItems: "center",
              justifyContent: "space-between",
              gap: "0.5rem",
            })}
          >
            <span className={css({ display: "inline-flex", alignItems: "center", gap: "0.25rem" })}>
              <ChevronRight size={13} />
              Arguments
            </span>
            <CopyButton text={JSON.stringify(args, null, 2)} label="Copy" />
          </summary>
          <JsonCrackBlock value={args} maxHeight="16rem" title="Arguments" />
        </details>
      ) : null}
      {state === "error" && classifiedError ? (
        <div className={css({ marginTop: "0.5rem" })}>
          <ErrorBadge
            classified={classifiedError}
            rawMessage={resultText}
            showRaw={!!showRawErrors}
          />
        </div>
      ) : showDetails && resultText ? (
        <div className={css({ marginTop: "0.5rem", color: "var(--foreground)" })}>
          {typeof result === "object" && result !== null ? (
            <JsonCrackBlock value={result} maxHeight="16rem" title="Result" />
          ) : (
            <>
              <div className={css({ marginBottom: "0.25rem", display: "flex", justifyContent: "flex-end" })}>
                <CopyButton text={resultText} label="Copy output" />
              </div>
              <pre
                className={css({
                  maxHeight: "11rem",
                  overflow: "auto",
                  whiteSpace: "pre-wrap",
                  fontFamily: "var(--mono-body)",
                  lineHeight: "1.25rem",
                })}
              >
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

    if (status.type === "incomplete" && status.reason === "cancelled" && !content.some((c: any) => c.type === "text" && c.text)) {
      content.unshift({
        type: "text" as const,
        text: msg.errorMessage ?? "Response interrupted before it finished.",
      });
    }

    const authError = authErrorFromAgentMessage(msg, fallbackProvider);
    const llmFailure = status.type === "incomplete"
      ? classifyLlmError(msg.errorMessage ?? (status.reason === "cancelled" ? "Request aborted" : "Assistant response failed"))
      : null;
    const retryAttempts = typeof msg.__keatingRetryAttempts === "number"
      ? Math.max(1, Math.round(msg.__keatingRetryAttempts))
      : 1;
    const retryable = isLastMessage
      && status.type === "incomplete"
      && llmFailure?.category !== "auth"
      && llmFailure?.category !== "billing"
      && llmFailure?.category !== "context-length"
      && llmFailure?.category !== "invalid-request"
      && llmFailure?.category !== "model-unavailable"
      && llmFailure?.category !== "permission"
      && llmFailure?.category !== "safety";
    return {
      id,
      role: "assistant",
      createdAt: timestamp,
      status,
      content,
			metadata: authError || llmFailure || retryable || msg.__keatingPrefillStatus === true
        ? {
            custom: {
              keatingAuthError: authError,
              keatingLlmFailure: llmFailure,
              keatingRetryAttempts: retryAttempts,
              keatingRetryExhausted: msg.__keatingRetryExhausted === true,
              keatingRetryable: retryable,
								keatingPrefillStatus: msg.__keatingPrefillStatus === true,
            },
          }
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
		__keatingPrefillStatus: true,
  } as unknown as AgentMessage;
}

export function SuggestedPrompts({
  onSelect,
  initialPrompts,
  model,
}: {
  onSelect: (text: string) => void;
  initialPrompts?: readonly StarterPrompt[];
  /** Currently selected chat model; enables the personalized opening. */
  model?: Model<Api> | null;
}) {
  const [prompts, setPrompts] = useState(() => (
    initialPrompts ? [...initialPrompts] : pickDiverseStarterPrompts(STARTER_PROMPTS, 3)
  ));
  const [greeting, setGreeting] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // With a usable model, replace the generic header with a greeting tailored
  // to the learner's history and surface model-suggested next steps. Without
  // one (or without history) the generic experience stays.
  useEffect(() => {
    if (!model) return;
    let cancelled = false;
    getTailoredOpening(model)
      .then((opening) => {
        if (cancelled || !opening) return;
        setGreeting(opening.greeting);
        if (opening.prompts.length > 0) {
          setPrompts((prev) => {
            const seen = new Set(prev.map((p) => p.text));
            return [...opening.prompts.filter((p) => !seen.has(p.text)), ...prev];
          });
        }
      })
      .catch((error) => {
        console.warn("Tailored opening unavailable:", error);
      });
    return () => {
      cancelled = true;
    };
  }, [model?.provider, model?.id]);

  const remaining = STARTER_PROMPTS.filter(
    (p) => !prompts.some((existing) => existing.text === p.text),
  );
  const exhausted = remaining.length === 0;

  const appendMore = (count = 3) => {
    if (remaining.length === 0) return false;
    setPrompts((prev) => [...prev, ...pickDiverseStarterPrompts(remaining, count)]);
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
    <div
      className={css({
        marginInline: "auto",
        display: "flex",
        height: "100%",
        width: "100%",
        minWidth: 0,
        maxWidth: "48rem",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "0.75rem",
        paddingInline: "0.25rem",
        sm: { paddingInline: "1rem" },
      })}
    >
      <div className={cx("font-terminal", css({ fontSize: "0.875rem", color: "var(--muted-foreground)" }))}>
        {greeting ?? "Start a conversation"}
      </div>
      <div className={css({ display: "flex", width: "100%", minWidth: 0, alignItems: "center", gap: "0.25rem" })}>
        <button
          type="button"
          onClick={() => scroll("left")}
          className={cx(
            iconButtonClass,
            srInteractiveClass,
            css({
              width: "2rem",
              height: "2rem",
              flexShrink: 0,
              borderRadius: "9999px",
              border: "1px solid var(--border)",
            }),
          )}
          aria-label="Scroll left"
        >
          <ChevronRight size={14} className={css({ transform: "rotate(180deg)" })} />
        </button>
        <div
          ref={scrollRef}
          className={css({
            display: "flex",
            minWidth: 0,
            flex: 1,
            gap: "0.5rem",
            overflowX: "auto",
            scrollBehavior: "smooth",
            scrollSnapType: "x mandatory",
            paddingBlock: "0.25rem",
            scrollbarWidth: "none",
          })}
          style={{ scrollbarWidth: "none" }}
        >
          {prompts.map((p) => (
            <button
              key={p.text}
              type="button"
              onClick={() => onSelect(p.text)}
              className={cx(
                srInteractiveClass,
                css({
                  width: "min(13rem, calc(100vw - 7rem))",
                  flexShrink: 0,
                  scrollSnapAlign: "start",
                  borderRadius: "0.5rem",
                  border: "1px solid var(--border)",
                  backgroundColor: "color-mix(in srgb, var(--muted) 30%, transparent)",
                  paddingInline: "0.75rem",
                  paddingBlock: "0.625rem",
                  textAlign: "left",
                  _hover: {
                    borderColor: "var(--primary)",
                    backgroundColor: "color-mix(in srgb, var(--primary) 10%, transparent)",
                    color: "var(--primary)",
                    boxShadow: "var(--shadow-card)",
                  },
                  _active: { transform: "scale(0.98)" },
                }),
              )}
            >
              <span
                className={css({
                  marginBottom: "0.25rem",
                  display: "block",
                  fontSize: "10px",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  color: "var(--muted-foreground)",
                })}
              >
                {p.label}
              </span>
              <span className={css({ display: "block", fontSize: "0.75rem", lineHeight: 1.375 })}>{p.text}</span>
            </button>
          ))}
          {!exhausted && (
            <button
              type="button"
              onClick={refresh}
              className={cx(
                srInteractiveClass,
                css({
                  display: "flex",
                  width: "5rem",
                  flexShrink: 0,
                  scrollSnapAlign: "start",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: "0.5rem",
                  border: "1px dashed var(--border)",
                  color: "var(--muted-foreground)",
                  _hover: {
                    borderColor: "var(--primary)",
                    backgroundColor: "color-mix(in srgb, var(--primary) 5%, transparent)",
                    color: "var(--primary)",
                  },
                }),
              )}
            >
              <span className={css({ fontSize: "0.75rem" })}>More</span>
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => scroll("right")}
          title={exhausted ? "No more suggestions" : "Scroll right"}
          className={cx(
            iconButtonClass,
            srInteractiveClass,
            css({
              width: "2rem",
              height: "2rem",
              flexShrink: 0,
              borderRadius: "9999px",
              border: "1px solid var(--border)",
            }),
          )}
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
    <div ref={ref} className={css({ position: "relative" })}>
      <button
        type="button"
        className={cx(
          srInteractiveClass,
          css({
            display: "none",
            height: "2.25rem",
            flexShrink: 0,
            alignItems: "center",
            gap: "0.25rem",
            borderRadius: "0.375rem",
            border: "1px solid var(--border)",
            paddingInline: "0.5rem",
            fontSize: "0.75rem",
            color: "var(--muted-foreground)",
            _hover: {
              backgroundColor: "var(--accent)",
              color: "var(--accent-foreground)",
            },
            _disabled: { opacity: 0.5 },
            sm: { display: "inline-flex" },
          }),
          level === "off"
            ? ""
            : css({
                borderColor: "color-mix(in srgb, var(--primary) 50%, transparent)",
                color: "var(--primary)",
              }),
        )}
        disabled={disabled}
        title={`Reasoning: ${current.label}`}
        onClick={() => setOpen((o) => !o)}
      >
        <Lightbulb size={12} />
        <span className={css({ fontWeight: 500 })}>{current.short}</span>
      </button>
      {open && (
        <div
          className={cx(
            "font-terminal",
            css({
              position: "absolute",
              right: 0,
              bottom: "100%",
              zIndex: 50,
              marginBottom: "0.25rem",
              width: "10rem",
              borderRadius: "0.375rem",
              border: "1px solid var(--border)",
              backgroundColor: "var(--background)",
              boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)",
            }),
          )}
        >
          <div className={css({ display: "flex", flexDirection: "column", padding: "0.25rem" })}>
            <div
              className={css({
                paddingInline: "0.5rem",
                paddingBlock: "0.25rem",
                fontSize: "10px",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
                color: "var(--muted-foreground)",
              })}
            >
              Reasoning
            </div>
            {REASONING_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                className={cx(
                  srInteractiveClass,
                  css({
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    borderRadius: "0.25rem",
                    paddingInline: "0.5rem",
                    paddingBlock: "0.375rem",
                    textAlign: "left",
                    fontSize: "0.75rem",
                  }),
                  opt.value === level
                    ? css({
                        backgroundColor: "color-mix(in srgb, var(--primary) 10%, transparent)",
                        color: "var(--primary)",
                        fontWeight: 500,
                      })
                    : css({
                        color: "var(--foreground)",
                        _hover: {
                          backgroundColor: "var(--accent)",
                          color: "var(--accent-foreground)",
                        },
                      }),
                )}
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
              >
                <span
                  className={css({
                    width: "0.5rem",
                    height: "0.5rem",
                    borderRadius: "9999px",
                  })}
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
    <div
      className={css({
        borderRadius: "0.375rem",
        border: "1px solid var(--border)",
        backgroundColor: "color-mix(in srgb, var(--muted) 30%, transparent)",
        paddingInline: "0.75rem",
        paddingBlock: "0.5rem",
        fontSize: "0.75rem",
        lineHeight: "1.25rem",
        color: "var(--muted-foreground)",
      })}
    >
      <span className={css({ fontWeight: 500, color: "var(--foreground)" })}>URL detected.</span>{" "}
      To let Keating read current web pages, use a Google Gemini model with Google web grounding enabled
      {needsKey ? " and add a Google API key" : ""}.
      {needsKey && (
        <>
          {" "}Get one from{" "}
          <a
            className={css({
              color: "var(--primary)",
              textDecoration: "underline",
              textUnderlineOffset: "2px",
            })}
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
  responseComparison,
}: {
  agent: Agent | null;
  callbacks: ChatPanelSetupCallbacks;
  version: number;
  speechEnabled: boolean;
  responseComparison?: ReactNode;
}) {
  const posthog = usePostHog();
  const [uiSettings, setUiSettings] = useState(() => loadKeatingUiSettings());
  const [localVersion, setLocalVersion] = useState(0);
  const [loadingStep, setLoadingStep] = useState(0);
  const [composerHasUrl, setComposerHasUrl] = useState(false);
	const [voiceComposerOpen, setVoiceComposerOpen] = useState(false);
  const [hasGoogleKey, setHasGoogleKey] = useState<boolean | null>(null);
  const isRunning = agent?.state.isStreaming ?? false;
  const currentThinkingLevel =
    agent?.state.thinkingLevel ??
    callbacks.thinkingLevel ??
    "medium";
  const [selectedThinkingLevel, setSelectedThinkingLevel] =
    useState<ThinkingLevel>(currentThinkingLevel);
  useEffect(() => {
    setSelectedThinkingLevel(currentThinkingLevel);
  }, [currentThinkingLevel]);
  const handleThinkingLevelChange = useCallback(
    (level: ThinkingLevel) => {
      setSelectedThinkingLevel(level);
      callbacks.onThinkingLevelChange?.(level);
    },
    [callbacks],
  );
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
        posthog.capture('message_send_failed', { error_type: 'prompt_error' });
        if (!hasUserTextMessage(agent.state.messages, text)) {
          agent.state.messages.push(makeUserTextMessage(text));
        }
        agent.state.messages.push(makePromptErrorMessage(agent, error));
        setLocalVersion((current) => current + 1);
        await callbacks.onLocalMessagesChanged?.();
      }
    },
    [agent, callbacks, posthog],
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
        posthog.capture('message_send_failed', { error_type: 'prompt_error' });
        const userText = textFromContent((userMessage as any).content);
        if (!userText || !hasUserTextMessage(agent.state.messages, userText)) {
          agent.state.messages.push(userMessage);
        }
        agent.state.messages.push(makePromptErrorMessage(agent, error));
        setLocalVersion((current) => current + 1);
        await callbacks.onLocalMessagesChanged?.();
      }
    },
    [agent, callbacks, posthog],
  );

  const onCancel = useCallback(async () => {
    posthog.capture('message_cancelled', {});
    agent?.abort();
  }, [agent, posthog]);

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

  const handleOpenUIAction = useCallback(
    (action: KeatingOpenUIAction) => {
      window.dispatchEvent(new CustomEvent("keating:openui-action", { detail: action }));
      const response = createOpenUIActionLearnerResponse(action);
      queueOrSend({
        role: "user",
        content: [{ type: "text", text: serializeLearnerResponse(response) }],
      } as unknown as AppendMessage);
    },
    [queueOrSend],
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
        | { answers?: AnsweredQuestion[]; topic?: string }
        | undefined;
      const answers = detail?.answers;
      if (!agent || !answers || answers.length === 0) return;
      const response = createQuestionLearnerResponse({
        answers,
        topic: detail?.topic,
        source: "legacy",
      });
      void onNew({
        role: "user",
        content: [{ type: "text", text: serializeLearnerResponse(response) }],
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
      posthog.capture('quiz_remediation_requested', { level: detail.level, topic: detail.topic ?? detail.slug });
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
      posthog.capture('quiz_reframe_requested', { question_id: detail.questionId, mode: detail.mode, topic: detail.topic });
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
      <AssistantMessage
        components={components}
        onFork={callbacks.onFork}
        onModelSelect={callbacks.onModelSelect}
        onRetry={callbacks.onRetry}
      />
    ),
    [components, callbacks.onFork, callbacks.onModelSelect, callbacks.onRetry],
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
      <KeatingOpenUIActionProvider onAction={handleOpenUIAction}>
      <AssistantRuntimeProvider runtime={runtime}>
        <ThreadPrimitive.Root
          className={css({
            display: "flex",
            height: "100%",
            minHeight: 0,
            flexDirection: "column",
            backgroundColor: "var(--background)",
            color: "var(--foreground)",
          })}
        >
          <ThreadPrimitive.Viewport
            className={css({
              display: "flex",
              minHeight: 0,
              flex: 1,
              flexDirection: "column",
              overflowY: "auto",
              overflowX: "hidden",
							paddingInline: "0.75rem",
              paddingBlock: "1rem",
              sm: { paddingInline: "1rem", paddingBlock: "1.5rem" },
            })}
          >
            <div className={css({ display: "flex", flex: 1, flexDirection: "column" })}>
              <AuiIf condition={(state) => state.thread.isEmpty}>
                <SuggestedPrompts model={agent?.state.model ?? null} onSelect={(text) => {
                  posthog.capture('suggested_prompt_clicked', { prompt_text: text.slice(0, 80) });
                  sendText(text);
                }} />
              </AuiIf>
              <ThreadPrimitive.Messages components={threadComponents} />
            </div>
            <ThreadPrimitive.ViewportFooter
              className={css({
                position: "sticky",
                bottom: 0,
                minWidth: 0,
                backgroundColor: "color-mix(in srgb, var(--background) 95%, transparent)",
                paddingTop: "0.75rem",
                backdropFilter: "blur(8px)",
              })}
            >
              {responseComparison}
              {activeQuiz && (
                <div
                  className={css({
                    marginInline: "auto",
                    marginBottom: "0.375rem",
                    width: "100%",
                    maxWidth: "56rem",
                    overflowX: "hidden",
                    paddingInline: "0.375rem",
                    sm: { marginBottom: "0.5rem", paddingInline: 0 },
                  })}
                >
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
                <div
                  className={css({
                    marginInline: "auto",
                    marginBottom: "0.375rem",
                    width: "100%",
                    maxWidth: "56rem",
                    overflowX: "hidden",
                    paddingInline: "0.375rem",
                    sm: { marginBottom: "0.5rem", paddingInline: 0 },
                  })}
                >
                  <QuestionRenderer
                    data={activeQuestion}
                    onSubmit={(answers) => {
                      window.dispatchEvent(
                        new CustomEvent("keating:question-answered", {
                          detail: { answers, topic: activeQuestion.topic },
                        }),
                      );
                    }}
                  />
                </div>
              )}
              <ComposerPrimitive.Root
                className={cx(
                  "composer-root",
                  css({
                    marginInline: "auto",
                    display: "flex",
									width: "100%",
                    maxWidth: "56rem",
                    flexDirection: "column",
                    gap: "0.375rem",
                    borderRadius: "0.5rem",
                    border: "1px solid var(--border)",
                    backgroundColor: "var(--background)",
                    padding: "0.375rem",
                    boxShadow: "var(--shadow-card)",
                    sm: { width: "100%", gap: "0.5rem", padding: "0.5rem" },
                  }),
                )}
              >
                <WebGroundingHint
                  hasUrl={composerHasUrl}
                  hasGoogleKey={hasGoogleKey}
                  groundingEnabled={uiSettings.webSearch === "auto"}
                  usingGoogleModel={usingGoogleModel}
                />
                <ComposerPrimitive.Attachments>
                  {({ attachment }) => (
                    <ComposerAttachmentChip attachment={attachment} />
                  )}
                </ComposerPrimitive.Attachments>
                <div
                  className={css({
                    display: "flex",
                    width: "100%",
                    minWidth: 0,
                    alignItems: "center",
                    gap: "0.375rem",
                    sm: { gap: "0.5rem" },
                  })}
                >
                  <button
                    type="button"
                    className={cx(
                      srInteractiveClass,
                      css({
                        display: "inline-flex",
                        height: "2rem",
                        maxWidth: "4rem",
                        flexShrink: 0,
                        alignItems: "center",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        borderRadius: "0.375rem",
                        border: "1px solid var(--border)",
                        paddingInline: "0.375rem",
                        fontSize: "11px",
                        color: "var(--muted-foreground)",
                        _hover: {
                          backgroundColor: "var(--accent)",
                          color: "var(--accent-foreground)",
                        },
                        _disabled: { opacity: 0.5 },
                        sm: {
                          height: "2.25rem",
                          maxWidth: "5rem",
                          paddingInline: "0.5rem",
                          fontSize: "0.75rem",
                        },
                      }),
                    )}
                    disabled={!callbacks.onModelSelect}
                    onClick={() => callbacks.onModelSelect?.()}
                    title={modelLabel}
                  >
                    {modelLabel}
                  </button>
                  {/* Reasoning level — visible on landscape/tablet+ */}
                  <ReasoningLevelSelector
                    level={selectedThinkingLevel}
                    onChange={handleThinkingLevelChange}
                    disabled={isRunning}
                  />
                  <ComposerPrimitive.AddAttachment
                    multiple
                    className={composerIconButtonClass}
                    title="Attach files or images"
                    aria-label="Attach files or images"
                  >
                    <Paperclip size={15} className={css({ sm: { width: "1rem", height: "1rem" } })} />
                  </ComposerPrimitive.AddAttachment>
									{!voiceComposerOpen ? <SpeechComposerControl expanded={false} onExpandedChange={setVoiceComposerOpen} /> : null}
									{voiceComposerOpen ? (
										<SpeechComposerControl expanded onExpandedChange={setVoiceComposerOpen} />
									) : voiceComposerOpen ? null : (
									<ComposerPrimitive.Input
                    className={css({
                      maxHeight: "10rem",
                      minHeight: "2rem",
                      minWidth: 0,
                      flex: 1,
                      resize: "none",
                      alignSelf: "center",
                      backgroundColor: "transparent",
                      paddingInline: "0.25rem",
                      paddingBlock: "0.375rem",
                      fontSize: "0.875rem",
                      lineHeight: "1.25rem",
                      color: "var(--foreground)",
                      outline: "none",
                      _placeholder: { color: "var(--muted-foreground)" },
                      sm: { minHeight: "2.25rem", paddingBlock: "0.5rem" },
                    })}
                    placeholder="Message Keating"
                    rows={1}
                    onChange={(event) => setComposerHasUrl(URL_IN_TEXT_PATTERN.test(event.currentTarget.value))}
									/>
									)}
                  {/* Only show Send OR Cancel — never both */}
                  {isRunning ? (
                    <ComposerPrimitive.Cancel
                      className={cx(
                        composerIconButtonClass,
                        pulseClass,
                        css({
                          borderWidth: "2px",
                          borderColor: "var(--destructive)",
                          color: "var(--destructive)",
                          _hover: {
                            backgroundColor: "var(--destructive)",
                            color: "var(--destructive-foreground)",
                          },
                        }),
                      )}
                    >
                      <Square size={15} className={css({ sm: { width: "1rem", height: "1rem" } })} />
                    </ComposerPrimitive.Cancel>
                  ) : voiceComposerOpen ? null : (
                    <ComposerPrimitive.Send
                      className={cx(
                        composerIconButtonClass,
                        css({
                          borderColor: "transparent",
                          backgroundColor: "var(--primary)",
                          color: "var(--primary-foreground)",
                        }),
                      )}
                    >
                      <Send size={15} className={css({ sm: { width: "1rem", height: "1rem" } })} />
                    </ComposerPrimitive.Send>
                  )}
                </div>
              </ComposerPrimitive.Root>
              <div
                className={cx(
                  "composer-hint",
                  css({
                    marginInline: "auto",
                    display: "flex",
                    width: "100%",
                    maxWidth: "56rem",
                    justifyContent: "space-between",
                    gap: "0.75rem",
                    paddingInline: "0.25rem",
                    paddingTop: "0.375rem",
                  }),
                )}
              >
                <span>
                  keating won&apos;t give you the answer —{" "}
                  <span className="ok">that&apos;s the point</span>
                </span>
                <span className={css({ display: "none", sm: { display: "inline" } })}>
                  enter to send // shift+enter for newline
                </span>
              </div>
            </ThreadPrimitive.ViewportFooter>
          </ThreadPrimitive.Viewport>
        </ThreadPrimitive.Root>
      </AssistantRuntimeProvider>
      </KeatingOpenUIActionProvider>
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
    <MessagePrimitive.Root
      className={css({
        marginInline: "auto",
        marginBottom: "1rem",
        display: "flex",
        width: "100%",
        maxWidth: "56rem",
        // Mobile: let the user message span the full chat width instead of the
        // narrow right-aligned "reply" bubble, so text uses the available space.
        // Desktop (sm+): keep the classic right-aligned reply bubble.
        justifyContent: "stretch",
        sm: { justifyContent: "flex-end" },
      })}
    >
      <div
        className={css({
          display: "flex",
          // Full width on mobile; constrained reply bubble on sm+.
          width: "100%",
          maxWidth: "100%",
          flexDirection: "row-reverse",
          gap: 0,
          paddingInline: 0,
          fontSize: "0.6875rem",
          color: "var(--foreground)",
          sm: {
            width: "auto",
            maxWidth: "82%",
            gap: "0.75rem",
            paddingInline: "0.25rem",
            fontSize: "0.875rem",
          },
        })}
      >
        <div className={cx("chat-avatar chat-avatar-you", css({ display: "none", marginTop: "0.125rem", sm: { display: "flex" } }))}>
          {profileImage ? (
            <img src={profileImage} alt="You" />
          ) : (
            <User className={css({ width: "1rem", height: "1rem", flexShrink: 0 })} />
          )}
        </div>
        <div
          className={css({
            display: "flex",
            minWidth: 0,
            // Grow to fill the row on mobile so the bubble/text spans the width;
            // shrink back to content width and right-align on sm+.
            flex: 1,
            flexDirection: "column",
            alignItems: "stretch",
            sm: { flex: "initial", alignItems: "flex-end" },
          })}
        >
          <div className="msg-meta">
            <b>YOU</b>
          </div>
          <div
            className={cx(
              "you-bubble",
              css({
                whiteSpace: "pre-wrap",
                lineHeight: "1.125rem",
                fontFamily: "var(--font-ui)",
                sm: { lineHeight: "1.5rem" },
              }),
            )}
          >
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
      className={css({
        position: "fixed",
        inset: 0,
        zIndex: 50,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgb(0 0 0 / 0.5)",
        paddingInline: "1rem",
        backdropFilter: "blur(4px)",
      })}
      onClick={onClose}
    >
      <div
        className={css({
          width: "100%",
          maxWidth: "28rem",
          borderRadius: "0.5rem",
          border: "1px solid var(--border)",
          backgroundColor: "var(--background)",
          padding: "1.25rem",
          boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)",
        })}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={css({ marginBottom: "0.75rem", display: "flex", alignItems: "center", justifyContent: "space-between" })}>
          <h3 className={css({ fontSize: "0.875rem", fontWeight: 600, color: "var(--foreground)" })}>
            {type === "up" ? "What was helpful?" : "What could be improved?"}
          </h3>
          <button
            type="button"
            className={cx(iconButtonClass, css({ width: "1.75rem", height: "1.75rem" }))}
            onClick={onClose}
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </div>
        <textarea
          className={css({
            width: "100%",
            resize: "none",
            borderRadius: "0.375rem",
            border: "1px solid var(--border)",
            backgroundColor: "color-mix(in srgb, var(--muted) 30%, transparent)",
            paddingInline: "0.75rem",
            paddingBlock: "0.5rem",
            fontSize: "0.875rem",
            color: "var(--foreground)",
            outline: "none",
            _placeholder: { color: "var(--muted-foreground)" },
          })}
          rows={4}
          placeholder="Optional comment..."
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          autoFocus
        />
        <div className={css({ marginTop: "0.75rem", display: "flex", justifyContent: "flex-end", gap: "0.5rem" })}>
          <button
            type="button"
            className={cx(dialogButtonClass, css({ height: "2rem", color: "var(--muted-foreground)", _hover: { backgroundColor: "var(--accent)", color: "var(--accent-foreground)" } }))}
            onClick={onClose}
          >
            Skip
          </button>
          <button
            type="button"
            className={cx(
              dialogButtonClass,
              css({
                height: "2rem",
                borderColor: "transparent",
                backgroundColor: "var(--primary)",
                color: "var(--primary-foreground)",
                _hover: { backgroundColor: "color-mix(in srgb, var(--primary) 90%, transparent)" },
              }),
            )}
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
  onModelSelect,
  onRetry,
}: {
  components: ReturnType<typeof messagePartComponents>;
  onFork?: (forkPoint?: number) => void | Promise<void>;
  onModelSelect?: () => void;
  onRetry?: () => void | Promise<void>;
}) {
  const [feedback, setFeedback] = useState<"up" | "down" | null>(null);
  const [feedbackModalOpen, setFeedbackModalOpen] = useState(false);
  const [feedbackType, setFeedbackType] = useState<"up" | "down">("up");
  const onAuthError = useContext(AuthErrorContext);
  const authError = useMessage(
    (message) =>
      message.metadata.custom?.keatingAuthError as AuthErrorEntry | undefined,
  );
  const canRetry = useMessage(
    (message) => message.metadata.custom?.keatingRetryable === true,
  );
  const llmFailure = useMessage(
    (message) => message.metadata.custom?.keatingLlmFailure as LlmErrorDetails | undefined,
  );
  const retryAttempts = useMessage(
    (message) => message.metadata.custom?.keatingRetryAttempts as number | undefined,
  );
  const retryExhausted = useMessage(
    (message) => message.metadata.custom?.keatingRetryExhausted === true,
  );
	const isPrefillStatus = useMessage(
		(message) => message.metadata.custom?.keatingPrefillStatus === true,
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
  const copyText = stripOpenUIPrograms(stripQuizTags(
    stripGeneratedImageTags(stripQuestionTags(stripGoalTags(stripArtifactLinks(messageText)))),
  )).trim();
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
          detail: {
            type,
            comment,
            messageId,
            messageText: copyText,
            messageCreatedAt: Number(messageId.slice(messageId.lastIndexOf("-") + 1)) || undefined,
          },
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

	if (isPrefillStatus) {
		return <KeatingThinkingIndicator status={messageText} />;
	}

  return (
    <>
      <MessagePrimitive.Root
        className={css({
          marginInline: "auto",
          marginBottom: "1rem",
          display: "flex",
          width: "100%",
          maxWidth: "56rem",
          justifyContent: "flex-start",
          _hover: { "& [data-fork-action]": { opacity: 1 } },
        })}
      >
        <div
          className={css({
            display: "flex",
            width: "100%",
            gap: 0,
            paddingInline: 0,
            fontSize: "0.875rem",
            color: "var(--foreground)",
            sm: { gap: "0.75rem", paddingInline: "0.25rem" },
          })}
        >
          <div className={cx("chat-avatar", css({ display: "none", marginTop: "0.125rem", sm: { display: "flex" } }))}>
            <img src="/brand/mascot-head.png" alt="Keating" />
          </div>
          <div className={css({ minWidth: 0, flex: 1, lineHeight: "1.5rem" })}>
            <div className="msg-meta">
              <b>KEATING</b>
            </div>
            <div className={cx("keating-bubble", foregroundTextClass)}>
            <MessagePrimitive.Content components={components} />
            {authError && (
              <div
                className={css({
                  marginBlock: "0.5rem",
                  borderRadius: "0.5rem",
                  border: "1px solid color-mix(in srgb, var(--destructive) 50%, transparent)",
                  backgroundColor: "color-mix(in srgb, var(--destructive) 10%, transparent)",
                  padding: "0.75rem",
                  fontSize: "0.875rem",
                })}
              >
                <div className={css({ display: "flex", alignItems: "flex-start", gap: "0.5rem" })}>
                  <KeyRound
                    size={16}
                    className={css({ marginTop: "0.125rem", flexShrink: 0, color: "var(--destructive)" })}
                  />
                  <div className={css({ minWidth: 0, flex: 1 })}>
                    <p className={css({ marginBottom: "0.25rem", fontWeight: 500, color: "var(--destructive)" })}>
                      Authentication failed
                    </p>
                    <p className={css({ marginBottom: "0.5rem", fontSize: "0.75rem", color: "var(--muted-foreground)" })}>
                      {llmFailure?.recovery ?? "Re-enter the provider credentials, then Keating can retry the same turn."}
                    </p>
                    <button
                      type="button"
                      onClick={handleAuthRetry}
                      disabled={retrying}
                      className={cx(
                        srInteractiveClass,
                        css({
                          display: "inline-flex",
                          alignItems: "center",
                          gap: "0.375rem",
                          borderRadius: "0.375rem",
                          backgroundColor: "var(--primary)",
                          paddingInline: "0.75rem",
                          paddingBlock: "0.375rem",
                          fontSize: "0.75rem",
                          fontWeight: 500,
                          color: "var(--primary-foreground)",
                          _hover: {
                            backgroundColor: "color-mix(in srgb, var(--primary) 90%, transparent)",
                          },
                          _disabled: { opacity: 0.5 },
                        }),
                      )}
                    >
                      {retrying ? (
                        <Spinner size={12} />
                      ) : (
                        <KeyRound size={12} />
                      )}
                      Re-enter API key
                    </button>
                    <a
                      href={tutorialApiKeyHref(authError.provider)}
                      onClick={(event) => handleTutorialLinkClick(event.nativeEvent, tutorialApiKeyHref(authError.provider))}
                      className={css({
                        marginLeft: "0.5rem",
                        display: "inline-flex",
                        alignItems: "center",
                        fontSize: "0.75rem",
                        color: "var(--primary)",
                        textDecoration: "underline",
                        textUnderlineOffset: "2px",
                      })}
                    >
                      Need a key?
                    </a>
                  </div>
                </div>
              </div>
            )}
            </div>
            {llmFailure && retryAttempts && retryAttempts > 1 && (
              <p
                className={css({ marginTop: "0.5rem", fontSize: "0.75rem", color: "var(--muted-foreground)" })}
                role="status"
              >
                {retryExhausted
                  ? `Automatic recovery stopped after ${retryAttempts} attempts.`
                  : `Keating made ${retryAttempts} recovery attempts before preserving this error.`}
              </p>
            )}
            <div className={css({ marginTop: "0.5rem", display: "flex", alignItems: "center", gap: "0.25rem" })}>
              {copyText && <CopyButton variant="ghost" text={copyText} label="Copy message" />}
              {canRetry && onRetry && (
                <RetryResponseButton
                  className={cx(messageActionButtonClass, css({ width: "auto", gap: "0.375rem", paddingInline: "0.5rem" }))}
                  onRetry={onRetry}
                />
              )}
              {llmFailure && llmFailure.category !== "aborted" && onModelSelect && (
                <button
                  type="button"
                  className={cx(messageActionButtonClass, css({ width: "auto", gap: "0.375rem", paddingInline: "0.5rem" }))}
                  onClick={onModelSelect}
                  title="Choose a different model"
                >
                  <Server size={13} />
                  <span>Choose model</span>
                </button>
              )}
              <button
                type="button"
                className={cx(
                  messageActionButtonClass,
                  feedback === "up"
                    ? css({
                        backgroundColor: "color-mix(in srgb, var(--primary) 20%, transparent)",
                        color: "var(--primary)",
                      })
                    : "",
                )}
                title="Helpful"
                onClick={() => handleFeedbackClick("up")}
                aria-pressed={feedback === "up"}
              >
                <ThumbsUp size={13} />
              </button>
              <button
                type="button"
                className={cx(
                  messageActionButtonClass,
                  feedback === "down"
                    ? css({
                        backgroundColor: "color-mix(in srgb, var(--destructive) 20%, transparent)",
                        color: "var(--destructive)",
                      })
                    : "",
                )}
                title="Not helpful"
                onClick={() => handleFeedbackClick("down")}
                aria-pressed={feedback === "down"}
              >
                <ThumbsDown size={13} />
              </button>
              {onFork && (
                <button
                  type="button"
                  data-fork-action
                  className={cx(messageActionButtonClass, css({ opacity: 0, _focus: { opacity: 1 } }))}
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

function KeatingThinkingIndicator({ status }: { status: string }) {
	return (
		<div
			role="status"
			aria-live="polite"
			className={css({
				marginInline: "auto",
				marginBottom: "1rem",
				display: "flex",
				width: "100%",
				maxWidth: "56rem",
				alignItems: "center",
				gap: "0.75rem",
				color: "var(--muted-foreground)",
			})}
		>
			<div
				className={cx(
					"keating-thinking-mascot",
					css({
						display: "flex",
						height: "2.5rem",
						width: "2.5rem",
						flexShrink: 0,
						alignItems: "center",
						justifyContent: "center",
						borderRadius: "0.5rem",
						border: "1px solid var(--border)",
						backgroundColor: "var(--card)",
					}),
				)}
			>
				<img src="/brand/mascot-head.png" alt="" className={css({ width: "1.875rem", height: "auto" })} />
			</div>
			<div className={css({ minWidth: 0 })}>
				<div className={css({ display: "flex", alignItems: "center", gap: "0.25rem", fontSize: "0.75rem", fontWeight: 600, color: "var(--foreground)" })}>
					Keating is thinking
					<span aria-hidden="true" className={css({ display: "inline-flex", gap: "0.1875rem" })}>
						{[0, 1, 2].map((index) => (
							<span key={index} className="keating-thinking-dot" style={{ animationDelay: `${index * 140}ms` }} />
						))}
					</span>
				</div>
				<p className={css({ marginTop: "0.125rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: "11px" })}>{status}</p>
			</div>
		</div>
	);
}

export const AssistantChatPanel = forwardRef<
  ChatPanelHandle,
  AssistantChatPanelProps
>(({ className, speechEnabled = false, responseComparison }, ref) => {
  const [agent, setAgentState] = useState<Agent | null>(null);
  const [callbacks, setCallbacks] = useState<ChatPanelSetupCallbacks>({});
  const [version, setVersion] = useState(0);
  const [toolConfirmation, setToolConfirmation] = useState<ToolConfirmationRequestDetail | null>(null);

  useEffect(() => {
    const receiveConfirmation = (event: Event) => {
      const detail = (event as CustomEvent<ToolConfirmationRequestDetail>).detail;
      if (!detail?.review || typeof detail.approve !== "function" || typeof detail.cancel !== "function") return;
      setToolConfirmation((current) => {
        if (current) {
          detail.cancel();
          return current;
        }
        return detail;
      });
    };
    window.addEventListener("keating:tool-confirmation-request", receiveConfirmation);
    return () => window.removeEventListener("keating:tool-confirmation-request", receiveConfirmation);
  }, []);

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
        responseComparison={responseComparison}
      />
      {toolConfirmation ? (
        <ToolConfirmationDialog request={toolConfirmation} onDone={() => setToolConfirmation(null)} />
      ) : null}
    </div>
  );
});

AssistantChatPanel.displayName = "AssistantChatPanel";

// Test-only export for parser regressions around malformed reasoning tags from
// OpenAI-compatible providers.
export const __test_assistantTextParts = assistantTextParts;
export const __test_parseInteractiveSegments = parseInteractiveSegments;
export const __test_interactiveTagPattern = interactiveTagPattern;

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
