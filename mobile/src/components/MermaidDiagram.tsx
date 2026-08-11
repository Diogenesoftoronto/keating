import { useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import LocalRichDom from "@/components/LocalRich.dom";
import { radii, spacing, useKeatingTheme } from "@/constants/theme";
import { createInitialDocumentNavigationGuard, validateLocalMermaidSource } from "@/lib/local-rich-renderer";

export function MermaidDiagram({ source }: { source: string }) {
  const theme = useKeatingTheme();
  const styles = createStyles(theme);
  const validation = useMemo(() => validateLocalMermaidSource(source), [source]);
  const navigationGuard = useMemo(() => createInitialDocumentNavigationGuard(), []);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [renderError, setRenderError] = useState<string | null>(null);
  if (!validation.ok) return <DiagramFallback source={source} reason={validation.reason} />;
  const description = `${validation.kind} diagram. Use the zoom controls or scroll the diagram. The original source is available below.`;
  return (
    <View style={styles.frame}>
      {renderError ? <Text accessibilityRole="alert" style={styles.fallback}>{renderError} The original source is preserved below.</Text> : null}
      {!renderError ? <LocalRichDom
        kind="mermaid"
        source={validation.source}
        description={description}
        backgroundColor={theme.colors.backgroundDeep}
        surfaceColor={theme.colors.surfaceRaised}
        textColor={theme.colors.text}
        mutedColor={theme.colors.textMuted}
        borderColor={theme.colors.borderStrong}
        accentColor={theme.colors.primaryText}
        onRenderError={setRenderError}
        dom={{
          style: styles.dom,
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
      /> : null}
      <Pressable accessibilityRole="button" accessibilityState={{ expanded: sourceOpen || Boolean(renderError) }} onPress={() => setSourceOpen((current) => !current)} style={({ pressed }) => [styles.sourceButton, pressed && styles.pressed]}>
        <Text style={styles.sourceLabel}>{sourceOpen || renderError ? "Hide diagram source" : "Show diagram source"}</Text>
      </Pressable>
      {sourceOpen || renderError ? <Text selectable style={styles.source}>{source}</Text> : null}
    </View>
  );
}

function DiagramFallback({ source, reason }: { source: string; reason: string }) {
  const styles = createStyles(useKeatingTheme());
  return <View style={styles.frame}><Text accessibilityRole="alert" style={styles.fallback}>{reason} The diagram was not loaded.</Text><Text selectable style={styles.source}>{source}</Text></View>;
}

function createStyles(theme: ReturnType<typeof useKeatingTheme>) {
  const { colors, type } = theme;
  return StyleSheet.create({
    frame: { marginVertical: spacing.md, overflow: "hidden", borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.backgroundDeep },
    dom: { width: "100%", height: 360, backgroundColor: colors.backgroundDeep },
    sourceButton: { minHeight: 44, justifyContent: "center", paddingHorizontal: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
    sourceLabel: { ...type.caption, color: colors.primaryText },
    source: { ...type.caption, ...type.mono, color: colors.textMuted, lineHeight: 19, padding: spacing.md },
    fallback: { ...type.caption, color: colors.warning, lineHeight: 19, paddingHorizontal: spacing.md, paddingTop: spacing.md },
    pressed: { backgroundColor: colors.surfacePressed },
  });
}
