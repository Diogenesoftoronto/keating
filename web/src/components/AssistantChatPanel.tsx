import { clearPendingChatTurn } from "../notorganic-provider/pending-chat-turn";
import {
  assistantTextParts,
  textFromContent,
  mergeConsecutiveAssistantMessages,
  shouldRenderFlueMessage,
} from "./assistant-chat-messages";
import {
  generatedImageTagPattern,
  goalTagPattern,
  parseInteractiveSegments,
  questionTagPattern,
  quizTagPattern,
} from "./interactive-segments";
import type { FlueConversationMessage } from "@flue/sdk";
import "./keating-interaction-motion.css";
import { chatMascotState } from "./chat-mascot-state";
import { ChatMascotMenu } from "./ChatMascotMenu";
import "./chat-mascot.css";
import { DraftReviewStatus } from "./DraftReviewStatus";
import { clearTeachingDraftContents, getTeachingDraftStatus, subscribeTeachingDraftStatus, teachingDraftIsActive } from "../keating/judgement/draft-status";
import { prepareAudioAttachment } from "../lib/audio-attachment";
import type { FlueConversation } from "../keating/flue/conversation";
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
  useSyncExternalStore,
} from "react";
import type { Key, ReactNode } from "react";
const DeveloperChatDetails = createContext(false);
import type {
  AgentMessage,
  ThinkingLevel,
} from "@earendil-works/pi-agent-core";
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
  useAui,
  useAuiState,
  useExternalStoreRuntime,
} from "@assistant-ui/react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { css, cx } from "../../styled-system/css";
import {
  Cpu,
  Plus,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Check,
  Copy,
  CopyPlus,
  LibraryBig,
  Lightbulb,
  Loader2,
  Paperclip,
  Send,
  Server,
  Square,
  ThumbsDown,
  ThumbsUp,
  User,
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
import { QuizRenderer } from "./QuizRenderer";
import {
  foldedToolResult,
  hasMeaningfulToolResult,
  MISSING_TOOL_RESULT_MESSAGE,
  resolveToolVisualState,
  toolCallEndedWithoutResult,
  toolCallIsPending,
} from "./tool-lifecycle";
import type { QuizResult } from "./QuizRenderer";
import { QuizSessionPanel } from "./QuizSessionPanel";
import { QuizResultCard } from "./QuizResultCard";
import { Spinner } from "./Spinner";
import { ImageGenerationRetryButton } from "./ImageGenerationRetryButton";
import { SceneRenderer } from "./SceneRenderer";
import { AnimatedScene, parseAnimationPayload } from "./AnimatedScene";
import { QuestionRenderer, normalizeQuestionForm } from "./QuestionRenderer";
import type { QuestionFormData } from "./QuestionRenderer";
import { GoalRenderer } from "./GoalRenderer";
import { normalizeGoal } from "../keating/goals";
import type {
  Quiz,
  QuizGradePayload,
  QuizQuestionGrade,
} from "../keating/core";
import { KeatingStorage } from "../keating/storage";
import type { PlanRevisionProposal } from "../keating/plan-revisions";
import { PlanRevisionCard } from "./PlanRevisionCard";
import { recordAssistantPresentations } from "../keating/judgement/active-work-host";
import { recordWebActivityPresentation } from "../keating/judgement/activity-learning";
import { parseReviewNotice, stripReviewNotice } from "../keating/judgement/review-notice";
import { ReviewNoticeCard } from "./ReviewNoticeCard";
import {
  QuizGradesContext,
  type QuizGradesContextValue,
} from "./quiz-grades-context";
import {
  KEATING_VOICE_TOOL_NAME,
} from "../keating/speech";
import { type LiveTranscriptTurn } from "../keating/live-transcript";
import {
  IMAGE_PROGRESS_EVENT,
  type ImageProgressDetail,
} from "../keating/image-stream";
import {
  ANIMATION_PROGRESS_EVENT,
  type AnimationProgressDetail,
} from "../keating/tool-arg-stream";
import { JsonCrackBlock } from "./JsonCrackBlock";
import { WebSearchPart } from "./WebSearchPart";
import { isWebSearchToolName, splitSearchSources } from "./web-search-result";
import { FailedResponseRecovery } from "./FailedResponseRecovery";
import { NotOrganicCreditRecovery } from "./NotOrganicCreditRecovery";
import { ProviderAuthRecovery } from "./ProviderAuthRecovery";
import { ErrorDiagnosticsActions } from "./ErrorDiagnosticsActions";
import { FlashcardRenderer } from "./FlashcardRenderer";
import type { FlashcardDeck } from "../keating/srs";
import { MermaidRenderer } from "./MermaidRenderer";
import { MarkdownBlock } from "./MarkdownBlock";
import { normalizeLatexDelimiters } from "./MarkdownBlock";
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
import type { OpenUIDocumentScope } from "../keating/openui/types";
import { parseLearnerResponse } from "../keating/learner-response";
import { useLearnerDelivery } from "./chat/useLearnerDelivery";
import { useQuizConversationEvents } from "./chat/useQuizConversationEvents";
import { useGoogleKeyForUrls, useLoadingStep } from "./chat/thread-status";
import { quizSubmittedDetail } from "./chat/quiz-conversation";
import { LearnerResponseReview } from "./LearnerResponseReview";
import { classifyLlmError, type LlmErrorDetails } from "../core/api-retry";
import { composerIconButtonClass, srInteractiveClass } from "./chat/composer-styles";
import { SpeechComposerControl } from "./chat/SpeechComposerControl";
import {
  classifyError,
  diagnosticsSummaryForFailure,
  VOICE_ERROR_PATTERNS,
  type ClassifiedError,
} from "./chat/error-classification";

const AuthErrorContext = createContext<(provider: string) => Promise<boolean>>(
  () => Promise.resolve(false),
);
const quizGradeStorage = new KeatingStorage();
const LIVE_PRESENTATION_WINDOW_MS = 2 * 60_000;

const capturedApiErrorKeys = new Set<string>();
const MAX_CAPTURED_API_ERROR_KEYS = 256;

const mutedTextClass = css({ color: "var(--muted-foreground)" });
const foregroundTextClass = css({ color: "var(--foreground)" });
const pulseClass = css({
  animation: "pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
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
  _disabled: {
    color: "var(--muted-foreground)",
    opacity: 0.72,
  },
});
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
      void quizGradeStorage.saveQuizGrades(payload.resultId, payload.grades);
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

  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(await file.arrayBuffer()),
  });

  let extractedText = `<pdf filename="${file.name}">`;
  let hasReadableText = false;
  try {
    const pdf = await loadingTask.promise;
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
    await loadingTask.destroy();
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
  accept: `image/*,audio/*,.wav,.mp3,.m4a,.webm,${DOCUMENT_ATTACHMENT_ACCEPT}`,
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
    if (file.type.startsWith("audio/") || /\.(wav|mp3|m4a|webm|ogg|flac)$/i.test(file.name)) {
      const audio = await prepareAudioAttachment(file);
      return {...attachment, type: "file", status: {type: "complete"},
        content: [{type: "file", filename: audio.name, mimeType: audio.type,
          data: await readFileAsDataUrl(audio)}]};
    }
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
  initialPrompts?: readonly StarterPrompt[];
  emptyStateTitle?: string;
  emptyStateDescription?: string;
  /** Text dropped into the composer once, e.g. a request handed over from a course. */
  pendingPrompt?: string;
}

/**
 * Fills the composer with a request handed over from elsewhere in Keating.
 * Never overwrites what the learner has already typed, and never sends.
 */
function ComposerPrefill({ text }: { text?: string }) {
  const composer = useAui().composer;
  const appliedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!text || appliedRef.current === text) return;
    appliedRef.current = text;
    if (composer.getState().text.trim()) return;
    composer.setText(text);
  }, [composer, text]);
  return null;
}

const OpenUISessionScopeContext = createContext<string | undefined>(undefined);

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
  const messageId = useAuiState(({ message }) => message.id);
  const messageCreatedAt = useAuiState(({ message }) => message.createdAt);
	const sessionId = useContext(OpenUISessionScopeContext);
  const developerMode = useContext(DeveloperChatDetails);
  const handledFailure = useAuiState(({ message }) => Boolean(message.metadata.custom?.keatingLlmFailure && message.metadata.custom?.keatingRetryable));
  const isMarkedError = text.startsWith(ERROR_TEXT_PREFIX);
  // Only turns completed while this view is open link to the current plan
  // focus; reopened history must not be linked to today's focus.
  const liveTurnRef = useRef(
    status?.type === "running" ||
      (messageCreatedAt ? Date.now() - messageCreatedAt.getTime() < LIVE_PRESENTATION_WINDOW_MS : false),
  );
  if (status?.type === "running") liveTurnRef.current = true;
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
    if (
      capturedErrorRef.current === capturedKey ||
      capturedApiErrorKeys.has(capturedKey)
    )
      return;
    capturedErrorRef.current = capturedKey;
    capturedApiErrorKeys.add(capturedKey);
    if (capturedApiErrorKeys.size > MAX_CAPTURED_API_ERROR_KEYS) {
      const oldest = capturedApiErrorKeys.values().next().value;
      if (oldest) capturedApiErrorKeys.delete(oldest);
    }
    const classified = classifyError(displayText);
    posthog.capture("api_error", {
      error_type: classified.category,
      status_code: classified.statusCode,
    });
  }, [displayText, isMarkedError, posthog, status?.type]);

  useEffect(() => {
    if (!sessionId || isMarkedError || status?.type === "running" || !liveTurnRef.current) return;
    liveTurnRef.current = false;
    // A withheld turn presented nothing the learner can act on.
    if (parseReviewNotice(displayText)?.kind === "withheld") return;
    const deliveredText = stripReviewNotice(displayText);
    const presentationText = stripArtifactLinks(splitSearchSources(deliveredText).text);
    if (messageCreatedAt) {
      recordWebActivityPresentation(deliveredText, { sessionId, messageId }, messageCreatedAt.getTime(), presentationText);
    }
    void recordAssistantPresentations(
      quizGradeStorage,
      presentationText,
      { sessionId, messageId },
    ).catch((error) => console.warn("[keating] could not record OpenUI presentations", error));
  }, [displayText, isMarkedError, messageCreatedAt, messageId, sessionId, status?.type]);

  if (isMarkedError) {
    if (!developerMode && handledFailure) return null;
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

  const notice = parseReviewNotice(visibleText);
  if (notice?.kind === "withheld") {
    return (
      <ReviewNoticeCard kind="withheld">
        {notice.text.split(/\n{2,}/).filter(Boolean).map((paragraph, index) => (
          <p key={index} className={index ? mutedTextClass : undefined}>{paragraph}</p>
        ))}
      </ReviewNoticeCard>
    );
  }
  const searchContent = splitSearchSources(notice ? notice.text : visibleText);
  const reply = (
    <>
    <MarkdownText
      text={searchContent.text}
		documentScope={sessionId ? { sessionId, messageId } : messageId}
      isRunning={status?.type === "running"}
    />
    {searchContent.sites.length > 0 && <WebSearchPart toolName="web_search" result={{ citations: searchContent.sites }} status={{ type: "complete" }} />}
    </>
  );
  return notice ? <ReviewNoticeCard kind="unverified">{reply}</ReviewNoticeCard> : reply;
}

const artifactLinkPattern = /\[artifact:\/\/([^/]+)\/([^\]]+)\]/g;

function stripArtifactLinks(text: string): string {
  return text.replace(artifactLinkPattern, "").trim();
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
  const developerMode = useContext(DeveloperChatDetails);
  if (!developerMode) return <p role="alert">This request could not finish. Please try again.</p>;
  const ErrorIcon = classified.icon;
  return (
    <div className={css({ display: "grid", gap: "0.375rem" })}>
      <div
        className={css({
          display: "flex",
          alignItems: "center",
          gap: "0.375rem",
          fontWeight: 500,
        })}
      >
        <ErrorIcon size={13} />
        <span>{classified.title}</span>
        {classified.statusCode && (
          <span
            className={css({
              borderRadius: "0.25rem",
              backgroundColor:
                "color-mix(in srgb, var(--background) 70%, transparent)",
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
        backgroundColor:
          "color-mix(in srgb, var(--background) 60%, transparent)",
      })}
    >
      <img
        src={image}
        alt={filename ?? "Attached image"}
        className={css({
          maxHeight: "20rem",
          width: "100%",
          objectFit: "contain",
        })}
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

function FilePart({
  filename,
  mimeType,
  data,
}: {
  filename?: string;
  mimeType?: string;
  data?: string;
}) {
  if (mimeType?.startsWith("audio/") && data) {
    const src = data.startsWith("data:audio/") || data.startsWith("blob:") ? data : `data:${mimeType};base64,${data}`;
    return <figure className={css({marginBlock: "0.5rem", maxWidth: "100%"})}>
      <audio controls preload="metadata" src={src} aria-label={filename || "Audio message"} style={{maxWidth: "100%", width: 300}} />
      <figcaption className={css({fontSize: "0.75rem", color: "var(--muted-foreground)"})}>{filename || "Audio message"}</figcaption>
    </figure>;
  }
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
        backgroundColor:
          "color-mix(in srgb, var(--background) 60%, transparent)",
        paddingInline: "0.5rem",
        paddingBlock: "0.25rem",
        fontSize: "0.75rem",
      })}
    >
      <Paperclip
        size={13}
        className={css({ flexShrink: 0, color: "var(--muted-foreground)" })}
      />
      <span
        className={css({
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        })}
      >
        {filename ?? "attachment"}
      </span>
      {mimeType ? (
        <span
          className={css({ flexShrink: 0, color: "var(--muted-foreground)" })}
        >
          {mimeType}
        </span>
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
      <Paperclip
        size={12}
        className={css({ flexShrink: 0, color: "var(--muted-foreground)" })}
      />
      <span
        className={css({
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        })}
      >
        {attachment.name}
      </span>
      {isImage ? (
        <span
          className={css({ flexShrink: 0, color: "var(--muted-foreground)" })}
        >
          image
        </span>
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
    <div
      className={css({
        marginBottom: "0.75rem",
        display: "flex",
        flexWrap: "wrap",
        gap: "0.5rem",
      })}
    >
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
                border:
                  "1px solid color-mix(in srgb, var(--primary) 40%, transparent)",
                backgroundColor:
                  "color-mix(in srgb, var(--primary) 10%, transparent)",
                paddingInline: "0.5rem",
                paddingBlock: "0.25rem",
                fontSize: "0.75rem",
                fontWeight: 500,
                color: "var(--primary)",
                _hover: {
                  backgroundColor:
                    "color-mix(in srgb, var(--primary) 20%, transparent)",
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
            <span className={css({ textTransform: "capitalize" })}>
              {label}
            </span>
          </button>
        );
      })}
    </div>
  );
}

const URL_IN_TEXT_PATTERN = /\bhttps?:\/\/[^\s<>"')\]]+/i;

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

function extractLatestTagPayload(
  text: string,
  pattern: RegExp,
  captureIndex = 1,
): string | null {
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
    return normalizeQuestionForm(
      typeof parsed === "string" ? JSON.parse(parsed) : parsed,
    );
  } catch {
    return null;
  }
}

/** Scan messages backward and return the most recent unanswered question form. */
function extractActiveQuestion(
  messages: AgentMessage[],
): QuestionFormData | null {
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
            .map((p: any) =>
              p?.type === "text" && typeof p.text === "string" ? p.text : "",
            )
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
            .map((p: any) =>
              p?.type === "text" && typeof p.text === "string" ? p.text : "",
            )
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
                detail: quizSubmittedDetail(parsed, result),
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
        <QuizResultCard key={key} data={data} />
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
              new CustomEvent("keating:question-answered", {
                detail: { answers, topic: form.topic },
              }),
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
  if (seg.type === "plan-revision") {
    try {
      const proposal = JSON.parse(JSON.parse(seg.json)) as PlanRevisionProposal;
      if (!proposal?.id || !proposal.change) return null;
      return <PlanRevisionCard key={key} proposal={proposal} />;
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
      const restrictToCardIds = Array.isArray(
        (parsed as FlashcardDeck & { restrictToCardIds?: string[] })
          .restrictToCardIds,
      )
        ? ((parsed as FlashcardDeck & { restrictToCardIds?: string[] })
            .restrictToCardIds ?? [])
        : undefined;
      return (
        <FlashcardRenderer
          key={key}
          deck={parsed}
          {...(restrictToCardIds ? { restrictToCardIds } : {})}
          onReview={(result) => {
            window.dispatchEvent(
              new CustomEvent("keating:card-reviewed", {
                detail: {
                  deckId: parsed.id,
                  cardId: result.cardId,
                  rating: result.rating,
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
          backgroundColor:
            "color-mix(in srgb, var(--background) 85%, transparent)",
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
      {copied ? (
        <Check size={13} className={css({ color: "rgb(34 197 94)" })} />
      ) : (
        <Copy size={13} />
      )}
    </button>
  );
}

function copyTextFromReactNode(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(copyTextFromReactNode).join("");
  if (node && typeof node === "object" && "props" in node) {
    return copyTextFromReactNode(
      (node as { props?: { children?: ReactNode } }).props?.children,
    );
  }
  return "";
}

function GeneratedImageCard({ payload }: { payload: string }) {
  let data: {
    title?: string;
    alt?: string;
    svg?: string;
    dataUrl?: string;
    mimeType?: string;
    model?: string;
    prompt?: string;
  } | null = null;
  try {
    const parsed = JSON.parse(payload);
    data = typeof parsed === "string" ? JSON.parse(parsed) : parsed;
  } catch {
    data = null;
  }

  if (!data?.svg && !data?.dataUrl) return null;

  const src =
    data.dataUrl ??
    `data:image/svg+xml;charset=utf-8,${encodeURIComponent(data.svg ?? "")}`;
  const copyText = data.svg ?? data.dataUrl ?? "";
  const title = data.title ?? "Generated learning image";

  // Image-first: no frame around the picture and no header bar above it. The
  // caption sits under the image as quiet metadata, and the copy control only
  // appears on hover/focus so it never competes with the visual.
  return (
    <figure
      className={css({
        marginBlock: "1.25rem",
        display: "grid",
        gap: "0.625rem",
      })}
    >
      <a
        href={src}
        target="_blank"
        rel="noreferrer"
        title="Open full size"
        className={css({
          display: "block",
          overflow: "hidden",
          borderRadius: "0.75rem",
          backgroundColor: "color-mix(in srgb, var(--muted) 30%, transparent)",
          _hover: { "& img": { transform: "scale(1.01)" } },
        })}
      >
        <img
          src={src}
          alt={data.alt ?? title}
          loading="lazy"
          className={css({
            display: "block",
            width: "100%",
            transition: "transform 200ms ease-out",
          })}
        />
      </a>
      <div
        className={css({
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: "0.75rem",
          _hover: { "& [data-image-copy]": { opacity: 1 } },
        })}
      >
        <figcaption
          className={css({
            minWidth: 0,
            fontSize: "0.75rem",
            color: "var(--muted-foreground)",
          })}
        >
          <span className={css({ color: "var(--foreground)" })}>{title}</span>
          {data.model && (
            <span
              className={cx(
                "font-terminal",
                css({ marginLeft: "0.5rem", fontSize: "0.6875rem" }),
              )}
            >
              {data.model}
            </span>
          )}
        </figcaption>
        <span
          data-image-copy
          className={css({
            flexShrink: 0,
            opacity: 0,
            transition: "opacity 150ms",
            _focusWithin: { opacity: 1 },
          })}
        >
          <CopyButton
            text={copyText}
            label={data.svg ? "Copy SVG" : "Copy image"}
            variant="ghost"
          />
        </span>
      </div>
    </figure>
  );
}

/**
 * Live preview while `animate` is running. The animation is authored as a tool
 * argument, so the HTML arrives token by token and can be rendered as it grows.
 * The partial document has unclosed tags and no timeline script yet — browsers
 * render it fine, and it reads as the scene assembling itself.
 */
function StreamingAnimationPreview() {
  const [frame, setFrame] = useState<{ html: string; topic?: string } | null>(
    null,
  );

  useEffect(() => {
    const onProgress = (event: Event) => {
      const detail = (event as CustomEvent<AnimationProgressDetail>).detail;
      if (!detail) return;
      if (detail.status === "done") {
        setFrame(null);
        return;
      }
      setFrame({ html: detail.html, topic: detail.topic });
    };
    window.addEventListener(ANIMATION_PROGRESS_EVENT, onProgress);
    return () =>
      window.removeEventListener(ANIMATION_PROGRESS_EVENT, onProgress);
  }, []);

  if (!frame) return null;

  return (
    <div
      className={css({ marginTop: "0.75rem", display: "grid", gap: "0.5rem" })}
    >
      <iframe
        title={`${frame.topic ?? "Animation"} — building`}
        srcDoc={frame.html}
        sandbox=""
        className={css({
          display: "block",
          aspectRatio: "16 / 9",
          width: "100%",
          borderRadius: "0.75rem",
          border: "none",
          background: "black",
        })}
      />
      <div
        className={css({
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          fontSize: "0.75rem",
          color: "var(--muted-foreground)",
        })}
      >
        <Spinner size={12} />
        <span>Building animation{frame.topic ? ` · ${frame.topic}` : ""}</span>
      </div>
    </div>
  );
}

/**
 * Live preview while `generate_image` is running. The tool streams progressive
 * renders as window events (it runs outside React), so this listens rather than
 * taking props. Shows the newest partial, blurred until it sharpens.
 */
function StreamingImagePreview() {
  const [frame, setFrame] = useState<{
    dataUrl?: string;
    title: string;
    index: number;
  } | null>(null);

  useEffect(() => {
    const onProgress = (event: Event) => {
      const detail = (event as CustomEvent<ImageProgressDetail>).detail;
      if (!detail) return;
      if (detail.status === "done" || detail.status === "error") {
        setFrame(null);
        return;
      }
      setFrame({
        dataUrl: detail.dataUrl,
        title: detail.title,
        index: detail.index ?? 0,
      });
    };
    window.addEventListener(IMAGE_PROGRESS_EVENT, onProgress);
    return () => window.removeEventListener(IMAGE_PROGRESS_EVENT, onProgress);
  }, []);

  if (!frame) return null;

  return (
    <div
      className={css({ marginTop: "0.75rem", display: "grid", gap: "0.5rem" })}
    >
      <div
        className={css({
          position: "relative",
          overflow: "hidden",
          borderRadius: "0.75rem",
          aspectRatio: "1 / 1",
          maxHeight: "22rem",
          backgroundColor: "color-mix(in srgb, var(--muted) 40%, transparent)",
        })}
      >
        {frame.dataUrl ? (
          <img
            src={frame.dataUrl}
            alt={`${frame.title} — partial render`}
            className={css({
              display: "block",
              height: "100%",
              width: "100%",
              objectFit: "cover",
              // Early passes are noisy; a little blur reads as "still resolving"
              // and clears as later frames arrive.
              filter: "blur(6px)",
              transition: "filter 400ms ease-out",
            })}
            style={{ filter: `blur(${Math.max(0, 6 - frame.index * 3)}px)` }}
          />
        ) : (
          <div
            className={cx(pulseClass, css({ height: "100%", width: "100%" }))}
          />
        )}
      </div>
      <div
        className={css({
          display: "flex",
          alignItems: "center",
          gap: "0.5rem",
          fontSize: "0.75rem",
          color: "var(--muted-foreground)",
        })}
      >
        <Spinner size={12} />
        <span>
          {frame.dataUrl ? "Refining image" : "Generating image"} ·{" "}
          {frame.title}
        </span>
      </div>
    </div>
  );
}

// Static renderer map for chat markdown. Hoisted to module scope so it is
// created once instead of rebuilt for every segment on every streaming token.
const MARKDOWN_COMPONENTS: Components = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pre: ({ children }: any) => {
    const code = Array.isArray(children) ? children[0] : children;
    const props = code?.props as
      | { className?: string; children?: string }
      | undefined;
    const lang = /language-(\w+)/
      .exec(props?.className ?? "")?.[1]
      ?.toLowerCase();
    const raw =
      typeof props?.children === "string"
        ? props.children
        : copyTextFromReactNode(children);
    if (lang === "mermaid") {
      return (
        <div
          className={css({
            marginBlock: "0.5rem",
            overflow: "auto",
            borderRadius: "0.5rem",
            border: "1px solid var(--border)",
            backgroundColor:
              "color-mix(in srgb, var(--muted) 30%, transparent)",
            padding: "1rem",
            _hover: {
              "& [data-copy-on-hover]": { opacity: 1 },
            },
          })}
        >
          <MermaidRenderer content={raw} />
          <div
            className={css({
              marginTop: "0.25rem",
              display: "flex",
              justifyContent: "flex-end",
            })}
          >
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
        <div
          className={css({
            marginTop: "0.25rem",
            display: "flex",
            justifyContent: "flex-end",
          })}
        >
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
      <code
        className={css({
          fontFamily: "var(--mono-body)",
          fontSize: "0.875rem",
        })}
        {...props}
      >
        {children}
      </code>
    );
  },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  p: ({ children }: any) => (
    <p className={css({ marginBottom: "0.75rem", _last: { marginBottom: 0 } })}>
      {children}
    </p>
  ),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ul: ({ children }: any) => (
    <ul
      className={css({
        marginBottom: "0.75rem",
        listStyleType: "disc",
        paddingLeft: "1.25rem",
      })}
    >
      {children}
    </ul>
  ),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ol: ({ children }: any) => (
    <ol
      className={css({
        marginBottom: "0.75rem",
        listStyleType: "decimal",
        paddingLeft: "1.25rem",
      })}
    >
      {children}
    </ol>
  ),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  li: ({ children }: any) => (
    <li className={css({ marginBottom: "0.25rem" })}>{children}</li>
  ),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  h1: ({ children }: any) => (
    <h1
      className={css({
        marginTop: "1rem",
        marginBottom: "0.5rem",
        fontSize: "1.125rem",
        fontWeight: 600,
      })}
    >
      {children}
    </h1>
  ),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  h2: ({ children }: any) => (
    <h2
      className={css({
        marginTop: "0.75rem",
        marginBottom: "0.5rem",
        fontSize: "1rem",
        fontWeight: 600,
      })}
    >
      {children}
    </h2>
  ),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  h3: ({ children }: any) => (
    <h3
      className={css({
        marginTop: "0.5rem",
        marginBottom: "0.25rem",
        fontSize: "0.875rem",
        fontWeight: 600,
      })}
    >
      {children}
    </h3>
  ),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  strong: ({ children }: any) => (
    <strong className={css({ fontWeight: 600 })}>{children}</strong>
  ),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  em: ({ children }: any) => (
    <em className={css({ fontStyle: "italic" })}>{children}</em>
  ),
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
    <blockquote
      className={css({
        marginBlock: "0.5rem",
        borderLeft: "2px solid var(--border)",
        paddingLeft: "0.75rem",
        color: "var(--muted-foreground)",
      })}
    >
      {children}
    </blockquote>
  ),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: ({ children }: any) => (
    <div
      className={css({
        marginBlock: "0.75rem",
        maxWidth: "100%",
        overflowX: "auto",
      })}
    >
      <table
        className={css({
          width: "max-content",
          minWidth: "100%",
          borderCollapse: "collapse",
          fontSize: "0.875rem",
        })}
      >
        {children}
      </table>
    </div>
  ),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  thead: ({ children }: any) => (
    <thead
      className={css({
        borderBottom: "1px solid var(--border)",
        backgroundColor: "color-mix(in srgb, var(--muted) 50%, transparent)",
      })}
    >
      {children}
    </thead>
  ),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  th: ({ children }: any) => (
    <th
      className={css({
        paddingInline: "0.75rem",
        paddingBlock: "0.5rem",
        textAlign: "left",
        fontWeight: 600,
      })}
    >
      {children}
    </th>
  ),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  td: ({ children }: any) => (
    <td
      className={css({
        borderBottom: "1px solid var(--border)",
        paddingInline: "0.75rem",
        paddingBlock: "0.5rem",
      })}
    >
      {children}
    </td>
  ),
};

const MarkdownText = memo(function MarkdownText({
  text,
  documentScope,
  isRunning,
}: {
  text: string;
  documentScope: string | OpenUIDocumentScope;
  isRunning?: boolean;
}) {
  const developerMode = useContext(DeveloperChatDetails);
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
          if (seg.format === "document") {
            if (seg.error) {
              return <div key={`${seg.metadata.id}-${i}`} role="alert" className={css({ marginBlock: "0.75rem", borderRadius: "0.5rem", background: "color-mix(in srgb, var(--destructive) 10%, transparent)", padding: "0.75rem", color: "var(--destructive)" })}>
                This activity could not be displayed. Ask Keating to try it again.
                {developerMode && <details><summary>Development details</summary>{seg.error}</details>}
              </div>;
            }
            return <KeatingOpenUIRenderer
              developerMode={developerMode}
              key={`${seg.metadata.id}-${seg.metadata.revision}-${i}`}
              document={seg.document}
              metadata={seg.metadata}
              isStreaming={!seg.complete}
			  sourceComplete={seg.complete}
            />;
          }
          return (
            <KeatingOpenUIRenderer
              developerMode={developerMode}
              key={`${seg.metadata.id}-${seg.metadata.revision}-${i}`}
              program={seg.program}
			  source={seg.rawProgram}
              metadata={seg.metadata}
			  sourceComplete={seg.complete}
              isStreaming={Boolean(
                isRunning && seg.program !== seg.rawProgram.trimEnd(),
              )}
            />
          );
        }
        return parseInteractiveSegments(seg.content)
          .filter(
            (legacy) => legacy.type !== "question" && legacy.type !== "quiz",
          )
          .map((legacy, legacyIndex) => {
            const card = renderInteractiveSegment(
              legacy,
              `${i}-${legacyIndex}`,
            );
            if (card !== null) return card;
            return <MarkdownBlock
              key={`${i}-${legacyIndex}`}
              content={legacy.type === "text" ? legacy.content : ""}
              streaming={isRunning}
            />;
          });
      })}
      {isRunning ? (
        <span className={cx(pulseClass, css({ marginLeft: "0.125rem" }))}>
          |
        </span>
      ) : null}
    </div>
  );
});

export function ReasoningPart({
  text,
  show = true,
  defaultOpen = false,
}: {
  text: string;
  status?: { type: string };
  show?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    setOpen(defaultOpen);
  }, [defaultOpen]);

  if (!show) return null;
  if (!text.trim()) return null;
  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
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
        <span
          className={css({
            display: "flex",
            alignItems: "center",
            gap: "0.375rem",
          })}
        >
          <ChevronRight
            size={13}
            aria-hidden="true"
            className={css({
              flexShrink: 0,
              transitionProperty: "transform",
              transitionDuration: "150ms",
              transform: open ? "rotate(90deg)" : "rotate(0deg)",
            })}
          />
          <span>Reasoning</span>
        </span>
        <CopyButton text={text} label="Copy" />
      </summary>
      <div
        className={cx(
          "keating-reasoning-markdown",
          css({
            marginTop: "0.5rem",
            overflowWrap: "break-word",
          }),
        )}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeKatex]}
          components={MARKDOWN_COMPONENTS}
        >
          {normalizeLatexDelimiters(text)}
        </ReactMarkdown>
      </div>
    </details>
  );
}

function formatToolResult(result: unknown) {
  if (result === undefined) return "";
  if (typeof result === "string") {
    // Flue persists JSON tool outputs as text in its model-facing result.
    try {
      const parsed: unknown = JSON.parse(result);
      if (parsed && typeof parsed === "object" && "content" in parsed && Array.isArray(parsed.content)) return formatToolResult(parsed.content);
    } catch { /* Plain text tool results need no decoding. */ }
    return result;
  }
  if (result && typeof result === "object" && "content" in result) {
    return formatToolResult(result.content);
  }
  if (Array.isArray(result)) {
    const text = result
      .map((part) => {
        if (part?.type === "text" && typeof part.text === "string")
          return part.text;
        return "";
      })
      .filter(Boolean)
      .join("\n");
    if (text) return formatToolResult(text);
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
  onImageGenerationModelSelect,
}: {
  toolName: string;
  args?: unknown;
  result?: unknown;
  isError?: boolean;
  status?: { type: string };
  showDetails?: boolean;
  showRawErrors?: boolean;
  onImageGenerationModelSelect?: () => void;
}) {
  const resultText = formatToolResult(result);
  const state = resolveToolVisualState({ result, isError, status });

  // Older tool results can contain legacy quiz, goal, or animation tags. Keep
  // them renderable for saved sessions, independent of the details toggle.
  const interactiveCards =
    state === "success" ? extractInteractiveCards(resultText) : [];
  if (interactiveCards.length > 0) {
    return <div className={css({ width: "100%" })}>{interactiveCards}</div>;
  }

  const stateClass =
    state === "error"
      ? css({
          borderColor:
            "color-mix(in srgb, var(--destructive) 60%, transparent)",
          backgroundColor:
            "color-mix(in srgb, var(--destructive) 10%, transparent)",
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
      <div
        className={css({
          display: "flex",
          minWidth: 0,
          flexWrap: "wrap",
          alignItems: "center",
          gap: "0.5rem",
        })}
      >
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
            backgroundColor:
              "color-mix(in srgb, var(--background) 70%, transparent)",
            paddingInline: "0.375rem",
            paddingBlock: "0.125rem",
            fontFamily: "var(--mono-body)",
            color: "var(--foreground)",
          })}
        >
          {toolName}
        </span>
        <span
          className={css({
            marginLeft: "auto",
            flexShrink: 0,
            textTransform: "uppercase",
            letterSpacing: "0.025em",
          })}
        >
          {state}
        </span>
      </div>
      {state === "running" && toolName === "generate_image" && (
        <StreamingImagePreview />
      )}
      {state === "running" && toolName === "animate" && (
        <StreamingAnimationPreview />
      )}
      {showDetails &&
      args !== undefined &&
      Object.keys(args as Record<string, unknown>).length > 0 ? (
        <details
          open
          className={css({
            marginTop: "0.5rem",
            color: "color-mix(in srgb, var(--foreground) 80%, transparent)",
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
            })}
          >
            <span
              className={css({
                display: "inline-flex",
                alignItems: "center",
                gap: "0.25rem",
              })}
            >
              <ChevronRight size={13} />
              Arguments
            </span>
            <CopyButton text={JSON.stringify(args, null, 2)} label="Copy" />
          </summary>
          <JsonCrackBlock value={args} maxHeight="16rem" title="Arguments" />
        </details>
      ) : null}
      {state === "error" ? (
        <div className={css({ marginTop: "0.5rem" })}>
          {classifiedError && (
            <ErrorBadge
              classified={classifiedError}
              rawMessage={resultText}
              showRaw={!!showRawErrors}
            />
          )}
          {toolName === "generate_image" && onImageGenerationModelSelect && (
            <ImageGenerationRetryButton
              onRetry={onImageGenerationModelSelect}
            />
          )}
          {showDetails && classifiedError && diagnosticsSummaryForFailure(classifiedError, `${toolName} tool`) && (
            <ErrorDiagnosticsActions summary={diagnosticsSummaryForFailure(classifiedError, `${toolName} tool`)!} />
          )}
        </div>
      ) : showDetails && resultText ? (
        <div
          className={css({ marginTop: "0.5rem", color: "var(--foreground)" })}
        >
          {typeof result === "object" && result !== null ? (
            <JsonCrackBlock value={result} maxHeight="16rem" title="Result" />
          ) : (
            <>
              <div
                className={css({
                  marginBottom: "0.25rem",
                  display: "flex",
                  justifyContent: "flex-end",
                })}
              >
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

function messagePartComponents(
  showToolUi: boolean,
  showRawErrors: boolean,
  showReasoning: boolean,
  autoExpandReasoning: boolean,
  onImageGenerationModelSelect?: () => void,
) {
  return {
    Text: (props: any) => (
      <StreamingTextPart {...props} showRawErrors={showRawErrors} />
    ),
    Image: ImagePart,
    File: FilePart,
    Reasoning: (props: Parameters<typeof ReasoningPart>[0]) => (
      <ReasoningPart
        {...props}
        show={showReasoning}
        defaultOpen={autoExpandReasoning}
      />
    ),
    tools: {
      Fallback: (props: Parameters<typeof ToolPart>[0]) =>
        isWebSearchToolName(props.toolName) ? (
          <WebSearchPart {...props} />
        ) : (
          <ToolPart
            {...props}
            showDetails={showToolUi}
            showRawErrors={showRawErrors}
            onImageGenerationModelSelect={onImageGenerationModelSelect}
          />
        ),
    },
  };
}

function displayTextFromAgentText(text: string): string {
  const match = text.match(/^<attachment name="([^"]+)"/);
  if (match) return `[attached file: ${match[1]}]`;
  return text;
}

function assistantContentFromAgentContent(content: unknown) {
  if (typeof content === "string")
    return [{ type: "text" as const, text: content }];
  if (!Array.isArray(content)) return [{ type: "text" as const, text: "" }];
  return content
    .map((part: any) => {
      if (part?.type === "text") {
        return {
          type: "text" as const,
          text: displayTextFromAgentText(part.text ?? ""),
        };
      }
      if (part?.type === "audio") return {type: "file" as const, mimeType: part.mimeType, data: `data:${part.mimeType};base64,${part.data}`, filename: part.filename};
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
        toolCall.__toolResultReceived = true;
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
  if (!Array.isArray(content))
    return typeof content === "string" && content.trim().length > 0;
  return content.some((part: any) => {
    if (part?.type === "text")
      return typeof part.text === "string" && part.text.trim().length > 0;
    if (part?.type === "thinking")
      return (
        typeof part.thinking === "string" && part.thinking.trim().length > 0
      );
    if (part?.type === "reasoning")
      return typeof part.text === "string" && part.text.trim().length > 0;
    if (part?.type === "toolCall") return true;
    if (part?.type === "image") return true;
    return false;
  });
}

function isSameStreamingAssistantMessage(
  message: unknown,
  streamingMessage: unknown,
): boolean {
  const left = message as any;
  const right = streamingMessage as any;
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.role !== "assistant" || right.role !== "assistant") return false;
  if (left.timestamp !== right.timestamp) return false;
  return (
    JSON.stringify(left.content ?? null) ===
    JSON.stringify(right.content ?? null)
  );
}

function visibleAgentMessages(
  agent: FlueConversation | null,
  speechEnabled: boolean,
): AgentMessage[] {
  if (!agent) return [];
  const messages = [...agent.context.messages];
  const streamingMessage = agent.context.streamingMessage as any;
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
      return (
        candidateKey === key ||
        candidateKey.includes(key) ||
        key.includes(candidateKey)
      );
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

function assistantHasPendingToolCalls(content: unknown): boolean {
  if (!Array.isArray(content)) return false;
  return content.some(toolCallIsPending);
}

function assistantHasToolCalls(content: unknown): boolean {
  return (
    Array.isArray(content) &&
    content.some((part: any) => part?.type === "toolCall")
  );
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
    !(
      assistantHasToolCalls(msg.content) &&
      !assistantHasPendingToolCalls(msg.content)
    ) &&
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
    const content = normalizeAssistantContentParts(
      Array.isArray(msg.content)
        ? msg.content.flatMap((part: any) => {
            if (part?.type === "thinking")
              return [
                { type: "reasoning" as const, text: part.thinking ?? "" },
              ];
            if (part?.type === "toolCall") {
              const missingResult = toolCallEndedWithoutResult(
                part,
                isRunning && isLastMessage,
              );
              return [
                {
                  type: "tool-call" as const,
                  toolCallId: part.id ?? `tool-${index}`,
                  toolName: part.name ?? "tool",
                  args: part.arguments ?? {},
                  argsText: JSON.stringify(part.arguments ?? {}),
                  result: missingResult
                    ? MISSING_TOOL_RESULT_MESSAGE
                    : foldedToolResult(part),
                  isError: part.__toolError === true || missingResult,
                },
              ];
            }
            return assistantTextParts(part?.text ?? "");
          })
        : assistantTextParts(textFromContent(msg.content)),
    );

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

    if (
      status.type === "incomplete" &&
      status.reason === "cancelled" &&
      !content.some((c: any) => c.type === "text" && c.text)
    ) {
      content.unshift({
        type: "text" as const,
        text: msg.errorMessage ?? "Response interrupted before it finished.",
      });
    }

    const authError = authErrorFromAgentMessage(msg, fallbackProvider);
    const llmFailure =
      status.type === "incomplete"
        ? classifyLlmError(
            msg.errorMessage ??
              (status.reason === "cancelled"
                ? "Request aborted"
                : "Assistant response failed"),
          )
        : null;
    const retryAttempts =
      typeof msg.__keatingRetryAttempts === "number"
        ? Math.max(1, Math.round(msg.__keatingRetryAttempts))
        : 1;
    const retryable =
      isLastMessage &&
      status.type === "incomplete" &&
      llmFailure?.category !== "auth" &&
      llmFailure?.category !== "billing" &&
      llmFailure?.category !== "context-length" &&
      llmFailure?.category !== "invalid-request" &&
      llmFailure?.category !== "safety";
    return {
      id,
      role: "assistant",
      createdAt: timestamp,
      status,
      content,
      metadata:
        authError ||
        llmFailure ||
        retryable ||
        msg.__keatingPrefillStatus === true
          ? {
              custom: {
                keatingAuthError: authError,
                keatingLlmFailure: llmFailure,
                keatingProvider: msg.provider ?? fallbackProvider,
                keatingFailureMessage: msg.errorMessage,
                keatingFailedLastTurn: isLastMessage && status.type === "incomplete",
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
    const missingResult =
      !hasMeaningfulToolResult(msg.content) &&
      !hasMeaningfulToolResult(msg.details);
    const failed = msg.isError === true || missingResult;
    const summary = missingResult
      ? MISSING_TOOL_RESULT_MESSAGE
      : textFromContent(msg.content) || JSON.stringify(msg.details, null, 2);
    const id = `tool-${index}-${msg.toolCallId ?? ""}`;
    const errorPrefix = failed ? ERROR_TEXT_PREFIX : "";
    return {
      id,
      role: "assistant",
      createdAt: timestamp,
      status: failed
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

/** Render the SDK projection directly: stable Flue identities and explicit tool states. */
function flueThreadMessage(message: FlueConversationMessage, running: boolean): ThreadMessageLike {
  const content = message.parts.flatMap((part): any[] => {
    if (part.type === "text") return assistantTextParts(part.text);
    if (part.type === "reasoning") return [{ type: "reasoning", text: part.text }];
    if (part.type === "file" && part.url) return part.mediaType?.startsWith("audio/")
      ? [{type: "file", mimeType: part.mediaType, data: part.url, filename: part.filename}]
      : [{ type: "image", image: part.url }];
    if (part.type === "dynamic-tool") {
      const output = part.state === "output-available" ? part.output : undefined;
      return [{ type: "tool-call", toolCallId: part.toolCallId, toolName: part.toolName,
        args: part.input, argsText: JSON.stringify(part.input),
        result: part.state === "output-error" ? part.errorText : output,
        isError: part.state === "output-error" }];
    }
    return [];
  });
  const failed = message.settlement?.outcome;
  const active = running && message.parts.some(part =>
    ((part.type === "text" || part.type === "reasoning") && part.state === "streaming") ||
    (part.type === "dynamic-tool" && part.state === "input-available"));
  return { id: message.id, role: message.role === "user" ? "user" : "assistant", content,
    ...(typeof message.metadata?.timestamp === "number" ? { createdAt: new Date(message.metadata.timestamp) } : {}),
    ...(message.role !== "user" ? { status: failed ? { type: "incomplete", reason: failed === "aborted" ? "cancelled" : "error" } :
      active ? { type: "running" } : { type: "complete", reason: "stop" } } : {}),
    metadata: { custom: { ...message.metadata, keatingRetryable: !!failed } },
  } as ThreadMessageLike;
}

function messagesFromLiveTranscript(
  agent: FlueConversation,
  turns: LiveTranscriptTurn[],
): AgentMessage[] {
  const messages: AgentMessage[] = [];
  let timestamp = Date.now();
  for (const turn of turns) {
    if (turn.user.trim()) {
      messages.push({
        role: "user",
        content: [{ type: "text", text: turn.user.trim() }],
        timestamp: timestamp++,
      } as AgentMessage);
    }
    if (turn.assistant.trim()) {
      messages.push({
        role: "assistant",
        content: [{ type: "text", text: turn.assistant.trim() }],
        api: agent.context.model.api,
        provider: agent.context.model.provider,
        model: agent.context.model.id,
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: timestamp++,
      } as AgentMessage);
    }
  }
  return messages;
}

function makePrefillStatusMessage(agent: FlueConversation, step: number): AgentMessage {
  return {
    role: "assistant",
    content: [
      {
        type: "text",
        text: PREFILL_STATUS_LINES[step % PREFILL_STATUS_LINES.length],
      },
    ],
    api: agent.context.model.api,
    provider: agent.context.model.provider,
    model: agent.context.model.id,
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
  heading,
  description,
}: {
  onSelect: (
    text: string,
    context: Pick<StarterPrompt, "label" | "domain"> & { position: number },
  ) => void;
  initialPrompts?: readonly StarterPrompt[];
  /** Currently selected chat model; enables the personalized opening. */
  model?: Model<Api> | null;
  heading?: string;
  description?: string;
}) {
  const [prompts, setPrompts] = useState(() =>
    initialPrompts
      ? [...initialPrompts]
      : pickDiverseStarterPrompts(STARTER_PROMPTS, 3),
  );
  const [greeting, setGreeting] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const posthog = usePostHog();
  const exposureCapturedRef = useRef(false);

  useEffect(() => {
    if (exposureCapturedRef.current) return;
    exposureCapturedRef.current = true;
    posthog.capture("starter_prompts_viewed", {
      prompt_count: prompts.length,
      model: model ? `${model.provider}/${model.id}` : "unavailable",
      provider: model?.provider ?? "unavailable",
    });
  }, [model, posthog, prompts.length]);

  // With a usable model, replace the generic header with a greeting tailored
  // to the learner's history and surface model-suggested next steps. Without
  // one (or without history) the generic experience stays.
  useEffect(() => {
    if (!model || initialPrompts?.length) return;
    let cancelled = false;
    getTailoredOpening(model)
      .then((opening) => {
        if (cancelled || !opening) return;
        setGreeting(opening.greeting);
        posthog.capture("tailored_opening_loaded", {
          prompt_count: opening.prompts.length,
          model: `${model.provider}/${model.id}`,
          provider: model.provider,
        });
        if (opening.prompts.length > 0) {
          setPrompts((prev) => {
            const seen = new Set(prev.map((p) => p.text));
            return [
              ...opening.prompts.filter((p) => !seen.has(p.text)),
              ...prev,
            ];
          });
        }
      })
      .catch((error) => {
        console.warn("Tailored opening unavailable:", error);
      });
    return () => {
      cancelled = true;
    };
  }, [initialPrompts, model?.provider, model?.id, posthog]);

  const remaining = STARTER_PROMPTS.filter(
    (p) => !prompts.some((existing) => existing.text === p.text),
  );
  const exhausted = remaining.length === 0;

  const appendMore = (count = 3) => {
    if (remaining.length === 0) return false;
    setPrompts((prev) => [
      ...prev,
      ...pickDiverseStarterPrompts(remaining, count),
    ]);
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
      <div className={css({ maxWidth: "36rem", textAlign: "center" })}>
        <h1
          className={css({
            fontSize: "1rem",
            fontWeight: 600,
            lineHeight: 1.35,
            color: "var(--foreground)",
          })}
        >
          {heading ?? greeting ?? "What do you want to understand?"}
        </h1>
        <p
          className={css({
            marginTop: "0.25rem",
            fontSize: "0.8125rem",
            lineHeight: 1.5,
            color: "var(--muted-foreground)",
          })}
        >
          {description ??
            "Ask in your own words or choose a starting point. Keating will begin from what you already know."}
        </p>
      </div>
      <div
        className={css({
          display: "flex",
          width: "100%",
          minWidth: 0,
          alignItems: "center",
          gap: "0.25rem",
        })}
      >
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
          <ChevronRight
            size={14}
            className={css({ transform: "rotate(180deg)" })}
          />
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
          {prompts.map((p, position) => (
            <button
              key={p.text}
              type="button"
              onClick={() =>
                onSelect(p.text, { label: p.label, domain: p.domain, position })
              }
              className={cx(
                srInteractiveClass,
                css({
                  width: "min(13rem, calc(100vw - 7rem))",
                  flexShrink: 0,
                  scrollSnapAlign: "start",
                  borderRadius: "0.5rem",
                  border: "1px solid var(--border)",
                  backgroundColor:
                    "color-mix(in srgb, var(--muted) 30%, transparent)",
                  paddingInline: "0.75rem",
                  paddingBlock: "0.625rem",
                  textAlign: "left",
                  _hover: {
                    borderColor: "var(--primary)",
                    backgroundColor:
                      "color-mix(in srgb, var(--primary) 10%, transparent)",
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
              <span
                className={css({
                  display: "block",
                  fontSize: "0.75rem",
                  lineHeight: 1.375,
                })}
              >
                {p.text}
              </span>
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
                    backgroundColor:
                      "color-mix(in srgb, var(--primary) 5%, transparent)",
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
  { value: "xhigh", label: "Extra high", short: "XHigh" },
  { value: "max", label: "Maximum", short: "Max" },
];

/**
 * The composer's "+" menu.
 *
 * The action row had grown to a model button, a reasoning button, a paperclip
 * and two voice controls, which on a phone left almost no room for the thing
 * you are actually there to do. Everything that is a setting rather than an
 * action folds in here; only voice and send stay on the row.
 */
function ComposerActionsMenu({
  modelLabel,
  onModelSelect,
  thinkingLevel,
  onThinkingLevelChange,
  thinkingDisabled,
}: {
  modelLabel: string;
  onModelSelect?: () => void;
  thinkingLevel: ThinkingLevel;
  onThinkingLevelChange: (level: ThinkingLevel) => void;
  thinkingDisabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [reasoningOpen, setReasoningOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const reasoning =
    REASONING_OPTIONS.find((option) => option.value === thinkingLevel) ??
    REASONING_OPTIONS[3];

  useEffect(() => {
    if (!open) return;
    const handlePointer = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
        setReasoningOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Escape backs out one level at a time rather than closing everything,
      // so a mis-tap on the submenu does not lose the menu too.
      if (reasoningOpen) setReasoningOpen(false);
      else setOpen(false);
    };
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [open, reasoningOpen]);

  const itemClass = css({
    display: "flex",
    width: "100%",
    alignItems: "center",
    gap: "0.625rem",
    borderRadius: "0.375rem",
    paddingInline: "0.625rem",
    paddingBlock: "0.5rem",
    textAlign: "left",
    fontSize: "0.8125rem",
    color: "var(--foreground)",
    cursor: "pointer",
    _hover: {
      backgroundColor: "var(--accent)",
      color: "var(--accent-foreground)",
    },
    _disabled: { opacity: 0.5, cursor: "not-allowed" },
  });
  const trailingClass = css({
    marginLeft: "auto",
    fontSize: "0.75rem",
    color: "var(--muted-foreground)",
    maxWidth: "7rem",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  });

  return (
    <div ref={ref} className={css({ position: "relative", flexShrink: 0 })}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="More actions"
        aria-label="More actions"
        className={cx(
          composerIconButtonClass,
          open
            ? css({
                backgroundColor: "var(--accent)",
                color: "var(--accent-foreground)",
              })
            : undefined,
        )}
      >
        <Plus size={17} />
      </button>

      {open ? (
        <div
          role="menu"
          className={cx(
            "font-terminal",
            css({
              position: "absolute",
              left: 0,
              bottom: "100%",
              zIndex: 50,
              marginBottom: "0.375rem",
              minWidth: "14rem",
              borderRadius: "0.5rem",
              border: "1px solid var(--border)",
              backgroundColor: "var(--background)",
              boxShadow: "var(--shadow-card, 0 8px 24px rgba(0,0,0,0.18))",
              padding: "0.25rem",
              display: "flex",
              flexDirection: "column",
              gap: "0.125rem",
            }),
          )}
        >
          {/*
           * The attachment trigger has to be the library's own element —
           * it owns the hidden file input — so it is styled to match the
           * neighbouring items rather than reimplemented.
           */}
          <ComposerPrimitive.AddAttachment
            className={itemClass}
            onClick={() => setOpen(false)}
          >
            <Paperclip
              size={15}
              className={css({
                flexShrink: 0,
                color: "var(--muted-foreground)",
              })}
            />
            Attach files
          </ComposerPrimitive.AddAttachment>

          {onModelSelect ? (
            <button
              type="button"
              role="menuitem"
              className={itemClass}
              onClick={() => {
                setOpen(false);
                onModelSelect();
              }}
            >
              <Cpu
                size={15}
                className={css({
                  flexShrink: 0,
                  color: "var(--muted-foreground)",
                })}
              />
              Model
              <span className={trailingClass}>{modelLabel}</span>
            </button>
          ) : null}

          <button
            type="button"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={reasoningOpen}
            disabled={thinkingDisabled}
            className={itemClass}
            onClick={() => setReasoningOpen((value) => !value)}
          >
            <Lightbulb
              size={15}
              className={css({
                flexShrink: 0,
                color: "var(--muted-foreground)",
              })}
            />
            Reasoning
            <span className={trailingClass}>{reasoning.short}</span>
          </button>

          {reasoningOpen ? (
            <div
              className={css({
                display: "flex",
                flexDirection: "column",
                gap: "0.125rem",
                paddingLeft: "1.5rem",
              })}
            >
              {REASONING_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={option.value === thinkingLevel}
                  className={itemClass}
                  onClick={() => {
                    onThinkingLevelChange(option.value);
                    setReasoningOpen(false);
                    setOpen(false);
                  }}
                >
                  {option.label}
                  {option.value === thinkingLevel ? (
                    <Check
                      size={14}
                      className={css({
                        marginLeft: "auto",
                        color: "var(--primary)",
                      })}
                    />
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
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
      <span className={css({ fontWeight: 500, color: "var(--foreground)" })}>
        URL detected.
      </span>{" "}
      To let Keating read current web pages, use a Google Gemini model with
      Google web grounding enabled
      {needsKey ? " and add a Google API key" : ""}.
      {needsKey && (
        <>
          {" "}
          Get one from{" "}
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
      {needsGrounding &&
        " Turn on Settings → Interface → Google web grounding."}
      {needsGoogleModel &&
        " Select a Google Gemini model for grounded web results."}
    </div>
  );
}

/**
 * Thread rows for assistant-ui. Without native Flue history the legacy agent
 * messages are projected directly; otherwise legacy, native and local messages
 * are merged by time.
 */
function projectThreadMessages(
  agent: FlueConversation | null,
  messages: AgentMessage[],
  isRunning: boolean,
  speechEnabled: boolean,
  provider: string | undefined,
): ThreadMessageLike[] {
  const native = agent?.getSnapshot().conversation;
  if (!native || !agent) return messages.map((message, index) => toAssistantMessage(message, index, messages.length, isRunning, provider));
  const legacy = mergeConsecutiveAssistantMessages(foldToolResults(filterSpeechMessages(agent.legacyMessages, speechEnabled)));
  const local = mergeConsecutiveAssistantMessages(foldToolResults(filterSpeechMessages(agent.localMessages, speechEnabled)));
  // Native history replaces the legacy projection, but preparation and
  // provider latency still need the same immediate assistant activity cue.
  const pendingStatus = messages.at(-1) as (AgentMessage & { __keatingPrefillStatus?: boolean }) | undefined;
  if (pendingStatus?.__keatingPrefillStatus) local.push(pendingStatus);
  const localError = local.some(message => message.role === "assistant" && ["error", "aborted"].includes(message.stopReason));
  const visibleNative = native.messages.filter(message => shouldRenderFlueMessage(message) && !(localError && message.settlement));
  const totalMessages = legacy.length + visibleNative.length + local.length;
  return [
    ...legacy.map((message, index) => toAssistantMessage(message, index, totalMessages, false, provider)),
    ...visibleNative.map(message => flueThreadMessage(message, isRunning)),
    ...local.map((message, index) => toAssistantMessage(message, legacy.length + visibleNative.length + index, totalMessages, false, provider)),
  ].sort((left, right) => (left.createdAt?.getTime() ?? 0) - (right.createdAt?.getTime() ?? 0));
}

function AssistantThread({
  agent,
  callbacks,
  version,
  speechEnabled,
  responseComparison,
  initialPrompts,
  emptyStateTitle,
  emptyStateDescription,
  pendingPrompt,
}: {
  agent: FlueConversation | null;
  callbacks: ChatPanelSetupCallbacks;
  version: number;
  speechEnabled: boolean;
  responseComparison?: ReactNode;
  initialPrompts?: readonly StarterPrompt[];
  emptyStateTitle?: string;
  emptyStateDescription?: string;
  pendingPrompt?: string;
}) {
  const posthog = usePostHog();
  const [uiSettings, setUiSettings] = useState(() => loadKeatingUiSettings());
  const [localVersion, setLocalVersion] = useState(0);
  const [composerHasUrl, setComposerHasUrl] = useState(false);
  const [voiceComposerOpen, setVoiceComposerOpen] = useState(false);
  const [micRecording, setMicRecording] = useState(false);
  const [dismissedQuizId, setDismissedQuizId] = useState<string | null>(null);
  const hasGoogleKey = useGoogleKeyForUrls(composerHasUrl);
  const isRunning = agent?.getSnapshot().running ?? false;
  const loadingStep = useLoadingStep(isRunning);
  const draftStatus = useSyncExternalStore(subscribeTeachingDraftStatus,
    () => getTeachingDraftStatus(agent?.sessionId), () => null);
  const draftActive = teachingDraftIsActive(draftStatus);
  const currentThinkingLevel =
    agent?.context.thinkingLevel ?? callbacks.thinkingLevel ?? "medium";
  const [selectedThinkingLevel, setSelectedThinkingLevel] =
    useState<ThinkingLevel>(currentThinkingLevel);
  useEffect(() => {
    setSelectedThinkingLevel(currentThinkingLevel);
  }, [currentThinkingLevel]);
  const preserveLiveConversation = useCallback(
    async (turns: LiveTranscriptTurn[]) => {
      if (!agent || turns.length === 0) return;
      const messages = messagesFromLiveTranscript(agent, turns);
      if (messages.length === 0) return;
      agent.context.messages.push(...messages);
      setLocalVersion((current) => current + 1);
      await callbacks.onLocalMessagesChanged?.();
    },
    [agent, callbacks],
  );
  const handleThinkingLevelChange = useCallback(
    (level: ThinkingLevel) => {
      setSelectedThinkingLevel(level);
      callbacks.onThinkingLevelChange?.(level);
    },
    [callbacks],
  );
  const messages = useMemo(() => {
    const visibleMessages = visibleAgentMessages(agent, speechEnabled);
    const lastMessage = visibleMessages.at(-1) as any;
    if (agent && isRunning && !draftActive && lastMessage?.role === "user") {
      return [...visibleMessages, makePrefillStatusMessage(agent, loadingStep)];
    }
    return visibleMessages;
  }, [agent, version, localVersion, speechEnabled, isRunning, loadingStep, draftActive]);
  const activeQuestion = useMemo(
    () => extractActiveQuestion(messages),
    [messages],
  );
  const activeQuiz = useMemo(() => extractActiveQuiz(messages), [messages]);
  const visibleActiveQuiz =
    activeQuiz && activeQuiz.slug !== dismissedQuizId ? activeQuiz : null;
  const components = useMemo(
    () =>
      messagePartComponents(
        uiSettings.showDeveloperDetails && uiSettings.showToolUi,
        uiSettings.showDeveloperDetails && uiSettings.showRawErrors,
        uiSettings.showDeveloperDetails && uiSettings.showReasoning,
        uiSettings.autoExpandReasoning,
        callbacks.onImageGenerationModelSelect,
      ),
    [
      uiSettings.showDeveloperDetails,
      uiSettings.showToolUi,
      uiSettings.showRawErrors,
      uiSettings.showReasoning,
      uiSettings.autoExpandReasoning,
      callbacks.onImageGenerationModelSelect,
    ],
  );
  const modelRef = useRef(agent?.context.model);
  if (agent) modelRef.current = agent.context.model;

  const threadMessages = useMemo(
    () => projectThreadMessages(agent, messages, isRunning, speechEnabled, modelRef.current?.provider),
    [agent, version, localVersion, messages, isRunning, speechEnabled],
  );
  const mascotState = chatMascotState({ messages: threadMessages, running: isRunning, recording: micRecording });
  const convertMessage = useCallback((message: ThreadMessageLike) => message, []);

  const onCancel = useCallback(async () => {
    posthog.capture("message_cancelled", {});
    clearPendingChatTurn(callbacks.sessionId);
    agent?.cancel();
  }, [agent, posthog, callbacks.sessionId]);

  const [quizGrades, setQuizGrades] = useState<
    Record<string, QuizQuestionGrade[]>
  >({});
  const quizGradesContextValue = useMemo<QuizGradesContextValue>(
    () => ({
      grades: quizGrades,
      applyGrades: (resultId, grades) =>
        setQuizGrades((prev) => ({ ...prev, [resultId]: grades })),
    }),
    [quizGrades],
  );

  // Learner submissions (quiz results, question answers, remediation/reframe
  // requests, OpenUI responses) can fire mid-reply, where onNew refuses them.
  // They are retained for this session and delivered once it is idle.
  const { onNew, sendText, submitLearnerTurn, handleOpenUIAction } = useLearnerDelivery({
    agent,
    callbacks,
    isRunning,
    onLocalMessagesShown: () => setLocalVersion((current) => current + 1),
    onSendStarted: () => setComposerHasUrl(false),
  });
  useQuizConversationEvents({ agent, submitLearnerTurn });

  const storeAdapter = useMemo(
    () => ({
      messages: threadMessages,
      isRunning,
      convertMessage,
	  onNew: async (message: AppendMessage) => {
		await onNew(message);
	  },
      onCancel,
      adapters: {
        attachments: keatingAttachmentAdapter,
      },
    }),
    [threadMessages, isRunning, convertMessage, onNew, onCancel],
  );

  const runtime = useExternalStoreRuntime<ThreadMessageLike>(storeAdapter);
  const modelLabel = modelRef.current?.name ?? modelRef.current?.id ?? "Model";
  const selectedProvider = modelRef.current?.provider;
  const usingGoogleModel = selectedProvider === "google";

  useEffect(() => {
    if (!loadKeatingUiSettings().showDeveloperDetails) clearTeachingDraftContents();
    return subscribeKeatingUiSettings(settings => {
      if (!settings.showDeveloperDetails) clearTeachingDraftContents();
      setUiSettings(settings);
    });
  }, []);


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
        selectedProvider={selectedProvider}
        onFork={callbacks.onFork}
        onModelSelect={callbacks.onModelSelect}
        onRetry={callbacks.onRetry}
      />
    ),
    [components, selectedProvider, callbacks.onFork, callbacks.onModelSelect, callbacks.onRetry],
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
		<OpenUISessionScopeContext.Provider value={callbacks.sessionId}>
			<KeatingOpenUIActionProvider onAction={handleOpenUIAction}>
          <DeveloperChatDetails.Provider value={uiSettings.showDeveloperDetails}>
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
                <div
                  className={css({
                    display: "flex",
                    flex: 1,
                    flexDirection: "column",
                  })}
                >
                  <AuiIf condition={(state) => state.thread.isEmpty}>
                    <SuggestedPrompts
                      model={agent?.context.model ?? null}
                      initialPrompts={initialPrompts}
                      heading={emptyStateTitle}
                      description={emptyStateDescription}
                      onSelect={(text, context) => {
                        posthog.capture("suggested_prompt_clicked", {
                          prompt_label: context.label,
                          prompt_domain: context.domain,
                          prompt_position: context.position,
                          prompt_origin:
                            context.domain === "tailored"
                              ? "tailored"
                              : "starter",
                          model: agent
                            ? `${agent.context.model.provider}/${agent.context.model.id}`
                            : "unavailable",
                          provider:
                            agent?.context.model.provider ?? "unavailable",
                        });
                        sendText(text);
                      }}
                    />
                  </AuiIf>
                  <ThreadPrimitive.Messages components={threadComponents} />
                  {agent && <DraftReviewStatus sessionId={agent.sessionId} status={draftStatus} showDeveloperDetails={uiSettings.showDeveloperDetails} />}
                </div>
                <ThreadPrimitive.ViewportFooter
                  className={css({
                    position: "sticky",
                    bottom: 0,
                    minWidth: 0,
                    // Keep text and controls on one stable semantic surface.
                    // A translucent footer let the decorative glow and scrolled
                    // content change contrast underneath the helper row.
                    backgroundColor: "var(--background)",
                    paddingTop: "0.75rem",
                  })}
                >
                  {responseComparison}
                  <ActiveInteractionPanels
                    visibleActiveQuiz={visibleActiveQuiz}
                    activeQuestion={activeQuestion}
                    onDismissQuiz={setDismissedQuizId}
                  />
                  <ChatMascotMenu state={mascotState} busy={isRunning || micRecording} />
                  <ThreadComposer
                    pendingPrompt={pendingPrompt}
                    composerHasUrl={composerHasUrl}
                    onComposerHasUrlChange={setComposerHasUrl}
                    hasGoogleKey={hasGoogleKey}
                    groundingEnabled={uiSettings.webSearch === "auto"}
                    usingGoogleModel={usingGoogleModel}
                    modelLabel={modelLabel}
                    callbacks={callbacks}
                    thinkingLevel={selectedThinkingLevel}
                    onThinkingLevelChange={handleThinkingLevelChange}
                    isRunning={isRunning}
                    voiceComposerOpen={voiceComposerOpen}
                    onVoiceComposerOpenChange={setVoiceComposerOpen}
                    onMicRecordingChange={setMicRecording}
                    onConversationComplete={preserveLiveConversation}
                  />
                </ThreadPrimitive.ViewportFooter>
              </ThreadPrimitive.Viewport>
            </ThreadPrimitive.Root>
          </AssistantRuntimeProvider>
          </DeveloperChatDetails.Provider>
			</KeatingOpenUIActionProvider>
		</OpenUISessionScopeContext.Provider>
      </QuizGradesContext.Provider>
    </AuthErrorContext.Provider>
  );
}



/** The open quiz and question form above the composer; submissions go out as window events. */
function ActiveInteractionPanels({
  visibleActiveQuiz,
  activeQuestion,
  onDismissQuiz,
}: {
  visibleActiveQuiz: Quiz | null;
  activeQuestion: ReturnType<typeof extractActiveQuestion>;
  onDismissQuiz: (slug: string) => void;
}) {
  return (
    <>
      {visibleActiveQuiz && (
        <div
          className={css({
            marginInline: "auto",
            marginBottom: "0.375rem",
            width: "100%",
            maxWidth: "56rem",
            overflowX: "hidden",
            maxHeight: "min(55dvh, 30rem)",
            overflowY: "auto",
            overscrollBehavior: "contain",
            paddingInline: "0.375rem",
            sm: {
              marginBottom: "0.5rem",
              maxHeight: "none",
              overflowY: "visible",
              paddingInline: 0,
            },
          })}
        >
          <QuizSessionPanel
            quiz={visibleActiveQuiz}
            onSubmit={(result) => {
              window.dispatchEvent(
                new CustomEvent("keating:quiz-submitted", {
                  detail: quizSubmittedDetail(visibleActiveQuiz, result),
                }),
              );
            }}
            onDismiss={() => {
              onDismissQuiz(visibleActiveQuiz.slug);
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
    </>
  );
}

/** The message composer: attachments, actions menu, voice control, input and send/stop. */
function ThreadComposer({
  pendingPrompt,
  composerHasUrl,
  onComposerHasUrlChange,
  hasGoogleKey,
  groundingEnabled,
  usingGoogleModel,
  modelLabel,
  callbacks,
  thinkingLevel,
  onThinkingLevelChange,
  isRunning,
  voiceComposerOpen,
  onVoiceComposerOpenChange,
  onMicRecordingChange,
  onConversationComplete,
}: {
  pendingPrompt?: string;
  composerHasUrl: boolean;
  onComposerHasUrlChange: (hasUrl: boolean) => void;
  hasGoogleKey: boolean | null;
  groundingEnabled: boolean;
  usingGoogleModel: boolean;
  modelLabel: string;
  callbacks: ChatPanelSetupCallbacks;
  thinkingLevel: ThinkingLevel;
  onThinkingLevelChange: (level: ThinkingLevel) => void;
  isRunning: boolean;
  voiceComposerOpen: boolean;
  onVoiceComposerOpenChange: (open: boolean) => void;
  onMicRecordingChange: (recording: boolean) => void;
  onConversationComplete: (turns: LiveTranscriptTurn[]) => void | Promise<void>;
}) {
  return (
    <>
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
        <ComposerPrefill text={pendingPrompt} />
        <WebGroundingHint
          hasUrl={composerHasUrl}
          hasGoogleKey={hasGoogleKey}
          groundingEnabled={groundingEnabled}
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
          <ComposerActionsMenu
            modelLabel={modelLabel}
            onModelSelect={callbacks.onModelSelect}
            thinkingLevel={thinkingLevel}
            onThinkingLevelChange={onThinkingLevelChange}
            thinkingDisabled={isRunning}
          />
          <SpeechComposerControl
            expanded={voiceComposerOpen}
            onExpandedChange={onVoiceComposerOpenChange}
            onRecordingChange={onMicRecordingChange}
            onConversationComplete={onConversationComplete}
            onRequestCredential={callbacks.onApiKeyRequired}
          />
          {voiceComposerOpen ? null : (
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
                sm: {
                  minHeight: "2.25rem",
                  paddingBlock: "0.5rem",
                },
              })}
              placeholder="Message Keating"
              rows={1}
              onChange={(event) =>
                onComposerHasUrlChange(
                  URL_IN_TEXT_PATTERN.test(
                    event.currentTarget.value,
                  ),
                )
              }
            />
          )}
          {/* Only show Send OR Cancel — never both */}
          {isRunning ? (
            <ComposerPrimitive.Cancel
              aria-label="Stop generating"
              title="Stop generating"
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
              <Square
                size={15}
                className={css({
                  sm: { width: "1rem", height: "1rem" },
                })}
              />
            </ComposerPrimitive.Cancel>
          ) : voiceComposerOpen ? null : (
            <ComposerPrimitive.Send
              aria-label="Send message"
              title="Send message"
              className={cx(
                composerIconButtonClass,
                css({
                  borderColor: "transparent",
                  backgroundColor: "var(--primary)",
                  color: "var(--primary-foreground)",
                }),
              )}
            >
              <Send
                size={15}
                className={css({
                  sm: { width: "1rem", height: "1rem" },
                })}
              />
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
        <span
          className={css({
            display: "none",
            sm: { display: "inline" },
          })}
        >
          enter to send // shift+enter for newline
        </span>
      </div>
    </>
  );
}

function UserMessage({
  components,
  profileImage,
}: {
  components: ReturnType<typeof messagePartComponents>;
  profileImage?: string | null;
}) {
  const ownText = useAuiState(({ message }) => message.content.filter(part => part.type === "text").map(part => part.type === "text" ? part.text : "").join("\n\n"));
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
        <div
          className={cx(
            "chat-avatar chat-avatar-you",
            css({
              display: "none",
              marginTop: "0.125rem",
              sm: { display: "flex" },
            }),
          )}
        >
          {profileImage ? (
            <img src={profileImage} alt="You" />
          ) : (
            <User
              className={css({ width: "1rem", height: "1rem", flexShrink: 0 })}
            />
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
            {ownText && <CopyButton text={ownText} label="Copy your message" variant="ghost" />}
          </div>
          <div
            className={cx(
              "you-bubble",
              css({
                userSelect: "text",
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
          boxShadow:
            "0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)",
        })}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={css({
            marginBottom: "0.75rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          })}
        >
          <h3
            className={css({
              fontSize: "0.875rem",
              fontWeight: 600,
              color: "var(--foreground)",
            })}
          >
            {type === "up" ? "What was helpful?" : "What could be improved?"}
          </h3>
          <button
            type="button"
            className={cx(
              iconButtonClass,
              css({ width: "1.75rem", height: "1.75rem" }),
            )}
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
            backgroundColor:
              "color-mix(in srgb, var(--muted) 30%, transparent)",
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
        <div
          className={css({
            marginTop: "0.75rem",
            display: "flex",
            justifyContent: "flex-end",
            gap: "0.5rem",
          })}
        >
          <button
            type="button"
            className={cx(
              dialogButtonClass,
              css({
                height: "2rem",
                color: "var(--muted-foreground)",
                _hover: {
                  backgroundColor: "var(--accent)",
                  color: "var(--accent-foreground)",
                },
              }),
            )}
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
                _hover: {
                  backgroundColor:
                    "color-mix(in srgb, var(--primary) 90%, transparent)",
                },
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
  selectedProvider,
  onFork,
  onModelSelect,
  onRetry,
}: {
  components: ReturnType<typeof messagePartComponents>;
  selectedProvider?: string;
  onFork?: (forkPoint?: number) => void | Promise<void>;
  onModelSelect?: () => void;
  onRetry?: () => void | Promise<void>;
}) {
  const [feedback, setFeedback] = useState<"up" | "down" | null>(null);
  const [feedbackModalOpen, setFeedbackModalOpen] = useState(false);
  const [feedbackType, setFeedbackType] = useState<"up" | "down">("up");
  const onAuthError = useContext(AuthErrorContext);
  const developerMode = useContext(DeveloperChatDetails);
  const authError = useAuiState(
    ({ message }) =>
      message.metadata.custom?.keatingAuthError as AuthErrorEntry | undefined,
  );
  const canRetry = useAuiState(
    ({ message }) => message.metadata.custom?.keatingRetryable === true,
  );
  const llmFailure = useAuiState(
    ({ message }) =>
      message.metadata.custom?.keatingLlmFailure as LlmErrorDetails | undefined,
  );
  const provider = useAuiState(({ message }) => message.metadata.custom?.keatingProvider as string | undefined);
  const failureMessage = useAuiState(({ message }) => message.metadata.custom?.keatingFailureMessage as string | undefined);
  const failedLastTurn = useAuiState(({ message }) => message.metadata.custom?.keatingFailedLastTurn === true);
  const creditFailure = provider === "notorganic" && llmFailure?.category === "billing";
  const retryAttempts = useAuiState(
    ({ message }) =>
      message.metadata.custom?.keatingRetryAttempts as number | undefined,
  );
  const retryExhausted = useAuiState(
    ({ message }) => message.metadata.custom?.keatingRetryExhausted === true,
  );
  const isPrefillStatus = useAuiState(
    ({ message }) => message.metadata.custom?.keatingPrefillStatus === true,
  );
  // The message id is `assistant-${index}-${timestamp}` (see toAssistantMessage).
  // The trailing timestamp is the stable handle we use to fork at this turn.
  const messageId = useAuiState(({ message }) => message.id);
  const messageText = useAuiState(({ message }) =>
    (message.content as Array<{ type: string; text?: string }>)
      .filter((part) => part.type === "text")
      .map((part) => part.text ?? "")
      .join("\n\n"),
  );
  const copyText = stripOpenUIPrograms(
    stripQuizTags(
      stripGeneratedImageTags(
        stripQuestionTags(stripGoalTags(stripArtifactLinks(messageText))),
      ),
    ),
  ).trim();
  const createdAt = useAuiState(({ message }) => message.createdAt);
  const handleFork = () => {
    const ts = createdAt?.getTime() ?? Number(messageId.slice(messageId.lastIndexOf("-") + 1));
    onFork?.(Number.isFinite(ts) ? ts : undefined);
  };
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
            messageCreatedAt:
              Number(messageId.slice(messageId.lastIndexOf("-") + 1)) ||
              undefined,
          },
        }),
      );
    } catch {
      /* noop */
    }
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
          <div className={css({ minWidth: 0, flex: 1, lineHeight: "1.5rem" })}>
            <div className="msg-meta">
              <b>KEATING</b>
            </div>
            <div className={cx("keating-bubble", foregroundTextClass)}>
              {creditFailure ? failedLastTurn ? <NotOrganicCreditRecovery
                onRetry={onRetry}
                onModelSelect={onModelSelect}
                details={failureMessage}
              /> : <p>This response paused because credits were unavailable.</p> : <MessagePrimitive.Content components={components} />}
              {authError && <ProviderAuthRecovery
                selectedProvider={selectedProvider}
                failedProvider={authError.provider}
                recovery={llmFailure?.recovery}
                onRecover={onAuthError}
              />}
            </div>
            {llmFailure && canRetry && onRetry && (
              <FailedResponseRecovery
                recovery={developerMode ? llmFailure.recovery : undefined}
                onRetry={onRetry}
                diagnosticsSummary={developerMode ? diagnosticsSummaryForFailure(llmFailure) : undefined}
              />
            )}
            {/* A reportable failure with no retry control still needs a way out. */}
            {developerMode && llmFailure && !(canRetry && onRetry) && diagnosticsSummaryForFailure(llmFailure) && (
              <ErrorDiagnosticsActions summary={diagnosticsSummaryForFailure(llmFailure)!} />
            )}
            {developerMode && llmFailure && retryAttempts && retryAttempts > 1 && (
              <p
                className={css({
                  marginTop: "0.5rem",
                  fontSize: "0.75rem",
                  color: "var(--muted-foreground)",
                })}
                role="status"
              >
                {retryExhausted
                  ? `Automatic recovery stopped after ${retryAttempts} attempts.`
                  : `Keating made ${retryAttempts} recovery attempts before preserving this error.`}
              </p>
            )}
            <div
              className={css({
                marginTop: "0.5rem",
                display: "flex",
                alignItems: "center",
                gap: "0.25rem",
              })}
            >
              {copyText && (
                <CopyButton
                  variant="ghost"
                  text={copyText}
                  label="Copy message"
                />
              )}
              {llmFailure &&
                llmFailure.category !== "aborted" &&
                onModelSelect && (
                  <button
                    type="button"
                    className={cx(
                      messageActionButtonClass,
                      css({
                        width: "auto",
                        gap: "0.375rem",
                        paddingInline: "0.5rem",
                      }),
                    )}
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
                        backgroundColor:
                          "color-mix(in srgb, var(--primary) 20%, transparent)",
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
                        backgroundColor:
                          "color-mix(in srgb, var(--destructive) 20%, transparent)",
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
                  className={cx(
                    messageActionButtonClass,
                    css({ opacity: 0, _focus: { opacity: 1 } }),
                  )}
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
      <div className={css({ minWidth: 0 })}>
        <div
          className={css({
            display: "flex",
            alignItems: "center",
            gap: "0.25rem",
            fontSize: "0.75rem",
            fontWeight: 600,
            color: "var(--foreground)",
          })}
        >
          Keating is thinking

        </div>
        <p
          className={css({
            marginTop: "0.125rem",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: "11px",
          })}
        >
          {status}
        </p>
      </div>
    </div>
  );
}

export const AssistantChatPanel = forwardRef<
  ChatPanelHandle,
  AssistantChatPanelProps
>(
  (
    {
      className,
      speechEnabled = false,
      responseComparison,
      initialPrompts,
      emptyStateTitle,
      emptyStateDescription,
      pendingPrompt,
    },
    ref,
  ) => {
    const [agent, setAgentState] = useState<FlueConversation | null>(null);
    const [callbacks, setCallbacks] = useState<ChatPanelSetupCallbacks>({});
    const [version, setVersion] = useState(0);

    const refresh = useCallback(() => setVersion((current) => current + 1), []);

    useImperativeHandle(
      ref,
      () => ({
        async setConversation(nextAgent, nextCallbacks = {}) {
          setAgentState(nextAgent);
          setCallbacks(nextCallbacks);
          refresh();
        },
      }),
      [refresh],
    );

    return (
      <div className={className}>
        <ConversationSubscription agent={agent} onChange={refresh} />
        <AssistantThread
          agent={agent}
          callbacks={callbacks}
          version={version}
          speechEnabled={speechEnabled}
          responseComparison={responseComparison}
          initialPrompts={initialPrompts}
          emptyStateTitle={emptyStateTitle}
          emptyStateDescription={emptyStateDescription}
          pendingPrompt={pendingPrompt}
        />
      </div>
    );
  },
);

AssistantChatPanel.displayName = "AssistantChatPanel";

// Test-only export for parser regressions around malformed reasoning tags from
// OpenAI-compatible providers.

function ConversationSubscription({
  agent,
  onChange,
}: {
  agent: FlueConversation | null;
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
