import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { spacing, useKeatingTheme } from "@/constants/theme";
import { buildTopicSlices } from "@/lib/usage-insights";
import type { TopicActivity } from "@/lib/usage-summary";

const SIZE = 168;
const CENTER = SIZE / 2;
const RADIUS = 58;
const CIRCUMFERENCE = Math.PI * 2 * RADIUS;
const PALETTE = ["#22c55e", "#2563eb", "#8b5cf6", "#ec4899", "#f59e0b", "#06b6d4", "#dc2626", "#64748b", "#84cc16"];

export function TopicWheel({ topics }: { topics: TopicActivity[] }) {
  const theme = useKeatingTheme();
  const styles = createStyles(theme);
  const slices = useMemo(() => buildTopicSlices(topics), [topics]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selected = slices.find((slice) => slice.key === selectedKey) ?? slices[0] ?? null;
  const total = slices.reduce((sum, slice) => sum + slice.count, 0);
  let offset = 0;

  if (!slices.length) return <Text style={styles.empty}>Record a named lesson or topic-linked artifact to build this view.</Text>;

  return (
    <View>
      <View style={styles.chartRow}>
        <View accessible accessibilityRole="image" accessibilityLabel={`Topic activity wheel with ${slices.length} slices and ${total} recorded evidence items`}>
          <Svg width={SIZE} height={SIZE} viewBox={`0 0 ${SIZE} ${SIZE}`}>
            <Circle cx={CENTER} cy={CENTER} r={RADIUS} fill="none" stroke={theme.colors.surfacePressed} strokeWidth={26} />
            {slices.map((slice, index) => {
              const start = offset;
              const length = slice.share * CIRCUMFERENCE;
              offset += length;
              return (
                <Circle
                  key={slice.key}
                  cx={CENTER}
                  cy={CENTER}
                  r={RADIUS}
                  fill="none"
                  stroke={PALETTE[index % PALETTE.length]}
                  strokeWidth={selected?.key === slice.key ? 30 : 24}
                  strokeDasharray={`${Math.max(0, length - 3)} ${CIRCUMFERENCE}`}
                  strokeDashoffset={-start}
                  strokeLinecap="butt"
                  rotation={-90}
                  origin={`${CENTER}, ${CENTER}`}
                />
              );
            })}
          </Svg>
          <View pointerEvents="none" style={styles.centerLabel}>
            <Text style={styles.centerValue}>{selected?.count ?? total}</Text>
            <Text numberOfLines={2} style={styles.centerCopy}>{selected?.label ?? "evidence"}</Text>
          </View>
        </View>
        <View style={styles.legend}>
          {slices.map((slice, index) => (
            <Pressable
              key={slice.key}
              accessibilityRole="button"
              accessibilityLabel={`${slice.label}, ${slice.count} recorded evidence item${slice.count === 1 ? "" : "s"}`}
              accessibilityState={{ selected: selected?.key === slice.key }}
              onPress={() => setSelectedKey(slice.key)}
              style={({ pressed }) => [styles.legendRow, selected?.key === slice.key && styles.legendSelected, pressed && styles.pressed]}
            >
              <View style={[styles.swatch, { backgroundColor: PALETTE[index % PALETTE.length] }]} />
              <Text numberOfLines={1} style={styles.legendLabel}>{slice.label}</Text>
              <Text style={styles.legendCount}>{Math.round(slice.share * 100)}%</Text>
            </Pressable>
          ))}
        </View>
      </View>
      {selected ? (
        <Text style={styles.detail}>
          {selected.count} recorded evidence item{selected.count === 1 ? "" : "s"} · {selected.turns} messages · {selected.source}
        </Text>
      ) : null}
    </View>
  );
}

function createStyles(theme: ReturnType<typeof useKeatingTheme>) {
  const { colors, type } = theme;
  return StyleSheet.create({
    empty: { ...type.body, color: colors.textMuted, paddingVertical: spacing.md },
    chartRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.md },
    centerLabel: { position: "absolute", inset: 0, alignItems: "center", justifyContent: "center", paddingHorizontal: 42 },
    centerValue: { ...type.heading, ...type.monoBold, color: colors.text },
    centerCopy: { ...type.caption, color: colors.textMuted, textAlign: "center" },
    legend: { flex: 1, minWidth: 170 },
    legendRow: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.sm, borderRadius: 10 },
    legendSelected: { backgroundColor: colors.surfacePressed },
    swatch: { width: 12, height: 12, borderRadius: 3 },
    legendLabel: { ...type.caption, flex: 1, color: colors.text },
    legendCount: { ...type.caption, ...type.mono, color: colors.textMuted },
    detail: { ...type.caption, color: colors.textMuted, lineHeight: 19, marginTop: spacing.sm },
    pressed: { opacity: 0.72 },
  });
}
