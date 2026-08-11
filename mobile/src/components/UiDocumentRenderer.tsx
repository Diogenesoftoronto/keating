import Ionicons from "@expo/vector-icons/Ionicons";
import {
  UI_CONTRACT_VERSION,
  applyReview,
  initialSrsState,
  type UiAction,
  type UiDocument,
  type UiDocumentNode,
  type UiQuestionGroupResponse,
  type UiQuestion,
  type UiStudyPlanItem,
} from "@keating/learner-contracts";
import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Image, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { Button } from "@/components/Buttons";
import { MarkdownText } from "@/components/MarkdownText";
import { MermaidDiagram } from "@/components/MermaidDiagram";
import { radii, spacing, useKeatingTheme } from "@/constants/theme";
import { safeMarkdownUri } from "@/lib/markdown-document";
import { uiActionLearnerMessage } from "@/lib/ui-action-mutations";
import { completedDeckAction, completedNodeAction, completedQuestionAction, completedQuestionGroupAction, completedQuizAction, completedUiActions, latestUiDocument, reviewedDeckCardIds } from "@/lib/ui-render-state";
import { useKeating } from "@/state/KeatingProvider";

function hash(value: string): string {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

function actionKey(document: UiDocument, type: UiAction["type"], target: string, value: unknown): string {
  return `ui-action-${hash(`${document.id}:${document.revision}:${type}:${target}:${JSON.stringify(value)}`)}`;
}

type QuizCompletionPayload = Omit<Extract<UiAction, { type: "complete-quiz" }>, "schemaVersion" | "type" | "documentId" | "documentRevision" | "nodeId" | "idempotencyKey">;
type DeckCompletionPayload = Omit<Extract<UiAction, { type: "complete-deck" }>, "schemaVersion" | "type" | "documentId" | "documentRevision" | "nodeId" | "idempotencyKey">;

/** Native aggregate controls share the contract's ordered payload with web. */
export function buildQuestionGroupAction(document: UiDocument, nodeId: string, responses: UiQuestionGroupResponse[]): Extract<UiAction, { type: "submit-question-group" }> {
  return {
    schemaVersion: UI_CONTRACT_VERSION,
    type: "submit-question-group",
    documentId: document.id,
    documentRevision: document.revision,
    nodeId,
    responses,
    idempotencyKey: actionKey(document, "submit-question-group", nodeId, responses),
  };
}

export function buildQuizCompletionAction(document: UiDocument, nodeId: string, payload: QuizCompletionPayload): Extract<UiAction, { type: "complete-quiz" }> {
  return { schemaVersion: UI_CONTRACT_VERSION, type: "complete-quiz", documentId: document.id, documentRevision: document.revision, nodeId, ...payload, idempotencyKey: actionKey(document, "complete-quiz", nodeId, payload) };
}

export function buildDeckCompletionAction(document: UiDocument, nodeId: string, payload: DeckCompletionPayload): Extract<UiAction, { type: "complete-deck" }> {
  return { schemaVersion: UI_CONTRACT_VERSION, type: "complete-deck", documentId: document.id, documentRevision: document.revision, nodeId, ...payload, idempotencyKey: actionKey(document, "complete-deck", nodeId, payload) };
}

export function UiDocumentRenderer({
  sourceDocument,
  sessionId,
  onLearnerTurn,
}: {
  sourceDocument: UiDocument;
  sessionId?: string;
  onLearnerTurn: (text: string) => Promise<void>;
}) {
  const theme = useKeatingTheme();
  const styles = createStyles(theme);
  const { dispatchUiAction, getUiActionJournal } = useKeating();
  const [document, setDocument] = useState(sourceDocument);
  const [durableActions, setDurableActions] = useState<UiAction[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setDocument(sourceDocument);
    setDurableActions([]);
    void getUiActionJournal(sourceDocument.id).then((journal) => {
      if (!active) return;
      setDocument(latestUiDocument(journal, sourceDocument));
      setDurableActions(completedUiActions(journal));
    }).catch((cause) => {
      if (active) setError(cause instanceof Error ? cause.message : "Could not restore this interaction.");
    });
    return () => { active = false; };
  }, [getUiActionJournal, sourceDocument]);

  const run = async (action: UiAction, learnerTurn = true) => {
    if (busy) return false;
    setBusy(action.idempotencyKey);
    setError(null);
    setNotice(null);
    try {
      const result = await dispatchUiAction(action, document, sessionId);
      if (result.resultingDocument) setDocument(result.resultingDocument);
      if (result.status === "completed") {
        setDurableActions((current) => current.some((candidate) => candidate.idempotencyKey === action.idempotencyKey)
          ? current
          : [...current, action]);
      }
      setNotice(result.message ?? "Saved.");
      const response = learnerTurn ? uiActionLearnerMessage(action, document) : null;
      if (response) {
        try {
          await onLearnerTurn(response);
        } catch (cause) {
          setError(cause instanceof Error
            ? `Your progress is saved, but Keating could not respond: ${cause.message}`
            : "Your progress is saved, but Keating could not respond.");
        }
      }
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this interaction. Your input is still here; try again.");
      return false;
    } finally {
      setBusy(null);
    }
  };

  const canInteract = document.lifecycle === "ready" && document.supportedSurfaces.includes("mobile");
  const retryable = document.lifecycle === "failed" || document.lifecycle === "cancelled";
  const retryKey = actionKey(document, "retry", document.id, document.lifecycle);
  const retryAction: UiAction = {
    schemaVersion: UI_CONTRACT_VERSION,
    type: "retry",
    documentId: document.id,
    documentRevision: document.revision,
    idempotencyKey: retryKey,
  };
  return (
    <View style={styles.document} accessibilityLabel={`Interactive lesson ${document.id}`}>
      <View style={styles.documentHeader}>
        <View style={styles.documentTitleRow}>
          <Ionicons name="sparkles-outline" size={16} color={theme.colors.primaryText} />
          <Text style={styles.documentTitle}>{document.title ?? "Interactive lesson"}</Text>
        </View>
        <Text style={styles.lifecycle}>{document.lifecycle.replace("_", " ")}</Text>
      </View>
      {document.description ? <Text style={styles.body}>{document.description}</Text> : null}
      {retryable ? <View style={styles.recovery}>
        <Text style={styles.body}>This interaction stopped before it finished. Your saved work is still here.</Text>
        <Button compact loading={busy === retryKey} disabled={busy !== null} onPress={() => void run(retryAction, false)}>Try interaction again</Button>
      </View> : null}
      {document.nodes.map((node) => (
        <UiNode
          key={node.id}
          node={node}
          document={document}
          disabled={!canInteract || busy !== null}
          busy={busy}
          durableActions={durableActions}
          run={run}
        />
      ))}
      {notice ? <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text> : null}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function UiNode({
  node,
  document,
  disabled,
  busy,
  durableActions,
  run,
}: {
  node: UiDocumentNode;
  document: UiDocument;
  disabled: boolean;
  busy: string | null;
  durableActions: readonly UiAction[];
  run: (action: UiAction, learnerTurn?: boolean) => Promise<boolean>;
}) {
  const styles = createStyles(useKeatingTheme());
  if (node.type === "markdown") return <MarkdownText content={node.markdown} />;
  if (node.type === "callout") return <View style={[styles.callout, styles[`callout_${node.tone}`]]}>
    <Text style={styles.nodeKicker}>{node.title ?? node.tone.toUpperCase()}</Text>
    <MarkdownText content={node.markdown} />
  </View>;
  if (node.type === "question") return <QuestionNode question={node} document={document} disabled={disabled} busy={busy} completedAction={completedQuestionAction(durableActions, node.id)} run={run} />;
  if (node.type === "question-group") return <QuestionGroupNode node={node} document={document} disabled={disabled} busy={busy} durableActions={durableActions} run={run} />;
  if (node.type === "quiz") return <QuizNode node={node} document={document} disabled={disabled} busy={busy} durableActions={durableActions} run={run} />;
  if (node.type === "goal") return <GoalNode node={node} document={document} disabled={disabled} busy={busy} run={run} />;
  if (node.type === "study-plan") return <StudyPlanNode node={node} document={document} disabled={disabled} busy={busy} durableActions={durableActions} run={run} />;
  if (node.type === "deck") return <DeckNode node={node} document={document} disabled={disabled} busy={busy} durableActions={durableActions} run={run} />;
  if (node.type === "concept-map") return <View style={styles.node}>{node.title ? <Text style={styles.nodeTitle}>{node.title}</Text> : null}<MermaidDiagram source={node.source} /></View>;
  if (node.type === "notes") return <NotesNode node={node} document={document} disabled={disabled} busy={busy} run={run} />;
  if (node.type === "handoff") return <HandoffNode node={node} document={document} disabled={disabled} busy={busy} run={run} />;
  return <ResourceNode node={node} document={document} disabled={disabled} busy={busy} durableActions={durableActions} run={run} />;
}

function QuestionNode({
  question,
  document,
  disabled,
  busy,
  completedAction,
  groupResponse,
  hideSubmit = false,
  aggregateCompleted = false,
  onResponseChange,
  run,
}: {
  question: UiQuestion;
  document: UiDocument;
  disabled: boolean;
  busy: string | null;
  completedAction?: Extract<UiAction, { type: "submit-answer" | "choose-option" }>;
  groupResponse?: UiQuestionGroupResponse;
  hideSubmit?: boolean;
  aggregateCompleted?: boolean;
  onResponseChange?: (response: UiQuestionGroupResponse, ready: boolean) => void;
  run: (action: UiAction) => Promise<boolean>;
}) {
  const theme = useKeatingTheme();
  const styles = createStyles(theme);
  const savedAnswer = completedAction?.type === "submit-answer" ? completedAction.answer : undefined;
  const initialRows = groupResponse?.type === "rows" ? groupResponse.rows : undefined;
  const initialBlanks = groupResponse?.type === "blanks" ? groupResponse.answers : undefined;
  const initialSelected = groupResponse?.type === "choice" ? groupResponse.optionIds : undefined;
  const initialText = groupResponse?.type === "text" ? groupResponse.answer : groupResponse?.type === "choice" ? groupResponse.text : undefined;
  const savedRows = Array.isArray(savedAnswer) && savedAnswer.every((entry) => typeof entry === "object")
    ? savedAnswer as Array<{ item: string; optionId: string; reason?: string }>
    : undefined;
  const [answer, setAnswer] = useState(() => initialText ?? (typeof savedAnswer === "string" ? savedAnswer : ""));
  const [selected, setSelected] = useState<string[]>(() => initialSelected ?? (completedAction?.type === "choose-option" ? [...completedAction.optionIds] : []));
  const [rowSelections, setRowSelections] = useState<string[]>(() => question.items?.map((item) => initialRows?.find((row) => row.item === item)?.optionId ?? savedRows?.find((row) => row.item === item)?.optionId ?? "") ?? []);
  const [rowReasons, setRowReasons] = useState<string[]>(() => question.items?.map((item) => initialRows?.find((row) => row.item === item)?.reason ?? savedRows?.find((row) => row.item === item)?.reason ?? "") ?? []);
  const blankCount = question.blanks?.length ?? (question.prompt.match(/_{3,}|\{\{blank\}\}/g)?.length ?? 0);
  const [blankAnswers, setBlankAnswers] = useState<string[]>(() => initialBlanks ?? (Array.isArray(savedAnswer) && savedAnswer.every((entry) => typeof entry === "string") ? [...savedAnswer] : Array.from({ length: blankCount }, () => "")));
  const questionDisabled = disabled || completedAction !== undefined || aggregateCompleted;
  const isRowQuestion = question.kind === "classification" || question.kind === "matching";
  const isBlankQuestion = question.kind === "blanks" || question.kind === "fill_in";
  const isMultiSelect = question.multiSelect || question.kind === "multi_select";
  const toggle = (id: string) => setSelected((current) => isMultiSelect
    ? current.includes(id) ? current.filter((candidate) => candidate !== id) : [...current, id]
    : [id]);
  const rowAnswers = (question.items ?? []).map((item, index) => ({
    item,
    optionId: rowSelections[index] ?? "",
    ...(question.requireReasons ? { reason: rowReasons[index] ?? "" } : {}),
  }));
  const payload = isRowQuestion ? rowAnswers : isBlankQuestion ? blankAnswers : question.choices ? selected.length > 0 ? selected : answer : answer;
  const choose = !!question.choices && !isRowQuestion && !(question.allowText && selected.length === 0 && answer.trim().length > 0);
  const key = actionKey(document, choose ? "choose-option" : "submit-answer", question.id, payload);
  const action: UiAction = choose ? {
    schemaVersion: UI_CONTRACT_VERSION,
    type: "choose-option",
    documentId: document.id,
    documentRevision: document.revision,
    nodeId: question.id,
    optionIds: selected,
    idempotencyKey: key,
  } : {
    schemaVersion: UI_CONTRACT_VERSION,
    type: "submit-answer",
    documentId: document.id,
    documentRevision: document.revision,
    nodeId: question.id,
    answer: Array.isArray(payload) ? payload : answer,
    idempotencyKey: key,
  };
  const ready = isRowQuestion
    ? rowSelections.length > 0 && rowSelections.every(Boolean) && (!question.requireReasons || rowReasons.every((reason) => reason.trim().length > 0))
    : isBlankQuestion ? blankAnswers.length > 0 && blankAnswers.every((entry) => entry.trim().length > 0)
      : question.choices ? selected.length > 0 || (question.allowText === true && answer.trim().length > 0) : answer.trim().length > 0;
  useEffect(() => {
    onResponseChange?.(questionResponse(question, answer, selected, blankAnswers, rowSelections, rowReasons), ready);
  }, [answer, blankAnswers, onResponseChange, question, ready, rowReasons, rowSelections, selected]);
  return (
    <View style={styles.node}>
      {question.header ? <Text style={styles.nodeKicker}>{question.header}</Text> : null}
      <Text style={styles.question}>{question.prompt}</Text>
      {isRowQuestion ? <View style={styles.options}>{(question.items ?? []).map((item, rowIndex) => <View key={`${question.id}-${rowIndex}`} style={styles.rowQuestion}>
        <Text style={styles.stepTitle}>{item}</Text>
        <View style={styles.choiceWrap}>{question.choices?.map((option) => {
          const active = rowSelections[rowIndex] === option.id;
          const unavailable = question.kind === "matching" && question.uniqueMatches !== false
            && rowSelections.some((selection, index) => index !== rowIndex && selection === option.id);
          return <Pressable key={option.id} accessibilityRole="radio" accessibilityState={{ selected: active, disabled: questionDisabled || unavailable }} disabled={questionDisabled || unavailable} onPress={() => setRowSelections((current) => current.map((value, index) => index === rowIndex ? option.id : value))} style={({ pressed }) => [styles.rowChoice, active && styles.optionActive, unavailable && styles.optionUnavailable, pressed && styles.pressed]}><Text style={[styles.optionText, active && styles.optionTextActive]}>{option.label}</Text></Pressable>;
        })}</View>
        {question.requireReasons ? <TextInput accessibilityLabel={`Reason for ${item}`} editable={!questionDisabled} value={rowReasons[rowIndex] ?? ""} onChangeText={(value) => setRowReasons((current) => current.map((reason, index) => index === rowIndex ? value : reason))} placeholder={question.reasonLabel ?? "Reason"} placeholderTextColor={theme.colors.textFaint} style={styles.compactInput} /> : null}
      </View>)}</View> : isBlankQuestion ? <View style={styles.options}>{blankAnswers.map((value, index) => <TextInput key={`${question.id}-blank-${index}`} accessibilityLabel={`Blank ${index + 1}: ${question.prompt}`} editable={!questionDisabled} value={value} onChangeText={(next) => setBlankAnswers((current) => current.map((entry, entryIndex) => entryIndex === index ? next : entry))} placeholder={question.blanks?.[index]?.placeholder ?? `Blank ${index + 1}`} placeholderTextColor={theme.colors.textFaint} style={styles.compactInput} />)}</View> : question.choices ? <View style={styles.options}>{question.choices.map((option) => {
        const active = selected.includes(option.id);
        return <Pressable
          key={option.id}
          accessibilityRole={isMultiSelect ? "checkbox" : "radio"}
          accessibilityState={{ selected: active, disabled: questionDisabled }}
          disabled={questionDisabled}
          onPress={() => toggle(option.id)}
          style={({ pressed }) => [styles.option, active && styles.optionActive, pressed && styles.pressed]}
        ><Text style={[styles.optionText, active && styles.optionTextActive]}>{option.label}</Text></Pressable>;
      })}{question.allowText ? <TextInput
        accessibilityLabel={`Other answer: ${question.prompt}`}
        editable={!questionDisabled}
        multiline
        value={answer}
        onChangeText={setAnswer}
        placeholder="Or explain your own answer"
        placeholderTextColor={theme.colors.textFaint}
        style={styles.input}
      /> : null}</View> : <TextInput
        accessibilityLabel={`Answer: ${question.prompt}`}
        editable={!questionDisabled}
        multiline
        keyboardType={question.kind === "slider" ? "decimal-pad" : "default"}
        value={answer}
        onChangeText={setAnswer}
        placeholder="Type your answer"
        placeholderTextColor={theme.colors.textFaint}
        style={styles.input}
      />}
      {question.kind === "slider" ? <Text style={styles.criterion}>Range: {question.min ?? 0}–{question.max ?? 100}{question.step ? ` · step ${question.step}` : ""}</Text> : null}
      {question.hint ? <Text style={styles.criterion}>{question.hint}</Text> : null}
      {completedAction ? <Text accessibilityLiveRegion="polite" style={styles.savedAnswer}>
        Saved answer: {completedAnswerLabel(completedAction, question)}
      </Text> : null}
      {!hideSubmit ? <Button
        compact
        disabled={questionDisabled || !ready}
        loading={busy === key}
        onPress={() => void run(action)}
      >{completedAction ? "Answer saved" : "Submit answer"}</Button> : null}
    </View>
  );
}

function questionResponse(
  question: UiQuestion,
  answer: string,
  selected: string[],
  blankAnswers: string[],
  rowSelections: string[],
  rowReasons: string[],
): UiQuestionGroupResponse {
  if (question.kind === "classification" || question.kind === "matching") return {
    questionId: question.id,
    type: "rows",
    rows: (question.items ?? []).map((item, index) => ({ item, optionId: rowSelections[index] ?? "", ...(question.requireReasons ? { reason: rowReasons[index] ?? "" } : {}) })),
  };
  if (question.kind === "blanks" || question.kind === "fill_in") return { questionId: question.id, type: "blanks", answers: blankAnswers };
  if (question.choices) return { questionId: question.id, type: "choice", optionIds: selected, ...(question.allowText ? { text: answer } : {}) };
  return { questionId: question.id, type: "text", answer };
}

function answerForQuizResponse(response: UiQuestionGroupResponse): string {
  if (response.type === "text") return response.answer;
  if (response.type === "choice") return response.optionIds.join(",") || (response.text ?? "");
  if (response.type === "blanks") return response.answers.join(",");
  return response.rows.map((row) => `${row.item}:${row.optionId}${row.reason ? ` (${row.reason})` : ""}`).join("; ");
}

function quizResponseForAnswer(question: UiQuestion, answer: string): UiQuestionGroupResponse {
  if (question.kind === "blanks" || question.kind === "fill_in") return { questionId: question.id, type: "blanks", answers: answer ? answer.split(",") : [] };
  if (question.choices) return { questionId: question.id, type: "choice", optionIds: answer ? answer.split(",") : [] };
  return { questionId: question.id, type: "text", answer };
}

function QuestionGroupNode({ node, document, disabled, busy, durableActions, run }: NodeActionProps<Extract<UiDocumentNode, { type: "question-group" }>> & { durableActions: readonly UiAction[] }) {
  const styles = createStyles(useKeatingTheme());
  const savedAction = completedQuestionGroupAction(durableActions, node.id);
  const [responses, setResponses] = useState<Record<string, UiQuestionGroupResponse>>(() => Object.fromEntries((savedAction?.responses ?? []).map((response) => [response.questionId, response])));
  const [ready, setReady] = useState<Record<string, boolean>>(() => Object.fromEntries((savedAction?.responses ?? []).map((response) => [response.questionId, true])));
  const [pendingAction, setPendingAction] = useState<Extract<UiAction, { type: "submit-question-group" }>>();
  const [delivered, setDelivered] = useState(false);
  useEffect(() => {
    if (!savedAction) return;
    setResponses(Object.fromEntries(savedAction.responses.map((response) => [response.questionId, response])));
    setReady(Object.fromEntries(savedAction.responses.map((response) => [response.questionId, true])));
  }, [savedAction]);
  const update = useCallback((response: UiQuestionGroupResponse, isReady: boolean) => {
    setResponses((current) => current[response.questionId] && JSON.stringify(current[response.questionId]) === JSON.stringify(response) ? current : { ...current, [response.questionId]: response });
    setReady((current) => current[response.questionId] === isReady ? current : { ...current, [response.questionId]: isReady });
  }, []);
  const ordered = node.questions.flatMap((question) => responses[question.id] ? [responses[question.id]!] : []);
  const canSubmit = ordered.length === node.questions.length && node.questions.every((question) => ready[question.id]);
  const completed = Boolean(savedAction) || delivered;
  const submit = async () => {
    const action = pendingAction ?? buildQuestionGroupAction(document, node.id, ordered);
    if (!pendingAction) setPendingAction(action);
    if (await run(action)) {
      setPendingAction(undefined);
      setDelivered(true);
    }
  };
  return <View style={styles.node}>
    <Text style={styles.nodeKicker}>QUESTION GROUP</Text>
    {node.title ? <Text style={styles.nodeTitle}>{node.title}</Text> : null}
    {node.intro ? <MarkdownText content={node.intro} /> : null}
    {node.questions.map((question, index) => <View key={`${question.id}:${savedAction?.idempotencyKey ?? "draft"}`} style={styles.quizQuestion}>
      <Text style={styles.questionNumber}>{index + 1}</Text>
      <QuestionNode question={question} document={document} disabled={disabled || Boolean(pendingAction)} busy={busy} groupResponse={responses[question.id]} hideSubmit aggregateCompleted={completed} onResponseChange={update} run={run} />
    </View>)}
    {completed ? <Text accessibilityLiveRegion="polite" style={styles.savedAnswer}>Answers saved.</Text> : <Button compact disabled={disabled || (!pendingAction && !canSubmit)} loading={busy === pendingAction?.idempotencyKey} onPress={() => void submit()}>{pendingAction ? "Retry save answers" : "Submit answers"}</Button>}
  </View>;
}

function quizOpenEnded(question: UiQuestion): boolean {
  return question.kind === "short_answer" || question.kind === "transfer" || (question.kind === "fill_in" && !question.blanks?.length);
}

function quizCredit(question: UiQuestion, answer: string): number | undefined {
  if (quizOpenEnded(question) || (!question.correctAnswer && !question.correctAnswers?.length)) return undefined;
  if (question.kind === "multi_select") {
    const actual = answer.split(",").filter(Boolean).sort();
    const expected = [...(question.correctAnswers ?? [])].sort();
    return actual.length === expected.length && actual.every((value, index) => value === expected[index]) ? 1 : 0;
  }
  if (question.kind === "fill_in" && question.blanks?.length) {
    const actual = answer.split(",").map((value) => value.trim().toLocaleLowerCase());
    const expected = (question.correctAnswers ?? [question.correctAnswer ?? ""]).map((value) => value.trim().toLocaleLowerCase());
    return actual.length === expected.length && actual.every((value, index) => value === expected[index]) ? 1 : 0;
  }
  return answer.trim().toLocaleLowerCase() === (question.correctAnswer ?? question.correctAnswers?.[0] ?? "").trim().toLocaleLowerCase() ? 1 : 0;
}

function QuizNode({ node, document, disabled, busy, durableActions, run }: NodeActionProps<Extract<UiDocumentNode, { type: "quiz" }>> & { durableActions: readonly UiAction[] }) {
  const styles = createStyles(useKeatingTheme());
  const savedAction = completedQuizAction(durableActions, node.id);
  const [responses, setResponses] = useState<Record<string, UiQuestionGroupResponse>>(() => Object.fromEntries((savedAction?.answers ?? []).flatMap((answer) => {
    const question = node.questions.find((candidate) => candidate.id === answer.questionId);
    return question ? [[answer.questionId, quizResponseForAnswer(question, answer.answer)] as const] : [];
  })));
  const [ready, setReady] = useState<Record<string, boolean>>(() => Object.fromEntries((savedAction?.answers ?? []).map((answer) => [answer.questionId, true])));
  const startedAt = useRef(Date.now());
  const firstAnswerAt = useRef<Record<string, number>>({});
  const [pendingAction, setPendingAction] = useState<Extract<UiAction, { type: "complete-quiz" }>>();
  const [delivered, setDelivered] = useState(false);
  useEffect(() => {
    if (!savedAction) return;
    setResponses(Object.fromEntries(savedAction.answers.flatMap((answer) => {
      const question = node.questions.find((candidate) => candidate.id === answer.questionId);
      return question ? [[answer.questionId, quizResponseForAnswer(question, answer.answer)] as const] : [];
    })));
    setReady(Object.fromEntries(savedAction.answers.map((answer) => [answer.questionId, true])));
  }, [node.questions, savedAction]);
  const update = useCallback((response: UiQuestionGroupResponse, isReady: boolean) => {
    setResponses((current) => current[response.questionId] && JSON.stringify(current[response.questionId]) === JSON.stringify(response) ? current : { ...current, [response.questionId]: response });
    setReady((current) => current[response.questionId] === isReady ? current : { ...current, [response.questionId]: isReady });
    if (isReady && firstAnswerAt.current[response.questionId] === undefined) firstAnswerAt.current[response.questionId] = Math.max(0, Date.now() - startedAt.current);
  }, []);
  const answers = node.questions.flatMap((question) => responses[question.id] ? [{ questionId: question.id, answer: answerForQuizResponse(responses[question.id]!) }] : []);
  const canSubmit = answers.length === node.questions.length && node.questions.every((question) => ready[question.id]);
  const completed = Boolean(savedAction) || delivered;
  const createAction = (): Extract<UiAction, { type: "complete-quiz" }> => {
    const partialCredits = Object.fromEntries(node.questions.flatMap((question) => {
      const answer = answers.find((candidate) => candidate.questionId === question.id)?.answer ?? "";
      const credit = quizCredit(question, answer);
      return credit === undefined ? [] : [[question.id, credit] as const];
    }));
    const score = Object.values(partialCredits).filter((credit) => credit === 1).length;
    const partialCreditPoints = Object.values(partialCredits).reduce((total, credit) => total + credit, 0);
    const payload = {
      resultId: `${node.id}-result`,
      answers,
      score,
      partialCreditPoints,
      partialCredits,
      timing: { totalMs: Math.max(0, Date.now() - startedAt.current), perQuestionMs: Object.fromEntries(node.questions.map((question) => [question.id, firstAnswerAt.current[question.id] ?? 0])) },
      flaggedQuestionIds: [] as string[],
      pendingGradeQuestionIds: node.questions.filter((question) => quizCredit(question, answers.find((candidate) => candidate.questionId === question.id)?.answer ?? "") === undefined).map((question) => question.id),
      skippedQuestionIds: [] as string[],
    };
    return buildQuizCompletionAction(document, node.id, payload);
  };
  const submit = async () => {
    const action = pendingAction ?? createAction();
    if (!pendingAction) setPendingAction(action);
    if (await run(action)) {
      setPendingAction(undefined);
      setDelivered(true);
    }
  };
  return <View style={styles.node}>
    <Text style={styles.nodeKicker}>QUIZ</Text>
    <Text style={styles.nodeTitle}>{node.title}</Text>
    {node.questions.map((question, index) => <View key={`${question.id}:${savedAction?.idempotencyKey ?? "draft"}`} style={styles.quizQuestion}>
      <Text style={styles.questionNumber}>{index + 1}</Text>
      <QuestionNode question={question} document={document} disabled={disabled || Boolean(pendingAction)} busy={busy} groupResponse={responses[question.id]} hideSubmit aggregateCompleted={completed} onResponseChange={update} run={run} />
    </View>)}
    {completed ? <Text accessibilityLiveRegion="polite" style={styles.savedAnswer}>Quiz saved.</Text> : <Button compact disabled={disabled || (!pendingAction && !canSubmit)} loading={busy === pendingAction?.idempotencyKey} onPress={() => void submit()}>{pendingAction ? "Retry save quiz" : "Submit quiz"}</Button>}
  </View>;
}

function GoalNode({ node, document, disabled, busy, run }: NodeActionProps<Extract<UiDocumentNode, { type: "goal" }>>) {
  const styles = createStyles(useKeatingTheme());
  return <View style={styles.node}>
    <Text style={styles.nodeKicker}>GOAL</Text><Text style={styles.nodeTitle}>{node.title}</Text>
    {node.description ? <Text style={styles.body}>{node.description}</Text> : null}
    {node.steps.map((step) => {
      const key = actionKey(document, "complete-goal-step", node.id, step.id);
      const action: UiAction = { schemaVersion: 1, type: "complete-goal-step", documentId: document.id, documentRevision: document.revision, nodeId: node.id, stepId: step.id, idempotencyKey: key };
      return <Pressable key={step.id} accessibilityRole="button" accessibilityState={{ disabled: disabled || step.status === "done" }} disabled={disabled || step.status === "done"} onPress={() => void run(action)} style={({ pressed }) => [styles.step, step.status === "done" && styles.stepDone, pressed && styles.pressed]}>
        <Text style={styles.stepMark}>{step.status === "done" ? "●" : busy === key ? "◌" : "○"}</Text>
        <View style={styles.flex}><Text style={styles.stepTitle}>{step.title}</Text>{step.successCriteria?.map((criterion) => <Text key={criterion} style={styles.criterion}>· {criterion}</Text>)}</View>
      </Pressable>;
    })}
  </View>;
}

function StudyPlanNode({ node, document, disabled, busy, durableActions, run }: NodeActionProps<Extract<UiDocumentNode, { type: "study-plan" }>> & { durableActions: readonly UiAction[] }) {
  const styles = createStyles(useKeatingTheme());
  if (!node.items) return node.resource
    ? <LegacyStudyPlanResourceNode node={node} document={document} disabled={disabled} busy={busy} durableActions={durableActions} run={run} />
    : null;
  return <View style={styles.node}>
    <Text style={styles.nodeKicker}>STUDY PLAN</Text>
    <Text style={styles.nodeTitle}>{node.title}</Text>
    {node.overview ? <MarkdownText content={node.overview} /> : null}
    <View style={styles.options}>{node.items.map((item) => <StudyPlanItemRow key={item.id} item={item} nodeId={node.id} document={document} disabled={disabled} busy={busy} run={run} />)}</View>
    {node.relatedPlans?.length ? <View style={styles.options}>
      <Text style={styles.nodeKicker}>RELATED PLANS</Text>
      {node.relatedPlans.map((link) => <View key={link.planId} style={styles.planItem}>
        <Text style={styles.stepTitle}>{link.title}</Text>
        {link.relation ? <Text style={styles.criterion}>{link.relation.replace("-", " ")}</Text> : null}
        {link.detail ? <Text style={styles.body}>{link.detail}</Text> : null}
      </View>)}
    </View> : null}
  </View>;
}

function StudyPlanItemRow({ item, nodeId, document, disabled, busy, run, depth = 0 }: {
  item: UiStudyPlanItem;
  nodeId: string;
  document: UiDocument;
  disabled: boolean;
  busy: string | null;
  run: (action: UiAction, learnerTurn?: boolean) => Promise<boolean>;
  depth?: number;
}) {
  const styles = createStyles(useKeatingTheme());
  const completed = item.status === "done";
  const key = actionKey(document, "complete-plan-item", nodeId, `${item.id}:${!completed}`);
  const action: UiAction = {
    schemaVersion: UI_CONTRACT_VERSION,
    type: "complete-plan-item",
    documentId: document.id,
    documentRevision: document.revision,
    nodeId,
    itemId: item.id,
    completed: !completed,
    idempotencyKey: key,
  };
  return <View style={{ marginLeft: Math.min(depth, 4) * spacing.md }}>
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: completed, disabled }}
      disabled={disabled}
      onPress={() => void run(action, false)}
      style={({ pressed }) => [styles.planItem, completed && styles.stepDone, pressed && styles.pressed]}
    >
      <Text style={styles.stepMark}>{busy === key ? "◌" : completed ? "●" : "○"}</Text>
      <View style={styles.flex}>
        <Text style={styles.stepTitle}>{item.title}</Text>
        {item.detail ? <Text style={styles.body}>{item.detail}</Text> : null}
        {item.estimatedMinutes ? <Text style={styles.criterion}>{item.estimatedMinutes} min</Text> : null}
        {item.outcomes?.map((outcome) => <Text key={outcome} style={styles.criterion}>· {outcome}</Text>)}
      </View>
    </Pressable>
    {item.children?.map((child) => <StudyPlanItemRow key={child.id} item={child} nodeId={nodeId} document={document} disabled={disabled} busy={busy} run={run} depth={depth + 1} />)}
  </View>;
}

function NotesNode({ node, document, disabled, busy, run }: NodeActionProps<Extract<UiDocumentNode, { type: "notes" }>>) {
  const theme = useKeatingTheme();
  const styles = createStyles(theme);
  const [value, setValue] = useState(node.value);
  useEffect(() => setValue(node.value), [node.value]);
  const key = actionKey(document, "update-notes", node.id, value);
  const action: UiAction = {
    schemaVersion: UI_CONTRACT_VERSION,
    type: "update-notes",
    documentId: document.id,
    documentRevision: document.revision,
    nodeId: node.id,
    value,
    idempotencyKey: key,
  };
  return <View style={styles.node}>
    <Text style={styles.nodeKicker}>SHARED NOTES</Text>
    <Text style={styles.nodeTitle}>{node.title}</Text>
    <TextInput
      accessibilityLabel={node.title}
      editable={!disabled}
      multiline
      onChangeText={setValue}
      placeholder={node.placeholder ?? "Add notes"}
      placeholderTextColor={theme.colors.textFaint}
      style={styles.notesInput}
      textAlignVertical="top"
      value={value}
    />
    <Button compact disabled={disabled || value === node.value} loading={busy === key} onPress={() => void run(action, false)}>Save notes</Button>
  </View>;
}

function DeckNode({ node, document, disabled, busy, durableActions, run }: NodeActionProps<Extract<UiDocumentNode, { type: "deck" }>> & { durableActions: readonly UiAction[] }) {
  const styles = createStyles(useKeatingTheme());
  const completedAction = completedDeckAction(durableActions, node.id);
  const hasLegacyRatings = durableActions.some((action) => action.type === "rate-card" && action.nodeId === node.id);
  if (completedAction) return <View style={styles.node}>
    <Text style={styles.nodeKicker}>FLASHCARDS</Text>
    <Text style={styles.nodeTitle}>{node.title}</Text>
    <Text accessibilityLiveRegion="polite" style={styles.savedAnswer}>Deck review complete. {completedAction.summary.reviewed} card{completedAction.summary.reviewed === 1 ? "" : "s"} reviewed.</Text>
  </View>;
  if (hasLegacyRatings) return <LegacyDeckNode node={node} document={document} disabled={disabled} busy={busy} durableActions={durableActions} run={run} />;
  return <AggregateDeckNode node={node} document={document} disabled={disabled} busy={busy} durableActions={durableActions} run={run} />;
}

function AggregateDeckNode({ node, document, disabled, busy, durableActions, run }: NodeActionProps<Extract<UiDocumentNode, { type: "deck" }>> & { durableActions: readonly UiAction[] }) {
  const styles = createStyles(useKeatingTheme());
  const [revealed, setRevealed] = useState(false);
  const savedAction = completedDeckAction(durableActions, node.id);
  const [ratings, setRatings] = useState<Extract<UiAction, { type: "complete-deck" }>['ratings']>(() => savedAction?.ratings ?? []);
  const [pendingAction, setPendingAction] = useState<Extract<UiAction, { type: "complete-deck" }>>();
  const [delivered, setDelivered] = useState(false);
  useEffect(() => {
    if (savedAction) setRatings(savedAction.ratings);
  }, [savedAction]);
  const index = ratings.length;
  const completed = Boolean(savedAction) || delivered;
  if (completed || (node.cards.length > 0 && index >= node.cards.length)) return <View style={styles.node}>
    <Text style={styles.nodeKicker}>FLASHCARDS</Text>
    <Text style={styles.nodeTitle}>{node.title}</Text>
    <Text accessibilityLiveRegion="polite" style={styles.savedAnswer}>Deck review complete. {ratings.length} card{ratings.length === 1 ? "" : "s"} reviewed.</Text>
  </View>;
  const card = node.cards[index];
  if (!card) return <Text style={styles.body}>This deck has no cards.</Text>;
  const complete = async (nextRatings: typeof ratings) => {
    const summary = { reviewed: nextRatings.length, lapses: nextRatings.filter((entry) => entry.rating === 0).length };
    const action = pendingAction ?? buildDeckCompletionAction(document, node.id, { ratings: nextRatings, summary });
    if (!pendingAction) setPendingAction(action);
    if (await run(action, false)) {
      setPendingAction(undefined);
      setDelivered(true);
    }
  };
  const rate = (rating: 0 | 1 | 2 | 3) => {
    const outcome = applyReview(initialSrsState(document.updatedAt), rating, document.updatedAt);
    const nextRatings = [...ratings, { cardId: card.id, rating, appliedIntervalDays: outcome.appliedIntervalDays, easeAfter: outcome.next.ease }];
    setRatings(nextRatings);
    setRevealed(false);
    if (index + 1 === node.cards.length) void complete(nextRatings);
  };
  return <View style={styles.node}>
    <Text style={styles.nodeKicker}>FLASHCARDS · {index + 1}/{node.cards.length}</Text>
    <Text style={styles.nodeTitle}>{node.title}</Text>
    <Pressable accessibilityRole="button" accessibilityState={{ disabled: disabled || Boolean(pendingAction) }} accessibilityLabel={revealed ? "Hide card answer" : "Reveal card answer"} disabled={disabled || Boolean(pendingAction)} onPress={() => setRevealed((current) => !current)} style={({ pressed }) => [styles.flashcard, pressed && styles.pressed]}>
      <Text style={styles.cardFace}>{card.front}</Text>
      {revealed ? <Text style={styles.cardBack}>{card.back}</Text> : <Text style={styles.revealHint}>Tap to reveal</Text>}
    </Pressable>
    {pendingAction ? <View style={styles.options}><Text accessibilityLiveRegion="polite" style={styles.savedAnswer}>Final rating is ready to retry.</Text><Button compact disabled={disabled} loading={busy === pendingAction.idempotencyKey} onPress={() => void complete(pendingAction.ratings)}>Retry save deck</Button></View> : revealed ? <View style={styles.ratingRow}>{([0, 1, 2, 3] as const).map((rating) => {
      const labels = ["Again", "Hard", "Good", "Easy"] as const;
      return <Button key={rating} compact variant="secondary" disabled={disabled} style={styles.ratingButton} onPress={() => rate(rating)}>{labels[rating]}</Button>;
    })}</View> : null}
  </View>;
}

function LegacyDeckNode({ node, document, disabled, busy, durableActions, run }: NodeActionProps<Extract<UiDocumentNode, { type: "deck" }>> & { durableActions: readonly UiAction[] }) {
  const styles = createStyles(useKeatingTheme());
  const [revealed, setRevealed] = useState(false);
  const reviewed = reviewedDeckCardIds(durableActions, node.id);
  const index = node.cards.findIndex((candidate) => !reviewed.has(candidate.id));
  if (node.cards.length > 0 && index < 0) return <View style={styles.node}>
    <Text style={styles.nodeKicker}>FLASHCARDS</Text>
    <Text style={styles.nodeTitle}>{node.title}</Text>
    <Text accessibilityLiveRegion="polite" style={styles.savedAnswer}>Deck review complete. The card schedules were saved to Review.</Text>
  </View>;
  const card = node.cards[index];
  if (!card) return <Text style={styles.body}>This deck has no cards.</Text>;
  return <View style={styles.node}>
    <Text style={styles.nodeKicker}>FLASHCARDS · {index + 1}/{node.cards.length}</Text>
    <Text style={styles.nodeTitle}>{node.title}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel={revealed ? "Hide card answer" : "Reveal card answer"} onPress={() => setRevealed((current) => !current)} style={({ pressed }) => [styles.flashcard, pressed && styles.pressed]}>
      <Text style={styles.cardFace}>{card.front}</Text>
      {revealed ? <Text style={styles.cardBack}>{card.back}</Text> : <Text style={styles.revealHint}>Tap to reveal</Text>}
    </Pressable>
    {revealed ? <View style={styles.ratingRow}>{([0, 1, 2, 3] as const).map((rating) => {
      const labels = ["Again", "Hard", "Good", "Easy"] as const;
      const key = actionKey(document, "rate-card", node.id, `${card.id}:${rating}`);
      const action: UiAction = { schemaVersion: UI_CONTRACT_VERSION, type: "rate-card", documentId: document.id, documentRevision: document.revision, nodeId: node.id, cardId: card.id, rating, idempotencyKey: key };
      return <Button key={rating} compact variant="secondary" disabled={disabled} loading={busy === key} style={styles.ratingButton} onPress={() => void run(action, false).then((saved) => { if (saved) setRevealed(false); })}>{labels[rating]}</Button>;
    })}</View> : null}
  </View>;
}

type ResourceNodeType = Extract<UiDocumentNode, { type: "artifact" | "image" | "media" }>;

function ResourceNode({ node, document, disabled, busy, durableActions, run }: NodeActionProps<ResourceNodeType> & { durableActions: readonly UiAction[] }) {
  const styles = createStyles(useKeatingTheme());
  const resource = node.resource;
  const saved = completedNodeAction(durableActions, node.id, "save-artifact");
  const key = actionKey(document, "save-artifact", node.id, resource.id);
  const action: UiAction = { schemaVersion: 1, type: "save-artifact", documentId: document.id, documentRevision: document.revision, nodeId: node.id, idempotencyKey: key };
  return <View style={styles.node}>
    <Text style={styles.nodeKicker}>{node.type.replace("-", " ").toUpperCase()}</Text>
    <Text style={styles.nodeTitle}>{resource.title}</Text>
    {node.type === "image" && resource.uri ? <ConsentImage uri={resource.uri} alt={node.alt} /> : null}
    {node.type === "media" && node.kind === "audio" && resource.uri ? <ConsentAudio uri={resource.uri} title={resource.title} /> : null}
    {resource.content ? resource.format === "markdown" ? <MarkdownText content={resource.content} /> : <ScrollView horizontal><Text selectable style={styles.code}>{resource.content}</Text></ScrollView> : null}
    {resource.uri && node.type !== "image" && !(node.type === "media" && node.kind === "audio") && safeMarkdownUri(resource.uri, "link")
      ? <Button variant="secondary" compact onPress={() => confirmOpenResource(resource.title, resource.uri!)}>Open {node.type === "media" ? node.kind : "resource"}</Button>
      : null}
    {resource.uri?.startsWith("artifact:") ? <Text style={styles.body}>This artifact reference can be saved to your local library.</Text> : null}
    <Button compact disabled={disabled || saved} loading={busy === key} onPress={() => void run(action, false)}>{saved ? "Saved to library" : "Save to library"}</Button>
  </View>;
}

function LegacyStudyPlanResourceNode({ node, document, disabled, busy, durableActions, run }: NodeActionProps<Extract<UiDocumentNode, { type: "study-plan" }>> & { durableActions: readonly UiAction[] }) {
  const styles = createStyles(useKeatingTheme());
  const resource = node.resource;
  if (!resource) return null;
  const saved = completedNodeAction(durableActions, node.id, "save-artifact");
  const key = actionKey(document, "save-artifact", node.id, resource.id);
  const action: UiAction = { schemaVersion: UI_CONTRACT_VERSION, type: "save-artifact", documentId: document.id, documentRevision: document.revision, nodeId: node.id, idempotencyKey: key };
  return <View style={styles.node}>
    <Text style={styles.nodeKicker}>STUDY PLAN</Text>
    <Text style={styles.nodeTitle}>{resource.title}</Text>
    {resource.content ? resource.format === "markdown" ? <MarkdownText content={resource.content} /> : <ScrollView horizontal><Text selectable style={styles.code}>{resource.content}</Text></ScrollView> : null}
    <Button compact disabled={disabled || saved} loading={busy === key} onPress={() => void run(action, false)}>{saved ? "Saved to library" : "Save to library"}</Button>
  </View>;
}

function HandoffNode({ node, document, disabled, busy, run }: NodeActionProps<Extract<UiDocumentNode, { type: "handoff" }>>) {
  const styles = createStyles(useKeatingTheme());
  const key = actionKey(document, "open-handoff", node.id, node.target);
  const action: UiAction = { schemaVersion: 1, type: "open-handoff", documentId: document.id, documentRevision: document.revision, nodeId: node.id, idempotencyKey: key };
  return <View style={styles.node}><Text style={styles.nodeKicker}>CONTINUE ON {node.target.toUpperCase()}</Text><Text style={styles.nodeTitle}>{node.reason}</Text><Text style={styles.body}>{node.context}</Text><Button disabled={disabled} loading={busy === key} onPress={() => void run(action, false).then((saved) => { if (saved) openHandoff(node.target); })}>Open handoff</Button></View>;
}

interface NodeActionProps<T extends UiDocumentNode> {
  node: T;
  document: UiDocument;
  disabled: boolean;
  busy: string | null;
  run: (action: UiAction, learnerTurn?: boolean) => Promise<boolean>;
}

function ConsentImage({ uri, alt }: { uri: string; alt: string }) {
  const styles = createStyles(useKeatingTheme());
  const [allowed, setAllowed] = useState(false);
  const safe = useMemo(() => safeMarkdownUri(uri, "image"), [uri]);
  if (!safe) return <Text style={styles.error}>Blocked unsafe image.</Text>;
  return allowed
    ? <Image accessibilityLabel={alt} accessibilityIgnoresInvertColors source={{ uri: safe.toString() }} resizeMode="contain" style={styles.image} />
    : <Button variant="secondary" compact onPress={() => setAllowed(true)}>Load image</Button>;
}

function ConsentAudio({ uri, title }: { uri: string; title: string }) {
  const styles = createStyles(useKeatingTheme());
  const [allowed, setAllowed] = useState(false);
  const safe = useMemo(() => safeMarkdownUri(uri, "image"), [uri]);
  if (!safe) return <Text style={styles.error}>Blocked unsafe audio source.</Text>;
  return allowed
    ? <NativeAudioPlayer uri={safe.toString()} title={title} />
    : <Button variant="secondary" compact onPress={() => setAllowed(true)}>Load audio</Button>;
}

function NativeAudioPlayer({ uri, title }: { uri: string; title: string }) {
  const styles = createStyles(useKeatingTheme());
  const player = useAudioPlayer({ uri, name: title });
  const status = useAudioPlayerStatus(player);
  const duration = status.duration > 0 ? `${formatTime(status.currentTime)} / ${formatTime(status.duration)}` : "Loading audio…";
  return <View style={styles.audioPlayer}>
    <Button
      compact
      variant="secondary"
      disabled={!status.isLoaded || !!status.error}
      onPress={() => status.playing ? player.pause() : player.play()}
    >{status.playing ? "Pause" : "Play"}</Button>
    <Text accessibilityLiveRegion="polite" style={styles.audioStatus}>{status.error ?? duration}</Text>
  </View>;
}

function formatTime(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

function completedAnswerLabel(
  action: Extract<UiAction, { type: "submit-answer" | "choose-option" }>,
  question: UiQuestion,
): string {
  if (action.type === "submit-answer") {
    if (typeof action.answer === "string") return action.answer;
    if (action.answer.every((entry) => typeof entry === "string")) return action.answer.join(", ");
    const labels = new Map(question.choices?.map((choice) => [choice.id, choice.label]) ?? []);
    return action.answer.map((row) => `${row.item}: ${labels.get(row.optionId) ?? row.optionId}${row.reason ? ` — ${row.reason}` : ""}`).join(", ");
  }
  const labels = new Map(question.choices?.map((choice) => [choice.id, choice.label]) ?? []);
  return action.optionIds.map((id) => labels.get(id) ?? id).join(", ");
}

function confirmOpenResource(label: string, uri: string): void {
  const safe = safeMarkdownUri(uri, "link");
  if (!safe) return;
  Alert.alert("Open external resource?", `${label}\n${safe.hostname}`, [
    { text: "Cancel", style: "cancel" },
    { text: "Open", onPress: () => void Linking.openURL(safe.toString()) },
  ]);
}

function openHandoff(target: string): void {
  if (target !== "web") {
    Alert.alert("Handoff saved", `Continue this interaction in Keating ${target}.`);
    return;
  }
  Alert.alert("Open Keating on the web?", "The interaction context remains saved on this device.", [
    { text: "Cancel", style: "cancel" },
    { text: "Open web", onPress: () => void Linking.openURL("https://keating.help") },
  ]);
}

function createStyles(theme: ReturnType<typeof useKeatingTheme>) {
  const { colors, type } = theme;
  return StyleSheet.create({
    document: { gap: spacing.md, marginVertical: spacing.md, padding: spacing.md, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radii.lg, backgroundColor: colors.surface },
    documentHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
    documentTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
    documentTitle: { ...type.label, color: colors.text },
    lifecycle: { ...type.caption, ...type.mono, color: colors.textFaint, textTransform: "uppercase" },
    node: { gap: spacing.md, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
    callout: { gap: spacing.sm, padding: spacing.md, borderLeftWidth: 3, borderRadius: radii.md, backgroundColor: colors.surfaceRaised },
    callout_info: { borderLeftColor: colors.primaryStrong },
    callout_hint: { borderLeftColor: colors.primaryText },
    callout_check: { borderLeftColor: colors.success },
    callout_warning: { borderLeftColor: colors.warning },
    recovery: { gap: spacing.sm, padding: spacing.md, borderWidth: 1, borderColor: colors.warning, borderRadius: radii.md, backgroundColor: colors.surfaceRaised },
    nodeKicker: { ...type.caption, ...type.monoBold, color: colors.primaryText, letterSpacing: 0.8 },
    nodeTitle: { ...type.heading, color: colors.text },
    body: { ...type.body, color: colors.textMuted },
    question: { ...type.body, color: colors.text },
    quizQuestion: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm },
    questionNumber: { ...type.monoBold, color: colors.primaryText, paddingTop: spacing.md },
    options: { gap: spacing.sm },
    rowQuestion: { gap: spacing.sm, padding: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md },
    choiceWrap: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
    rowChoice: { minHeight: 40, justifyContent: "center", paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radii.pill },
    option: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md },
    optionActive: { borderColor: colors.primaryStrong, backgroundColor: colors.surfaceRaised },
    optionText: { ...type.body, color: colors.textMuted },
    optionTextActive: { color: colors.text },
    optionUnavailable: { opacity: 0.42 },
    input: { ...type.body, minHeight: 72, padding: spacing.md, color: colors.text, textAlignVertical: "top", borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.backgroundDeep },
    compactInput: { ...type.body, minHeight: 44, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, color: colors.text, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.backgroundDeep },
    notesInput: { ...type.body, minHeight: 144, padding: spacing.md, color: colors.text, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.backgroundDeep },
    savedAnswer: { ...type.caption, color: colors.primaryText, padding: spacing.sm, borderRadius: radii.sm, backgroundColor: colors.surfaceRaised },
    step: { minHeight: 52, flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md },
    planItem: { minHeight: 52, flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md },
    stepDone: { borderColor: colors.primaryStrong, backgroundColor: colors.surfaceRaised },
    stepMark: { ...type.body, color: colors.primaryText },
    stepTitle: { ...type.label, color: colors.text },
    criterion: { ...type.caption, color: colors.textMuted },
    flex: { flex: 1, gap: 2 },
    flashcard: { minHeight: 150, justifyContent: "center", alignItems: "center", gap: spacing.md, padding: spacing.lg, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radii.lg, backgroundColor: colors.backgroundDeep },
    cardFace: { ...type.heading, color: colors.text, textAlign: "center" },
    cardBack: { ...type.body, color: colors.primaryText, textAlign: "center" },
    revealHint: { ...type.caption, color: colors.textFaint },
    ratingRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
    ratingButton: { flexGrow: 1, minWidth: 68 },
    code: { ...type.mono, color: colors.text, padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.backgroundDeep },
    image: { width: "100%", height: 220, borderRadius: radii.md, backgroundColor: colors.surfaceRaised },
    audioPlayer: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.backgroundDeep },
    audioStatus: { ...type.caption, flex: 1, color: colors.textMuted },
    notice: { ...type.caption, color: colors.primaryText },
    error: { ...type.caption, color: colors.error },
    pressed: { backgroundColor: colors.surfacePressed },
  });
}
