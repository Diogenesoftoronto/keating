import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { spacing, useKeatingTheme } from "@/constants/theme";
import { activityYears, buildActivityCalendar, type ActivityDay } from "@/lib/usage-insights";
import type { SessionStartActivity } from "@/lib/usage-summary";

interface ActivityCalendarProps {
  sessionStarts: SessionStartActivity[];
  onOpenSession: (sessionId: string) => void;
}

export function ActivityCalendar({ sessionStarts, onOpenSession }: ActivityCalendarProps) {
  const theme = useKeatingTheme();
  const styles = createStyles(theme);
  const years = useMemo(() => activityYears(sessionStarts), [sessionStarts]);
  const [requestedYear, setRequestedYear] = useState(() => years[0] ?? new Date().getFullYear());
  const year = years.includes(requestedYear) ? requestedYear : years[0] ?? new Date().getFullYear();
  const calendar = useMemo(() => buildActivityCalendar(year, sessionStarts), [sessionStarts, year]);
  const activeDays = calendar.days.filter((day) => day.count > 0);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selected = calendar.days.find((day) => day.key === selectedKey && day.count > 0)
    ?? activeDays.at(-1)
    ?? null;
  const cells: Array<ActivityDay | null> = [
    ...Array.from({ length: calendar.leadingEmptyDays }, () => null),
    ...calendar.days,
  ];
  const weeks = Array.from({ length: Math.ceil(cells.length / 7) }, (_, index) => cells.slice(index * 7, index * 7 + 7));

  if (!sessionStarts.length) {
    return <Text style={styles.empty}>Start a lesson to add its first day to this calendar.</Text>;
  }

  return (
    <View>
      <View accessibilityRole="tablist" style={styles.years}>
        {years.map((candidate) => (
          <Pressable
            key={candidate}
            accessibilityRole="tab"
            accessibilityState={{ selected: candidate === year }}
            onPress={() => { setRequestedYear(candidate); setSelectedKey(null); }}
            style={({ pressed }) => [styles.yearButton, candidate === year && styles.yearSelected, pressed && styles.pressed]}
          >
            <Text style={[styles.yearText, candidate === year && styles.yearTextSelected]}>{candidate}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.calendarRow}>
        <View style={styles.weekdayLabels} importantForAccessibility="no-hide-descendants">
          {['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((label, index) => <Text key={`${label}-${index}`} style={styles.weekday}>{label}</Text>)}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.weeks}>
          {weeks.map((week, weekIndex) => (
            <View key={weekIndex} style={styles.week}>
              {week.map((day, dayIndex) => day ? (
                <Pressable
                  key={day.key}
                  accessibilityRole="button"
                  accessibilityLabel={`${formatDay(day)}, ${day.count} lesson${day.count === 1 ? "" : "s"} started`}
                  accessibilityState={{ selected: selected?.key === day.key }}
                  disabled={day.count === 0}
                  hitSlop={5}
                  onPress={() => setSelectedKey(day.key)}
                  style={styles.cellTarget}
                >
                  <View style={[
                    styles.cell,
                    { backgroundColor: activityColor(theme.colors.surfacePressed, theme.colors.primary, day.count, calendar.maxCount) },
                    selected?.key === day.key && styles.cellSelected,
                  ]} />
                </Pressable>
              ) : <View key={`empty-${dayIndex}`} style={styles.cellTarget} />)}
            </View>
          ))}
        </ScrollView>
      </View>

      {selected ? (
        <View style={styles.selection}>
          <Text style={styles.selectionTitle}>{formatDay(selected)}</Text>
          <Text style={styles.selectionCount}>{selected.count} lesson{selected.count === 1 ? "" : "s"} started</Text>
          {selected.sessions.map((session) => (
            <Pressable
              key={session.id}
              accessibilityRole="button"
              accessibilityLabel={`Open lesson ${session.title}`}
              onPress={() => onOpenSession(session.id)}
              style={({ pressed }) => [styles.session, pressed && styles.pressed]}
            >
              <Text numberOfLines={1} style={styles.sessionTitle}>{session.title}</Text>
              <Text style={styles.sessionMeta}>{session.messages} messages</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function formatDay(day: ActivityDay): string {
  return new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric", year: "numeric" })
    .format(new Date(day.year, day.month - 1, day.day));
}

function activityColor(empty: string, active: string, count: number, maxCount: number): string {
  if (!count || !maxCount) return empty;
  return mixHex(empty, active, 0.3 + (count / maxCount) * 0.7);
}

function mixHex(background: string, foreground: string, weight: number): string {
  if (!/^#[0-9a-f]{6}$/i.test(background) || !/^#[0-9a-f]{6}$/i.test(foreground)) return foreground;
  const channels = (value: string) => [1, 3, 5].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
  const base = channels(background);
  const overlay = channels(foreground);
  return `#${base.map((channel, index) => Math.round(channel * (1 - weight) + overlay[index]! * weight).toString(16).padStart(2, "0")).join("")}`;
}

function createStyles(theme: ReturnType<typeof useKeatingTheme>) {
  const { colors, type } = theme;
  return StyleSheet.create({
    empty: { ...type.body, color: colors.textMuted, paddingVertical: spacing.md },
    years: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.sm },
    yearButton: { minHeight: 44, minWidth: 58, alignItems: "center", justifyContent: "center", borderRadius: 10 },
    yearSelected: { backgroundColor: colors.surfacePressed },
    yearText: { ...type.label, color: colors.textMuted },
    yearTextSelected: { color: colors.primaryText },
    calendarRow: { flexDirection: "row" },
    weekdayLabels: { paddingTop: 2 },
    weekday: { ...type.caption, color: colors.textFaint, width: 18, height: 30, lineHeight: 30, textAlign: "center" },
    weeks: { gap: 2, paddingHorizontal: spacing.xs, paddingBottom: spacing.sm },
    week: { gap: 2 },
    cellTarget: { width: 30, height: 30, alignItems: "center", justifyContent: "center" },
    cell: { width: 18, height: 18, borderRadius: 4 },
    cellSelected: { borderWidth: 2, borderColor: colors.text },
    selection: { marginTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, paddingTop: spacing.md },
    selectionTitle: { ...type.label, color: colors.text },
    selectionCount: { ...type.caption, color: colors.textMuted, marginTop: 2, marginBottom: spacing.xs },
    session: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border },
    sessionTitle: { ...type.body, flex: 1, color: colors.text },
    sessionMeta: { ...type.caption, color: colors.textMuted },
    pressed: { opacity: 0.72 },
  });
}
