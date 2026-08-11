import Ionicons from "@expo/vector-icons/Ionicons";
import type { AgentStreamEvent } from "@keating/learner-contracts";
import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { radii, spacing, useKeatingTheme } from "@/constants/theme";
import { useUiSettings } from "@/state/UiSettingsProvider";
import { UiDocumentRenderer } from "@/components/UiDocumentRenderer";
import { MessageContent } from "@/components/MessageContent";
import { orderedAgentTraceItems } from "@/lib/agent-trace-order";

export function AgentTrace({
  events,
  streaming,
  sessionId,
  messageId,
  ordered = false,
  onLearnerTurn,
}: {
  events: readonly AgentStreamEvent[];
  streaming: boolean;
  sessionId?: string;
  messageId: string;
  /** Render text and tools from sequence order; the caller must suppress duplicate message content. */
  ordered?: boolean;
  onLearnerTurn: (text: string) => Promise<void>;
}) {
  const { settings } = useUiSettings();
  const orderedItems = useMemo(() => ordered ? orderedAgentTraceItems(events) : [], [events, ordered]);
  const calls = useMemo(() => {
    const results = new Map(events.filter((event): event is Extract<AgentStreamEvent, { type: "tool-result" }> => event.type === "tool-result")
      .map((event) => [event.result.toolCallId, event.result]));
    return events.filter((event): event is Extract<AgentStreamEvent, { type: "tool-call" }> => event.type === "tool-call")
      .map((event) => ({ ...event.call, result: results.get(event.call.id) }));
  }, [events]);
  const styles = stylesFor(useKeatingTheme());
  if (ordered) {
    return (
      <View style={styles.trace}>
        {orderedItems.map((item, index) => {
          if (item.type === "text") return (
            <MessageContent
              key={item.id}
              messageId={`${messageId}:${item.id}`}
              content={item.text}
              streaming={streaming && index === orderedItems.length - 1}
              onCardResult={onLearnerTurn}
            />
          );
          if (item.type === "reasoning") return settings.showReasoning && item.text.trim()
            ? <ReasoningDisclosure key={item.id} text={item.text.trim()} defaultOpen={settings.autoExpandReasoning} />
            : null;
          if (item.type === "tool") return (
            <ToolDisclosure key={item.id} call={{ ...item.call, result: item.result }} streaming={streaming} detailsEnabled={settings.showToolDetails} />
          );
          if (item.type === "document") return settings.showToolUi ? (
            <UiDocumentRenderer
              key={`${item.document.id}:${item.document.revision}`}
              sourceDocument={item.document}
              sessionId={sessionId}
              onLearnerTurn={onLearnerTurn}
            />
          ) : null;
          return <Text key={item.id} accessibilityRole="alert" style={styles.traceError}>{item.message}</Text>;
        })}
      </View>
    );
  }
  const reasoning = events.filter((event): event is Extract<AgentStreamEvent, { type: "reasoning-delta" }> => event.type === "reasoning-delta")
    .map((event) => event.text).join("").trim();
  const documents = events.filter((event): event is Extract<AgentStreamEvent, { type: "ui-document" }> => event.type === "ui-document")
    .map((event) => event.document);
  const errors = events.filter((event): event is Extract<AgentStreamEvent, { type: "error" }> => event.type === "error");
  return (
    <View style={styles.trace}>
      {settings.showReasoning && reasoning ? <ReasoningDisclosure text={reasoning} defaultOpen={settings.autoExpandReasoning} /> : null}
      {calls.map((call) => <ToolDisclosure key={call.id} call={call} streaming={streaming} detailsEnabled={settings.showToolDetails} />)}
      {settings.showToolUi ? documents.map((document) => (
        <UiDocumentRenderer
          key={`${document.id}:${document.revision}`}
          sourceDocument={document}
          sessionId={sessionId}
          onLearnerTurn={onLearnerTurn}
        />
      )) : null}
      {errors.map((event) => <Text key={event.id} accessibilityRole="alert" style={styles.traceError}>{event.message}</Text>)}
    </View>
  );
}

function ReasoningDisclosure({ text, defaultOpen }: { text: string; defaultOpen: boolean }) {
  const theme = useKeatingTheme();
  const styles = stylesFor(theme);
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => setOpen(defaultOpen), [defaultOpen]);
  return (
    <View style={styles.disclosure}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${open ? "Hide" : "Show"} reasoning summary`}
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((current) => !current)}
        style={({ pressed }) => [styles.header, pressed && styles.pressed]}
      >
        <Ionicons name={open ? "chevron-down" : "chevron-forward"} size={16} color={theme.colors.textMuted} />
        <Text style={styles.headerLabel}>Reasoning summary</Text>
      </Pressable>
      {open ? <Text selectable style={styles.detail}>{text}</Text> : null}
    </View>
  );
}

function ToolDisclosure({
  call,
  streaming,
  detailsEnabled,
}: {
  call: { id: string; name: string; arguments: Record<string, unknown>; result?: { status: "success" | "error" | "retryable"; text: string } };
  streaming: boolean;
  detailsEnabled: boolean;
}) {
  const theme = useKeatingTheme();
  const styles = stylesFor(theme);
  const [open, setOpen] = useState(false);
  const state = call.result?.status ?? (streaming ? "running" : "requested");
  const icon = state === "success" ? "checkmark-circle" : state === "error" ? "alert-circle" : state === "retryable" ? "refresh-circle" : "hammer-outline";
  const color = state === "success" ? theme.colors.success : state === "error" ? theme.colors.error : theme.colors.warning;
  return (
    <View style={[styles.tool, state === "error" && styles.toolError]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${detailsEnabled && open ? "Hide" : "Show"} ${call.name} tool details, ${state}`}
        accessibilityState={{ expanded: detailsEnabled && open, disabled: !detailsEnabled }}
        disabled={!detailsEnabled}
        onPress={() => setOpen((current) => !current)}
        style={({ pressed }) => [styles.header, pressed && styles.pressed]}
      >
        <Ionicons name={icon} size={16} color={color} />
        <Text style={styles.toolPrefix}>Tool</Text>
        <Text numberOfLines={1} style={styles.toolName}>{call.name}</Text>
        <Text style={[styles.status, { color }]}>{state}</Text>
        {detailsEnabled ? <Ionicons name={open ? "chevron-down" : "chevron-forward"} size={15} color={theme.colors.textMuted} /> : null}
      </Pressable>
      {detailsEnabled && open ? (
        <View style={styles.toolDetail}>
          <Text selectable style={styles.mono}>{JSON.stringify(redactTraceValue(call.arguments), null, 2)}</Text>
          {call.result ? <Text selectable style={styles.detail}>{redactTraceText(call.result.text)}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

export function redactTraceValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactTraceValue);
  if (typeof value !== "object" || value === null) return typeof value === "string" ? redactTraceText(value) : value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    /key|token|secret|authorization|password|credential/i.test(key) ? "[redacted]" : redactTraceValue(item),
  ]));
}

function redactTraceText(value: string): string {
  return value
    .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|AIza[A-Za-z0-9_-]{12,}|ghp_[A-Za-z0-9]{12,})\b/g, "[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~-]+/gi, "Bearer [redacted]");
}

function stylesFor(theme: ReturnType<typeof useKeatingTheme>) {
  const { colors, type } = theme;
  return StyleSheet.create({
    trace: { gap: spacing.sm, marginBottom: spacing.md },
    disclosure: { borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm, backgroundColor: colors.surfaceRaised },
    tool: { borderWidth: 1, borderColor: colors.warning, borderRadius: radii.sm, backgroundColor: colors.surfaceRaised },
    toolError: { borderColor: colors.error, backgroundColor: colors.errorSurface },
    header: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md },
    headerLabel: { ...type.label, flex: 1, color: colors.textMuted },
    detail: { ...type.caption, color: colors.textMuted, lineHeight: 19, paddingHorizontal: spacing.md, paddingBottom: spacing.md },
    toolPrefix: { ...type.caption, color: colors.textMuted },
    toolName: { ...type.caption, ...type.monoBold, flex: 1, color: colors.text },
    status: { ...type.caption, textTransform: "capitalize" },
    toolDetail: { borderTopWidth: 1, borderTopColor: colors.border, padding: spacing.md, gap: spacing.sm },
    mono: { ...type.caption, ...type.mono, color: colors.textMuted },
    traceError: { ...type.caption, color: colors.error, padding: spacing.sm, borderRadius: radii.sm, backgroundColor: colors.errorSurface },
    pressed: { backgroundColor: colors.surfacePressed },
  });
}
