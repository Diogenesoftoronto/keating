import type { Token, Tokens } from "marked";
import * as Clipboard from "expo-clipboard";
import { Fragment, type ReactNode, useMemo, useState } from "react";
import { Alert, Image, Linking, Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type TextStyle } from "react-native";
import LocalRichDom from "@/components/LocalRich.dom";
import { MermaidDiagram } from "@/components/MermaidDiagram";
import { radii, spacing, useKeatingTheme } from "@/constants/theme";
import { codePresentationLabel, createInitialDocumentNavigationGuard, segmentMarkdownMath, validateLocalMathSource } from "@/lib/local-rich-renderer";
import { isMermaidCode, markdownTokensContainMath, parseMarkdownDocument, safeMarkdownUri } from "@/lib/markdown-document";

type MarkdownStyles = ReturnType<typeof createStyles>;

export function MarkdownText({ content }: { content: string }) {
  const styles = createStyles(useKeatingTheme());
  const tokens = useMemo(() => parseMarkdownDocument(content), [content]);
  return <View style={styles.document}>{renderBlocks(tokens, styles)}</View>;
}

function renderBlocks(tokens: readonly Token[], styles: MarkdownStyles, prefix = "block"): ReactNode[] {
  return tokens.map((token, index) => {
    const key = `${prefix}-${index}`;
    switch (token.type) {
      case "space": return <View key={key} style={styles.spacer} />;
      case "heading": {
        const heading = token as Tokens.Heading;
        return <Text key={key} style={[styles.paragraph, headingStyle(heading.depth, styles)]}>{inlineNodes(heading.tokens, styles, key)}</Text>;
      }
      case "paragraph": return <Paragraph key={key} token={token as Tokens.Paragraph} styles={styles} tokenKey={key} />;
      case "text": return <Paragraph key={key} token={token as Tokens.Text} styles={styles} tokenKey={key} />;
      case "code": return isMermaidCode(token)
        ? <MermaidDiagram key={key} source={token.text} />
        : <CodeBlock key={key} token={token as Tokens.Code} styles={styles} />;
      case "blockquote": return <View key={key} style={styles.quote}>{renderBlocks((token as Tokens.Blockquote).tokens, styles, `${key}-quote`)}</View>;
      case "list": return <ListBlock key={key} token={token as Tokens.List} styles={styles} tokenKey={key} />;
      case "table": return <TableBlock key={key} token={token as Tokens.Table} styles={styles} tokenKey={key} />;
      case "hr": return <View key={key} style={styles.rule} />;
      case "html": return <View key={key} style={styles.htmlNotice}><Text style={styles.notice}>HTML is shown as text on mobile.</Text><Text selectable style={styles.code}>{token.text}</Text></View>;
      default: return "tokens" in token && Array.isArray(token.tokens) && token.tokens.length
        ? <Fragment key={key}>{renderBlocks(token.tokens, styles, `${key}-nested`)}</Fragment> : null;
    }
  });
}

function Paragraph({ token, styles, tokenKey }: { token: Tokens.Paragraph | Tokens.Text; styles: MarkdownStyles; tokenKey: string }) {
  const tokens = token.tokens ?? [{ type: "text", raw: token.raw, text: token.text } as Tokens.Text];
  const hasImage = tokens.some((part) => part.type === "image");
  const onlyText = tokens.length === 1 && tokens[0]?.type === "text" ? tokens[0].text : null;
  const math = onlyText === null ? [] : segmentMarkdownMath(onlyText);
  if (math.length === 1 && math[0]?.kind === "display-math") return <MathExpression source={math[0].source} expression={math[0].value} display styles={styles} />;
  const hasMath = markdownTokensContainMath(tokens);
  if (!hasImage && !hasMath) return <Text selectable style={styles.paragraph}>{inlineNodes(tokens, styles, tokenKey)}</Text>;
  if (!hasImage) return <View style={styles.inlineFlow}>{inlineFlowNodes(tokens, styles, tokenKey)}</View>;
  return (
    <View style={styles.paragraphWithMedia}>
      {tokens.map((part, index) => part.type === "image"
        ? <RemoteMarkdownImage key={`${tokenKey}-image-${index}`} token={part as Tokens.Image} styles={styles} />
        : markdownTokensContainMath([part])
          ? <View key={`${tokenKey}-flow-${index}`} style={styles.inlineFlow}>{inlineFlowNodes([part], styles, `${tokenKey}-${index}`)}</View>
          : <Text key={`${tokenKey}-inline-${index}`} style={styles.paragraph}>{inlineNodes([part], styles, `${tokenKey}-${index}`)}</Text>)}
    </View>
  );
}

function inlineFlowNodes(tokens: readonly Token[], styles: MarkdownStyles, prefix: string, inheritedStyle?: StyleProp<TextStyle>): ReactNode[] {
  return tokens.flatMap((token, index): ReactNode[] => {
    const key = `${prefix}-flow-${index}`;
    if (token.type === "text" || token.type === "escape") return mathFlowNodes(token.text, styles, key, inheritedStyle);
    if (token.type === "br") return [<View key={key} style={styles.lineBreak} />];
    if (token.type === "codespan") return [<Text selectable key={key} style={[styles.inlineCode, inheritedStyle]}>{(token as Tokens.Codespan).text}</Text>];
    if (token.type === "strong" || token.type === "em" || token.type === "del") {
      const nested = token as Tokens.Strong | Tokens.Em | Tokens.Del;
      const style = token.type === "strong" ? styles.bold : token.type === "em" ? styles.emphasis : styles.strike;
      if (markdownTokensContainMath(nested.tokens)) return inlineFlowNodes(nested.tokens, styles, key, [inheritedStyle, style]);
      return [<Text selectable key={key} style={[styles.paragraph, inheritedStyle, style]}>{inlineNodes(nested.tokens, styles, key)}</Text>];
    }
    return [<Text selectable key={key} style={[styles.paragraph, inheritedStyle]}>{inlineNodes([token], styles, key)}</Text>];
  });
}

function mathFlowNodes(value: string, styles: MarkdownStyles, prefix: string, inheritedStyle?: StyleProp<TextStyle>): ReactNode[] {
  return segmentMarkdownMath(value).map((segment, index) => {
    const key = `${prefix}-math-${index}`;
    if (segment.kind === "text") return <Text selectable key={key} style={[styles.paragraph, inheritedStyle]}>{segment.value}</Text>;
    if (segment.kind === "malformed-math") return <Text selectable accessibilityRole="alert" key={key} style={styles.mathError}>{segment.source} · incomplete formula</Text>;
    return <MathExpression key={key} source={segment.source} expression={segment.value} display={segment.kind === "display-math"} styles={styles} />;
  });
}

function MathExpression({ source, expression, display, styles }: { source: string; expression: string; display: boolean; styles: MarkdownStyles }) {
  const theme = useKeatingTheme();
  const validation = useMemo(() => validateLocalMathSource(expression), [expression]);
  const navigationGuard = useMemo(() => createInitialDocumentNavigationGuard(), []);
  const [renderError, setRenderError] = useState<string | null>(null);
  if (!validation.ok || renderError) return <View style={display ? styles.mathFallbackDisplay : styles.mathFallbackInline}>
    <Text selectable style={styles.mathSource}>{source}</Text>
    <Text accessibilityRole="alert" style={styles.mathError}>{validation.ok ? renderError : validation.reason}</Text>
  </View>;
  return <View accessibilityLabel={`${display ? "Display" : "Inline"} math: ${expression}`} style={display ? styles.mathDisplay : styles.mathInline}>
    <LocalRichDom
      kind="math"
      source={validation.source}
      display={display}
      color={theme.colors.text}
      mutedColor={theme.colors.textMuted}
      backgroundColor={display ? theme.colors.backgroundDeep : theme.colors.surfaceRaised}
      description={`${display ? "Display" : "Inline"} math: ${expression}`}
      onRenderError={setRenderError}
      dom={{
        matchContents: true,
        originWhitelist: ["*"],
        mixedContentMode: "never",
        setSupportMultipleWindows: false,
        javaScriptCanOpenWindowsAutomatically: false,
        onShouldStartLoadWithRequest: navigationGuard,
        allowsAirPlayForMediaPlayback: false,
        allowsFullscreenVideo: false,
        allowsInlineMediaPlayback: false,
        allowsPictureInPictureMediaPlayback: false,
        mediaPlaybackRequiresUserAction: true,
        thirdPartyCookiesEnabled: false,
        sharedCookiesEnabled: false,
        cacheEnabled: false,
        unstable_useExpoModulesBridge: false,
      }}
    />
  </View>;
}

function inlineNodes(tokens: readonly Token[], styles: MarkdownStyles, prefix: string): ReactNode[] {
  return tokens.flatMap((token, index): ReactNode[] => {
    const key = `${prefix}-inline-${index}`;
    switch (token.type) {
      case "text": case "escape": return textWithSpoilersAndMath(token.text, styles, key);
      case "strong": return [<Text key={key} style={styles.bold}>{inlineNodes((token as Tokens.Strong).tokens, styles, key)}</Text>];
      case "em": return [<Text key={key} style={styles.emphasis}>{inlineNodes((token as Tokens.Em).tokens, styles, key)}</Text>];
      case "del": return [<Text key={key} style={styles.strike}>{inlineNodes((token as Tokens.Del).tokens, styles, key)}</Text>];
      case "codespan": return [<Text key={key} style={styles.inlineCode}>{(token as Tokens.Codespan).text}</Text>];
      case "br": return ["\n"];
      case "link": {
        const link = token as Tokens.Link;
        const url = safeMarkdownUri(link.href, "link");
        return [<Text key={key} accessibilityRole={url ? "link" : undefined} onPress={url ? () => confirmExternalLink(url) : undefined} style={url ? styles.link : styles.blockedLink}>{inlineNodes(link.tokens, styles, key)}</Text>];
      }
      case "image": return [<Text key={key} style={styles.notice}>[Image: {(token as Tokens.Image).text || "untitled"}]</Text>];
      case "html": return [<Text key={key} style={styles.inlineCode}>{token.text}</Text>];
      default: return "tokens" in token && Array.isArray(token.tokens) && token.tokens.length ? inlineNodes(token.tokens, styles, key) : [token.raw];
    }
  });
}

function textWithSpoilersAndMath(value: string, styles: MarkdownStyles, prefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const expression = /(\|\|[^|]+\|\||\$[^$\n]+\$)/g;
  let cursor = 0;
  let index = 0;
  for (const match of value.matchAll(expression)) {
    const start = match.index ?? 0;
    if (start > cursor) nodes.push(value.slice(cursor, start));
    const token = match[0];
    nodes.push(token.startsWith("||")
      ? <Spoiler key={`${prefix}-${index++}`} styles={styles}>{token.slice(2, -2)}</Spoiler>
      : <Text key={`${prefix}-${index++}`} accessibilityLabel={`Math ${token.slice(1, -1)}`} style={styles.math}>{token.slice(1, -1)}</Text>);
    cursor = start + token.length;
  }
  if (cursor < value.length) nodes.push(value.slice(cursor));
  return nodes;
}

function Spoiler({ children, styles }: { children: string; styles: MarkdownStyles }) {
  const [revealed, setRevealed] = useState(false);
  return <Text accessibilityRole="button" accessibilityLabel={revealed ? "Hide answer" : "Reveal answer"} accessibilityState={{ expanded: revealed }} onPress={() => setRevealed((current) => !current)} style={revealed ? styles.spoilerRevealed : styles.spoilerHidden}>{revealed ? children : "Tap to reveal"}</Text>;
}

function ListBlock({ token, styles, tokenKey }: { token: Tokens.List; styles: MarkdownStyles; tokenKey: string }) {
  return <View style={styles.list}>{token.items.map((item, index) => (
    <View key={`${tokenKey}-item-${index}`} style={styles.listRow}>
      <Text accessibilityLabel={item.task ? item.checked ? "Completed" : "Not completed" : undefined} style={styles.marker}>
        {item.task ? item.checked ? "☑" : "☐" : token.ordered ? `${Number(token.start || 1) + index}.` : "•"}
      </Text>
      <View style={styles.listBody}>{renderBlocks(item.tokens, styles, `${tokenKey}-item-${index}`)}</View>
    </View>
  ))}</View>;
}

function TableBlock({ token, styles, tokenKey }: { token: Tokens.Table; styles: MarkdownStyles; tokenKey: string }) {
  const rows = [token.header, ...token.rows];
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.table}>
      {rows.map((row, rowIndex) => <View key={`${tokenKey}-row-${rowIndex}`} style={[styles.tableRow, rowIndex === 0 && styles.tableHeader]}>
        {row.map((cell, cellIndex) => <View key={`${tokenKey}-cell-${rowIndex}-${cellIndex}`} style={styles.tableCell}>
          <Text style={[styles.tableText, rowIndex === 0 && styles.bold]}>{inlineNodes(cell.tokens, styles, `${tokenKey}-${rowIndex}-${cellIndex}`)}</Text>
        </View>)}
      </View>)}
    </ScrollView>
  );
}

function CodeBlock({ token, styles }: { token: Tokens.Code; styles: MarkdownStyles }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await Clipboard.setStringAsync(token.text);
    setCopied(true);
  };
  return <View style={styles.codeFrame}>
    <View style={styles.codeHeader}>
      <Text style={styles.codeLanguage}>{codePresentationLabel(token.lang)}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Copy code" onPress={() => void copy()} style={({ pressed }) => [styles.copyButton, pressed && styles.pressed]}><Text style={styles.copyLabel}>{copied ? "Copied" : "Copy"}</Text></Pressable>
    </View>
    <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.codeScroller}><Text selectable style={styles.code}>{token.text}</Text></ScrollView>
  </View>;
}

function RemoteMarkdownImage({ token, styles }: { token: Tokens.Image; styles: MarkdownStyles }) {
  const url = safeMarkdownUri(token.href, "image");
  const [allowed, setAllowed] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!url) return <Text style={styles.notice}>Blocked unsafe image: {token.text || token.href}</Text>;
  if (!allowed) return <Pressable accessibilityRole="button" accessibilityLabel={`Load image ${token.text || url.hostname}`} onPress={() => setAllowed(true)} style={({ pressed }) => [styles.imageConsent, pressed && styles.pressed]}><Text style={styles.imageConsentTitle}>Load image</Text><Text numberOfLines={2} style={styles.notice}>{token.text || "Remote image"} · {url.hostname}</Text></Pressable>;
  if (failed) return <Text accessibilityRole="alert" style={styles.notice}>Could not load image from {url.hostname}.</Text>;
  return <Image accessibilityLabel={token.text || "Markdown image"} accessibilityIgnoresInvertColors source={{ uri: url.toString() }} resizeMode="contain" onError={() => setFailed(true)} style={styles.image} />;
}

function confirmExternalLink(url: URL): void {
  Alert.alert("Open external link?", url.hostname || url.toString(), [
    { text: "Cancel", style: "cancel" },
    { text: "Open link", onPress: () => void Linking.openURL(url.toString()) },
  ]);
}

function headingStyle(depth: number, styles: MarkdownStyles) { return depth === 1 ? styles.h1 : depth === 2 ? styles.h2 : styles.h3; }

function createStyles(theme: ReturnType<typeof useKeatingTheme>) {
  const { colors, type } = theme;
  return StyleSheet.create({
    document: { gap: 2 },
    paragraph: { ...type.body, color: colors.text },
    inlineFlow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 2 },
    lineBreak: { flexBasis: "100%", height: 0 },
    paragraphWithMedia: { gap: spacing.sm },
    bold: { fontWeight: "700" },
    emphasis: { fontStyle: "italic" },
    strike: { textDecorationLine: "line-through" },
    inlineCode: { ...type.mono, color: colors.primaryText, backgroundColor: colors.backgroundDeep },
    math: { ...type.mono, color: colors.primaryText, backgroundColor: colors.surfaceRaised },
    mathInline: { minHeight: 28, minWidth: 24, overflow: "hidden", borderRadius: radii.sm, backgroundColor: colors.surfaceRaised },
    mathDisplay: { width: "100%", minHeight: 54, marginVertical: spacing.sm, overflow: "hidden", borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.backgroundDeep },
    mathFallbackInline: { maxWidth: "100%", paddingHorizontal: spacing.xs, borderRadius: radii.sm, backgroundColor: colors.surfaceRaised },
    mathFallbackDisplay: { width: "100%", gap: spacing.xs, padding: spacing.md, borderWidth: 1, borderColor: colors.warning, borderRadius: radii.md, backgroundColor: colors.backgroundDeep },
    mathSource: { ...type.mono, color: colors.primaryText },
    mathError: { ...type.caption, color: colors.warning },
    spoilerHidden: { ...type.label, color: colors.primaryInk, backgroundColor: colors.primary, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radii.sm },
    spoilerRevealed: { ...type.body, color: colors.text, backgroundColor: colors.surfaceRaised, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderRadius: radii.sm },
    link: { color: colors.primaryText, textDecorationLine: "underline" },
    blockedLink: { color: colors.error, textDecorationLine: "line-through" },
    h1: { ...type.title, marginTop: spacing.md, marginBottom: spacing.xs },
    h2: { ...type.heading, marginTop: spacing.md, marginBottom: spacing.xs },
    h3: { ...type.label, fontSize: 16, marginTop: spacing.sm, marginBottom: spacing.xs },
    spacer: { height: spacing.sm },
    list: { gap: spacing.xs },
    listRow: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, paddingLeft: spacing.xs },
    marker: { ...type.body, ...type.mono, color: colors.primaryText, minWidth: 24 },
    listBody: { flex: 1, minWidth: 0 },
    quote: { gap: spacing.xs, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm, backgroundColor: colors.surfaceRaised },
    rule: { height: 1, backgroundColor: colors.borderStrong, marginVertical: spacing.md },
    codeFrame: { marginVertical: spacing.md, overflow: "hidden", borderRadius: radii.md, backgroundColor: colors.backgroundDeep, borderWidth: 1, borderColor: colors.border },
    codeHeader: { minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, paddingLeft: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border },
    codeLanguage: { ...type.caption, ...type.mono, color: colors.textMuted },
    copyButton: { minWidth: 64, minHeight: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: spacing.md },
    copyLabel: { ...type.caption, color: colors.primaryText },
    codeScroller: { padding: spacing.md },
    code: { ...type.mono, fontSize: 13, lineHeight: 20, color: colors.text, minWidth: "100%" },
    htmlNotice: { gap: spacing.xs, padding: spacing.md, borderWidth: 1, borderColor: colors.warning, borderRadius: radii.sm },
    notice: { ...type.caption, color: colors.textMuted, lineHeight: 19 },
    table: { flexDirection: "column", marginVertical: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm, overflow: "hidden" },
    tableRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colors.border },
    tableHeader: { backgroundColor: colors.surfacePressed },
    tableCell: { width: 156, minHeight: 44, justifyContent: "center", padding: spacing.sm, borderRightWidth: 1, borderRightColor: colors.border },
    tableText: { ...type.caption, color: colors.text },
    imageConsent: { minHeight: 58, justifyContent: "center", gap: 2, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm, backgroundColor: colors.surfaceRaised },
    imageConsentTitle: { ...type.label, color: colors.primaryText },
    image: { width: "100%", height: 220, borderRadius: radii.sm, backgroundColor: colors.surfaceRaised },
    pressed: { backgroundColor: colors.surfacePressed },
  });
}
