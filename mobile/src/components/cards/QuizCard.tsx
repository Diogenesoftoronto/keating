import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Button } from "@/components/Buttons";
import { MarkdownText } from "@/components/MarkdownText";
import { radii, spacing, useKeatingTheme } from "@/constants/theme";
import type { Quiz, QuizQuestion } from "@/lib/interactive-tags";
import { buildQuizReport, isCorrect, isOpenEnded, scoreQuiz } from "@/lib/quiz-grading";
import { readCardState, writeCardState } from "@/state/card-state";

interface QuizCardState {
  answers: Record<string, string>;
  submitted: boolean;
}

export function QuizCard({
  quiz,
  cardKey,
  initialState,
  onSubmit,
}: {
  quiz: Quiz;
  cardKey: string;
  /** Durable answers reconstructed from the portable repository after restart. */
  initialState?: QuizCardState;
  /** Persists the quiz before reporting it as a new learner turn. */
  onSubmit: (answers: Record<string, string>, report: string) => Promise<void>;
}) {
  const theme = useKeatingTheme();
  const styles = createStyles(theme);
  const [state, setState] = useState<QuizCardState>(
    () => readCardState<QuizCardState>(cardKey) ?? initialState ?? { answers: {}, submitted: false },
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const durableStateSignature = initialState ? JSON.stringify(initialState) : null;

  useEffect(() => {
    if (!initialState) return;
    writeCardState(cardKey, initialState);
    setState((current) => JSON.stringify(current) === durableStateSignature ? current : initialState);
  }, [cardKey, durableStateSignature]);

  const persist = (next: QuizCardState) => {
    writeCardState(cardKey, next);
    setState(next);
  };

  const setAnswer = (id: string, value: string) => {
    if (state.submitted) return;
    persist({ ...state, answers: { ...state.answers, [id]: value } });
  };

  const score = useMemo(
    () => (state.submitted ? scoreQuiz(quiz.questions, state.answers) : null),
    [quiz.questions, state.answers, state.submitted],
  );
  const answered = quiz.questions.filter((question) => (state.answers[question.id] ?? "").trim()).length;

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(state.answers, buildQuizReport(quiz.topic, quiz.questions, state.answers));
      persist({ ...state, submitted: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this quiz. Your answers are still here; try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.kicker}>RETRIEVAL PRACTICE</Text>
        <Text style={styles.title}>{quiz.topic}</Text>
      </View>

      {quiz.questions.map((question, index) => (
        <QuizQuestionRow
          key={question.id}
          index={index}
          question={question}
          answer={state.answers[question.id] ?? ""}
          submitted={state.submitted}
          onChange={(value) => setAnswer(question.id, value)}
        />
      ))}

      {score ? (
        <View style={styles.scoreBox}>
          <Text style={styles.scoreValue}>
            {score.correct}/{score.total} correct · {score.percent}%
          </Text>
          <Text style={styles.scoreNote}>
            {score.hasOpenEnded
              ? "Written answers are scored loosely here — Keating gives the real verdict below."
              : "Answers sent to Keating for review."}
          </Text>
        </View>
      ) : (
        <Button onPress={() => void submit()} disabled={answered === 0 || submitting}>
          {submitting ? "Saving quiz…" : answered === quiz.questions.length ? "Submit quiz" : `Submit (${answered}/${quiz.questions.length} answered)`}
        </Button>
      )}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function QuizQuestionRow({
  index,
  question,
  answer,
  submitted,
  onChange,
}: {
  index: number;
  question: QuizQuestion;
  answer: string;
  submitted: boolean;
  onChange: (value: string) => void;
}) {
  const theme = useKeatingTheme();
  const { colors } = theme;
  const styles = createStyles(theme);
  const correct = submitted && isCorrect(question, answer);
  const options = question.type === "true_false" ? (question.options ?? ["True", "False"]) : question.options;

  return (
    <View style={styles.question}>
      <View style={styles.questionHead}>
        <Text style={styles.questionNumber}>{index + 1}</Text>
        <Text style={styles.questionText}>{question.question}</Text>
      </View>

      {options ? (
        <View style={styles.options}>
          {options.map((option) => (
            <QuizOption
              key={option}
              label={option}
              selected={answer.trim().toLowerCase() === option.trim().toLowerCase()}
              // After submission the key is revealed rather than only the verdict,
              // so a wrong pick still teaches.
              revealed={submitted && option.trim().toLowerCase() === question.correctAnswer.trim().toLowerCase()}
              disabled={submitted}
              onPress={() => onChange(option)}
            />
          ))}
        </View>
      ) : (
        <TextInput
          style={[styles.input, submitted && (correct ? styles.inputCorrect : styles.inputWrong)]}
          value={answer}
          editable={!submitted}
          multiline
          placeholder={question.blanks ? "Answer each blank, separated by |" : "Your answer"}
          placeholderTextColor={colors.textFaint}
          onChangeText={onChange}
        />
      )}

      {submitted ? (
        <View style={styles.feedback}>
          <Text style={[styles.verdict, correct ? styles.verdictCorrect : styles.verdictWrong]}>
            {correct ? "Correct" : isOpenEnded(question) ? "Awaiting Keating's verdict" : "Not quite"}
          </Text>
          {!correct && !options ? <Text style={styles.reference}>Reference: {question.correctAnswer}</Text> : null}
          {question.explanation ? <MarkdownText content={question.explanation} /> : null}
        </View>
      ) : null}
    </View>
  );
}

function QuizOption({
  label,
  selected,
  revealed,
  disabled,
  onPress,
}: {
  label: string;
  selected: boolean;
  revealed: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const styles = createStyles(useKeatingTheme());
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.option,
        selected && styles.optionSelected,
        revealed && styles.optionRevealed,
        pressed && !disabled && styles.optionPressed,
      ]}
    >
      <View style={[styles.marker, selected && styles.markerSelected, revealed && styles.markerRevealed]} />
      <Text style={[styles.optionText, (selected || revealed) && styles.optionTextActive]}>{label}</Text>
    </Pressable>
  );
}

function createStyles(theme: ReturnType<typeof useKeatingTheme>) {
  const { colors, type } = theme;
  return StyleSheet.create({
  card: {
    marginVertical: spacing.md,
    gap: spacing.lg,
    padding: spacing.lg,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  header: { gap: spacing.xs },
  kicker: { ...type.caption, ...type.monoBold, color: colors.primaryText, letterSpacing: 1 },
  title: { ...type.heading, color: colors.text },
  question: { gap: spacing.sm },
  questionHead: { flexDirection: "row", gap: spacing.sm },
  questionNumber: { ...type.label, ...type.mono, color: colors.primaryText, minWidth: 20 },
  questionText: { ...type.body, color: colors.text, flex: 1 },
  options: { gap: spacing.sm },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: 44,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  optionPressed: { backgroundColor: colors.surfacePressed },
  optionSelected: { borderColor: colors.primaryStrong, backgroundColor: colors.surfaceRaised },
  optionRevealed: { borderColor: colors.primary, backgroundColor: colors.surfaceRaised },
  marker: { width: 14, height: 14, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.borderStrong },
  markerSelected: { backgroundColor: colors.primaryStrong, borderColor: colors.primaryStrong },
  markerRevealed: { backgroundColor: colors.primary, borderColor: colors.primary },
  optionText: { ...type.body, color: colors.textMuted, flex: 1 },
  optionTextActive: { color: colors.text },
  input: {
    ...type.body,
    minHeight: 72,
    color: colors.text,
    textAlignVertical: "top",
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.backgroundDeep,
  },
  inputCorrect: { borderColor: colors.primaryStrong },
  inputWrong: { borderColor: colors.warning },
  feedback: { gap: spacing.xs, paddingLeft: spacing.lg },
  verdict: { ...type.caption, fontWeight: "700", letterSpacing: 0.5 },
  verdictCorrect: { color: colors.success },
  verdictWrong: { color: colors.warning },
  reference: { ...type.caption, color: colors.textMuted },
  scoreBox: {
    gap: spacing.xs,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceRaised,
  },
  scoreValue: { ...type.label, color: colors.text },
  scoreNote: { ...type.caption, color: colors.textMuted },
  error: { ...type.caption, color: colors.warning },
  });
}
