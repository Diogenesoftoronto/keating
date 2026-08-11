import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Button } from "@/components/Buttons";
import { radii, spacing, useKeatingTheme } from "@/constants/theme";
import type { QuestionField, QuestionForm } from "@/lib/interactive-tags";
import { buildQuestionReport } from "@/lib/quiz-grading";
import { readCardState, writeCardState } from "@/state/card-state";

interface QuestionCardState {
  /** One answer string per field; multi-select answers are comma-joined. */
  answers: string[];
  submitted: boolean;
}

export function QuestionCard({
  form,
  cardKey,
  initialState,
  onSubmit,
}: {
  form: QuestionForm;
  cardKey: string;
  /** Durable answers reconstructed from the portable repository after restart. */
  initialState?: QuestionCardState;
  onSubmit: (answers: string[], report: string) => Promise<void>;
}) {
  const theme = useKeatingTheme();
  const styles = createStyles(theme);
  const [state, setState] = useState<QuestionCardState>(
    () => readCardState<QuestionCardState>(cardKey) ?? initialState ?? { answers: form.questions.map(() => ""), submitted: false },
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const durableStateSignature = initialState ? JSON.stringify(initialState) : null;

  useEffect(() => {
    if (!initialState) return;
    writeCardState(cardKey, initialState);
    setState((current) => JSON.stringify(current) === durableStateSignature ? current : initialState);
  }, [cardKey, durableStateSignature]);

  const persist = (next: QuestionCardState) => {
    writeCardState(cardKey, next);
    setState(next);
  };

  const setAnswer = (index: number, value: string) => {
    if (state.submitted) return;
    persist({ ...state, answers: state.answers.map((answer, i) => (i === index ? value : answer)) });
  };

  const answered = state.answers.filter((answer) => answer.trim()).length;

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(state.answers, buildQuestionReport(form.questions, state.answers, form.topic));
      persist({ ...state, submitted: true });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save these answers. They are still here; try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.card}>
      {form.intro ? <Text style={styles.intro}>{form.intro}</Text> : null}
      {form.questions.map((field, index) => (
        <QuestionFieldRow
          key={`${field.question}-${index}`}
          field={field}
          answer={state.answers[index] ?? ""}
          submitted={state.submitted}
          onChange={(value) => setAnswer(index, value)}
        />
      ))}
      {state.submitted ? (
        <Text style={styles.sent}>Answers sent to Keating.</Text>
      ) : (
        <Button onPress={() => void submit()} disabled={answered === 0 || submitting} compact>
          {submitting ? "Saving answers…" : "Send answers"}
        </Button>
      )}
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function QuestionFieldRow({
  field,
  answer,
  submitted,
  onChange,
}: {
  field: QuestionField;
  answer: string;
  submitted: boolean;
  onChange: (value: string) => void;
}) {
  const theme = useKeatingTheme();
  const { colors } = theme;
  const styles = createStyles(theme);
  // Multi-select answers are stored comma-joined so every field keeps one
  // string, which is also the shape the report needs.
  const selected = field.multiSelect ? answer.split(",").map((value) => value.trim()).filter(Boolean) : [answer.trim()];

  const toggle = (choice: string) => {
    if (!field.multiSelect) {
      onChange(answer.trim() === choice ? "" : choice);
      return;
    }
    const next = selected.includes(choice) ? selected.filter((value) => value !== choice) : [...selected, choice];
    onChange(next.join(", "));
  };

  return (
    <View style={styles.field}>
      {field.header ? <Text style={styles.header}>{field.header.toUpperCase()}</Text> : null}
      <Text style={styles.question}>{field.question}</Text>
      {field.hint ? <Text style={styles.hint}>{field.hint}</Text> : null}

      {field.choices ? (
        <View style={styles.choices}>
          {field.choices.map((choice) => {
            const active = selected.includes(choice);
            return (
              <Pressable
                key={choice}
                accessibilityRole={field.multiSelect ? "checkbox" : "radio"}
                accessibilityState={{ selected: active, disabled: submitted }}
                disabled={submitted}
                onPress={() => toggle(choice)}
                style={({ pressed }) => [
                  styles.choice,
                  active && styles.choiceActive,
                  pressed && !submitted && styles.choicePressed,
                ]}
              >
                <Text style={[styles.choiceText, active && styles.choiceTextActive]}>{choice}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {/* One answer slot per field, so a typed answer replaces a tapped choice
          rather than competing with it. Multi-select keeps its comma-joined
          value out of the input entirely. */}
      {!field.choices || (field.allowText && !field.multiSelect) ? (
        <TextInput
          style={styles.input}
          value={answer}
          editable={!submitted}
          multiline
          placeholder={field.blanks ? "Fill each blank, separated by |" : "Type your answer"}
          placeholderTextColor={colors.textFaint}
          onChangeText={onChange}
        />
      ) : null}
    </View>
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
  intro: { ...type.body, color: colors.textMuted },
  field: { gap: spacing.sm },
  header: { ...type.caption, ...type.mono, color: colors.primaryText, letterSpacing: 1 },
  question: { ...type.body, color: colors.text },
  hint: { ...type.caption, color: colors.textMuted },
  choices: { gap: spacing.sm },
  choice: {
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  choicePressed: { backgroundColor: colors.surfacePressed },
  choiceActive: { borderColor: colors.primaryStrong, backgroundColor: colors.surfaceRaised },
  choiceText: { ...type.body, color: colors.textMuted },
  choiceTextActive: { color: colors.text },
  input: {
    ...type.body,
    minHeight: 60,
    color: colors.text,
    textAlignVertical: "top",
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.backgroundDeep,
  },
  sent: { ...type.caption, color: colors.textMuted },
  error: { ...type.caption, color: colors.warning },
  });
}
