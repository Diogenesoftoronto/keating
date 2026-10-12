import { useEffect, useRef, useState } from "react";
import { Alert, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { Button } from "./Buttons";
import { spacing, useKeatingTheme } from "@/constants/theme";
import { useNotOrganicAccount } from "@/state/NotOrganicAccountProvider";
import { mobileKnowledgeToolKey, useMobileKnowledge } from "@/state/MobileKnowledgeProvider";
import { mobileKnowledgePortalUrl, type MobileKnowledgeResource, type MobileKnowledgeSource, type MobileKnowledgeTool } from "@/lib/notorganic-account/knowledge";

export function MobileKnowledgeSources() {
  const { colors, type } = useKeatingTheme();
  const account = useNotOrganicAccount();
  const knowledge = useMobileKnowledge();
  const [resources, setResources] = useState<{ id: string; items: MobileKnowledgeResource[]; truncated: boolean } | null>(null);
  const [reading, setReading] = useState<{ label: string; uri: string; text: string } | null>(null);
  const [operation, setOperation] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const active = useRef(0), busy = useRef(false);
  useEffect(() => { active.current++; setResources(null); setReading(null); setError(null); setOperation(null); busy.current = false; }, [account.status, account.session?.accountId, knowledge.selected.join("\n")]);
  const toolsGranted = account.session?.scope.split(/\s+/).includes("knowledge:tools");
  const run = async (source: MobileKnowledgeSource, uri?: string) => {
    if (busy.current) return;
    busy.current = true;
    const epoch = active.current;
    setOperation(uri ?? source.id); setError(null);
    try {
      const result = await knowledge.execute(uri ? "read_knowledge_resource" : "list_knowledge_resources", { source_id: source.id, ...(uri ? { uri } : {}) }, { idempotencyKey: `browse-${Date.now()}`, createdAt: Date.now() });
      if (epoch !== active.current) return;
      if (!result.ok) throw Error(result.message);
      if (uri) {
        let text = String(result.output.content);
        try { const body = JSON.parse(text) as { contents?: Array<{ text?: string }> }; const readable = body.contents?.filter(item => typeof item.text === "string").map(item => item.text).join("\n\n"); if (readable) text = readable; } catch { /* Truncated external content remains plain text. */ }
        setReading({ label: source.label, uri, text: `${text}${result.output.truncated ? "\n\n[Preview truncated]" : ""}` });
      } else setResources({ id: source.id, items: result.output.resources as MobileKnowledgeResource[], truncated: result.output.truncated === true });
    } catch (cause) { if (epoch === active.current) setError(cause instanceof Error ? cause.message : "Source could not be opened."); }
    finally { if (epoch === active.current) { busy.current = false; setOperation(null); } }
  };
  const toggleTool = (source: MobileKnowledgeSource, tool: MobileKnowledgeTool) => {
    if (knowledge.approved.includes(mobileKnowledgeToolKey(source.id, tool.name))) { knowledge.toggleTool(source.id, tool.name); return; }
    const epoch = active.current;
    Alert.alert(`Enable ${tool.name}?`, `Keating may send your conversation's relevant arguments to ${source.label} and run this tool during this account session. It may change data or contact other services. Remote-server safety hints are not verified.`, [
      { text: "Cancel", style: "cancel" }, { text: "Enable tool", onPress: () => { if (epoch === active.current) knowledge.toggleTool(source.id, tool.name); } },
    ]);
  };
  const manage = async () => { try { await Linking.openURL(mobileKnowledgePortalUrl()); } catch { setError("The account portal could not be opened."); } };
  const styles = StyleSheet.create({
    section: { marginTop: spacing.xl, gap: spacing.md }, heading: { ...type.heading, color: colors.text }, copy: { ...type.body, color: colors.textMuted },
    row: { paddingVertical: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.borderStrong, gap: spacing.sm },
    selection: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 44 }, label: { ...type.label, color: colors.text, flex: 1 },
    mark: { ...type.body, color: colors.primaryText, minWidth: 24 }, tool: { ...type.body, color: colors.text }, error: { ...type.body, color: colors.error },
    reading: { padding: spacing.md, backgroundColor: colors.surfaceRaised, gap: spacing.sm }, content: { ...type.body, color: colors.text },
  });
  return <View style={styles.section}>
    <Text style={styles.heading}>Study sources</Text>
    <Text style={styles.copy}>Bring your shared Not Organic connections into a conversation. Select sources for this account session; tool execution is a separate choice.</Text>
    {!knowledge.enabled ? <Button loading={account.status === "authorizing"} onPress={() => void account.login({ knowledge: true })}>Enable study sources</Button> : <>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: spacing.sm }}>
        <Button compact variant="secondary" loading={knowledge.busy} onPress={() => void knowledge.refresh()}>Refresh sources</Button>
        <Button compact variant="quiet" onPress={() => void manage()}>Add or manage sources ↗</Button>
      </View>
      {knowledge.busy && !knowledge.sources.length ? <Text style={styles.copy}>Loading shared connections…</Text> : !knowledge.sources.length ? <Text style={styles.copy}>Share a connection with Keating mobile in Not Organic, then refresh here. Google Drive is coming soon.</Text> : null}
      {knowledge.sources.map(source => {
        const selected = knowledge.selected.includes(source.id);
        return <View key={source.id} style={styles.row}>
          <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: selected }} accessibilityLabel={`Use ${source.label} in conversations`} onPress={() => knowledge.toggleSource(source.id)} style={styles.selection}>
            <Text style={styles.mark}>{selected ? "☑" : "☐"}</Text><Text style={styles.label}>{source.label}</Text>
          </Pressable>
          {selected ? <>
            {source.resources_allowed ? <Button compact variant="quiet" loading={operation === source.id} disabled={!!operation} onPress={() => void run(source)}>Browse resources</Button> : <Text style={styles.copy}>Resource reading has not been shared with this app.</Text>}
            {source.tools.length ? <>
              <Text style={styles.copy}>Tools are off until enabled. They may read or change external data.</Text>
              {!toolsGranted ? <Button compact variant="secondary" onPress={() => void account.login({ knowledge: true, knowledgeTools: true })}>Approve tool access</Button> : source.tools.map(tool => <Pressable key={tool.name} accessibilityRole="checkbox" accessibilityState={{ checked: knowledge.approved.includes(mobileKnowledgeToolKey(source.id, tool.name)) }} accessibilityLabel={`Allow ${tool.name} from ${source.label}`} onPress={() => toggleTool(source, tool)} style={styles.selection}>
                <Text style={styles.mark}>{knowledge.approved.includes(mobileKnowledgeToolKey(source.id, tool.name)) ? "☑" : "☐"}</Text><Text style={styles.tool}>{tool.name}</Text>
              </Pressable>)}
            </> : null}
            {resources?.id === source.id ? resources.items.length ? resources.items.map(resource => <Button key={resource.uri} compact variant="quiet" disabled={!!operation} loading={operation === resource.uri} onPress={() => void run(source, resource.uri)}>{resource.name || resource.uri}</Button>) : <Text style={styles.copy}>This source has no listed resources. Its approved search tools may still be useful.</Text> : null}
            {resources?.id === source.id && resources.truncated ? <Text style={styles.copy}>Showing the first 10 resources. Enable a search tool to find other material.</Text> : null}
          </> : null}
        </View>;
      })}
    </>}
    {knowledge.error || error ? <Text accessibilityRole="alert" style={styles.error}>{error ?? knowledge.error}</Text> : null}
    {reading ? <View style={styles.reading}><Text style={styles.label}>{reading.label}</Text><Text selectable style={styles.copy}>{reading.uri}</Text><Text selectable style={styles.content}>{reading.text}</Text><Button compact variant="quiet" onPress={() => setReading(null)}>Close resource</Button></View> : null}
  </View>;
}
