import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Circle, Line, Path, Text as SvgText } from "react-native-svg";
import type { BenchmarkHistoryRecord, EvolutionHistoryRecord } from "@keating/learner-contracts";
import { radii, spacing, useKeatingTheme } from "@/constants/theme";
import { buildEvaluationTrend, evaluationPath } from "@/lib/evaluation-history";

interface Props {
  benchmarks: readonly BenchmarkHistoryRecord[];
  evolutions: readonly EvolutionHistoryRecord[];
}

export function SelfEvolutionChart({ benchmarks, evolutions }: Props) {
  const theme = useKeatingTheme();
  const styles = createStyles(theme);
  const trend = useMemo(() => buildEvaluationTrend(benchmarks, evolutions), [benchmarks, evolutions]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const selected = trend.points.find((point) => `${point.kind}:${point.id}` === selectedKey);
  const recentEvolutions = [...evolutions]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
    .slice(0, 6);

  if (!trend.points.length) {
    return <Text style={styles.empty}>No self-evolution records yet. Run a benchmark or evolution on web or in the Keating runtime, then import or sync that portable history.</Text>;
  }

  return (
    <View>
      <View style={styles.metrics}>
        <Metric label="Latest benchmark" value={trend.latestBenchmark?.score.toFixed(1) ?? "none"} styles={styles} />
        <Metric label="Latest evolution" value={trend.latestEvolution?.bestScore.toFixed(1) ?? "none"} styles={styles} />
        <Metric label="Recorded runs" value={String(trend.points.length)} styles={styles} />
      </View>
      {!trend.hasMeaningfulScores ? (
        <Text style={styles.notice}>Scores are recorded, but they are all 0.0. Do not treat this as a trend until a later run records a meaningful score.</Text>
      ) : (
        <View accessible accessibilityRole="image" accessibilityLabel={`Self-evolution score trend with ${benchmarks.length} benchmark and ${evolutions.length} evolution runs`}>
          <Svg width="100%" height={150} viewBox="0 0 320 150">
            {[0, 25, 50, 75, 100].map((score) => {
              const y = 122 - (score / 100) * 112;
              return <ViewBoxLine key={score} score={score} y={y} color={theme.colors.border} muted={theme.colors.textMuted} />;
            })}
            {trend.benchmarkPoints.length > 1 ? <Path d={evaluationPath(trend.benchmarkPoints)} fill="none" stroke="#6366f1" strokeWidth={2} /> : null}
            {trend.evolutionPoints.length > 1 ? <Path d={evaluationPath(trend.evolutionPoints)} fill="none" stroke="#22c55e" strokeWidth={2} /> : null}
            {trend.points.map((point) => (
              <Circle
                key={`${point.kind}:${point.id}`}
                cx={point.x}
                cy={point.y}
                r={selectedKey === `${point.kind}:${point.id}` ? 6 : 4}
                fill={point.kind === "benchmark" ? "#6366f1" : "#22c55e"}
                stroke={theme.colors.surface}
                strokeWidth={2}
                onPress={() => setSelectedKey(`${point.kind}:${point.id}`)}
              />
            ))}
          </Svg>
        </View>
      )}
      <View style={styles.legend}>
        <Legend color="#6366f1" label="Benchmark scores" styles={styles} />
        <Legend color="#22c55e" label="Evolved policy scores" styles={styles} />
      </View>
      {selected ? (
        <Text accessibilityLiveRegion="polite" style={styles.selection}>
          {selected.kind === "benchmark" ? "Benchmark" : "Evolution"} score {selected.score.toFixed(2)} · {formatDate(selected.createdAt)}
        </Text>
      ) : null}
      {recentEvolutions.length ? (
        <View style={styles.history}>
          {recentEvolutions.map((evolution) => (
            <Pressable
              key={evolution.id}
              onPress={() => setSelectedKey(`evolution:${evolution.id}`)}
              accessibilityRole="button"
              accessibilityLabel={`Evolution ${evolution.topic ?? "General teaching policy"}, score ${evolution.bestScore.toFixed(2)}`}
              style={({ pressed }) => [styles.historyRow, pressed && styles.pressed]}
            >
              <Text style={styles.historyTitle}>{evolution.topic ?? "General teaching policy"}</Text>
              <Text style={styles.historyMeta}>Score {evolution.bestScore.toFixed(2)} · {formatDate(evolution.createdAt)}</Text>
              <Text numberOfLines={2} style={styles.policy}>{evolution.policy}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function ViewBoxLine({ score, y, color, muted }: { score: number; y: number; color: string; muted: string }) {
  return <>
    <Line x1={28} y1={y} x2={310} y2={y} stroke={color} strokeWidth={1} />
    <SvgText x={0} y={y + 4} fontSize={10} fill={muted}>{score}</SvgText>
  </>;
}

function Metric({ label, value, styles }: { label: string; value: string; styles: ReturnType<typeof createStyles> }) {
  return <View style={styles.metric}><Text style={styles.metricLabel}>{label}</Text><Text style={styles.metricValue}>{value}</Text></View>;
}

function Legend({ color, label, styles }: { color: string; label: string; styles: ReturnType<typeof createStyles> }) {
  return <View style={styles.legendItem}><View style={[styles.swatch, { backgroundColor: color }]} /><Text style={styles.legendText}>{label}</Text></View>;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(Date.parse(value));
}

function createStyles(theme: ReturnType<typeof useKeatingTheme>) {
  const { colors, type } = theme;
  return StyleSheet.create({
    empty: { ...type.body, color: colors.textMuted, paddingVertical: spacing.md },
    metrics: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.sm },
    metric: { flexGrow: 1, minWidth: 96, borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm, padding: spacing.sm },
    metricLabel: { ...type.caption, color: colors.textMuted },
    metricValue: { ...type.label, ...type.monoBold, color: colors.text, marginTop: 2 },
    notice: { ...type.caption, color: colors.textMuted, borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm, padding: spacing.md },
    legend: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, marginTop: spacing.xs },
    legendItem: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
    swatch: { width: 18, height: 6, borderRadius: 99 },
    legendText: { ...type.caption, color: colors.textMuted },
    selection: { ...type.caption, color: colors.text, backgroundColor: colors.surfaceRaised, borderRadius: radii.sm, padding: spacing.sm, marginTop: spacing.sm },
    history: { borderTopWidth: 1, borderTopColor: colors.border, marginTop: spacing.md },
    historyRow: { minHeight: 64, borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: spacing.sm },
    pressed: { opacity: 0.7 },
    historyTitle: { ...type.label, color: colors.text },
    historyMeta: { ...type.caption, color: colors.textMuted, marginTop: 2 },
    policy: { ...type.caption, color: colors.textMuted, marginTop: spacing.xs },
  });
}
