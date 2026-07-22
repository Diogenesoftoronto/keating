import { Fragment, type ReactNode, useState } from "react";
import { Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { colors, radii, spacing, type } from "@/constants/theme";

type Block = { type: "text"; value: string } | { type: "code"; value: string; language: string };

function markdownBlocks(content: string): Block[] {
  const blocks: Block[] = [];
  const expression = /```([^\n`]*)\n?([\s\S]*?)```/g;
  let cursor = 0;
  for (const match of content.matchAll(expression)) {
    const index = match.index ?? 0;
    if (index > cursor) blocks.push({ type: "text", value: content.slice(cursor, index) });
    blocks.push({ type: "code", language: match[1].trim(), value: match[2].trimEnd() });
    cursor = index + match[0].length;
  }
  if (cursor < content.length) blocks.push({ type: "text", value: content.slice(cursor) });
  return blocks.length > 0 ? blocks : [{ type: "text", value: content }];
}

function Spoiler({ children }: { children: string }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <Text
      accessibilityRole="button"
      accessibilityLabel={revealed ? "Hide answer" : "Reveal answer"}
      accessibilityState={{ expanded: revealed }}
      onPress={() => setRevealed((current) => !current)}
      style={revealed ? styles.spoilerRevealed : styles.spoilerHidden}
    >
      {revealed ? children : "Tap to reveal"}
    </Text>
  );
}

function inlineNodes(value: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const expression = /(\|\|[^|]+\|\||\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let cursor = 0;
  let key = 0;
  for (const match of value.matchAll(expression)) {
    const index = match.index ?? 0;
    if (index > cursor) nodes.push(value.slice(cursor, index));
    const token = match[0];
    if (token.startsWith("||")) {
      nodes.push(<Spoiler key={key++}>{token.slice(2, -2)}</Spoiler>);
    } else if (token.startsWith("**")) {
      nodes.push(<Text key={key++} style={styles.bold}>{token.slice(2, -2)}</Text>);
    } else if (token.startsWith("`")) {
      nodes.push(<Text key={key++} style={styles.inlineCode}>{token.slice(1, -1)}</Text>);
    } else {
      const link = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (link) {
        nodes.push(
          <Text key={key++} style={styles.link} accessibilityRole="link" onPress={() => void Linking.openURL(link[2])}>
            {link[1]}
          </Text>,
        );
      }
    }
    cursor = index + token.length;
  }
  if (cursor < value.length) nodes.push(value.slice(cursor));
  return nodes;
}

function TextBlock({ value }: { value: string }) {
  const lines = value.split("\n");
  return (
    <View style={styles.textBlock}>
      {lines.map((rawLine, index) => {
        const line = rawLine.trimEnd();
        if (!line.trim()) return <View key={index} style={styles.spacer} />;
        const heading = line.match(/^(#{1,3})\s+(.+)$/);
        if (heading) {
          return <Text key={index} style={[styles.paragraph, heading[1].length === 1 ? styles.h1 : styles.h2]}>{inlineNodes(heading[2])}</Text>;
        }
        const bullet = line.match(/^\s*[-*]\s+(.+)$/);
        if (bullet) {
          return (
            <View key={index} style={styles.listRow}>
              <Text style={styles.bullet}>•</Text>
              <Text style={[styles.paragraph, styles.listText]}>{inlineNodes(bullet[1])}</Text>
            </View>
          );
        }
        const numbered = line.match(/^\s*(\d+)\.\s+(.+)$/);
        if (numbered) {
          return (
            <View key={index} style={styles.listRow}>
              <Text style={styles.number}>{numbered[1]}.</Text>
              <Text style={[styles.paragraph, styles.listText]}>{inlineNodes(numbered[2])}</Text>
            </View>
          );
        }
        if (line.startsWith("> ")) {
          return <Text key={index} style={[styles.paragraph, styles.quote]}>{inlineNodes(line.slice(2))}</Text>;
        }
        return <Text key={index} style={styles.paragraph}>{inlineNodes(line)}</Text>;
      })}
    </View>
  );
}

export function MarkdownText({ content }: { content: string }) {
  return (
    <View>
      {markdownBlocks(content).map((block, index) => (
        <Fragment key={index}>
          {block.type === "code" ? (
            <View style={styles.codeFrame}>
              {block.language ? <Text style={styles.codeLanguage}>{block.language}</Text> : null}
              <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.codeScroller}>
                <Text selectable style={styles.code}>{block.value}</Text>
              </ScrollView>
            </View>
          ) : <TextBlock value={block.value} />}
        </Fragment>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  textBlock: { gap: 2 },
  paragraph: { ...type.body, color: colors.text },
  bold: { fontWeight: "700" },
  inlineCode: { ...type.mono, color: colors.primary, backgroundColor: colors.backgroundDeep },
  spoilerHidden: {
    ...type.label,
    color: colors.primaryInk,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.sm,
  },
  spoilerRevealed: {
    ...type.body,
    color: colors.text,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.sm,
  },
  link: { color: colors.primary, textDecorationLine: "underline" },
  h1: { ...type.heading, marginTop: spacing.md, marginBottom: spacing.xs },
  h2: { ...type.label, fontSize: 16, marginTop: spacing.md, marginBottom: spacing.xs },
  spacer: { height: spacing.sm },
  listRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, paddingLeft: spacing.xs },
  bullet: { ...type.body, color: colors.primary, width: 12 },
  number: { ...type.body, ...type.mono, color: colors.primary, minWidth: 24 },
  listText: { flex: 1 },
  quote: {
    color: colors.textMuted,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radii.sm,
  },
  codeFrame: {
    marginVertical: spacing.md,
    overflow: "hidden",
    borderRadius: radii.md,
    backgroundColor: colors.backgroundDeep,
    borderWidth: 1,
    borderColor: colors.border,
  },
  codeLanguage: {
    ...type.caption,
    ...type.mono,
    color: colors.textMuted,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  codeScroller: { padding: spacing.md },
  code: { ...type.mono, fontSize: 13, lineHeight: 20, color: colors.text, minWidth: "100%" },
});
