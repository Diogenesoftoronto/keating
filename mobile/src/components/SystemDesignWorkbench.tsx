import {
  getDiagramKinds,
  createDiagramSubmission,
  evaluateSystemDesignChecks,
  parseSystemDesignSubmission,
  systemDesignMermaid,
  validateSystemDesignGraph,
  type SystemDesignComponent,
  type SystemDesignGraph,
  type SystemDesignKind,
  type SystemDesignSpec,
  type UiAction,
  type UiDocument,
  type UiTaskNode,
} from "@keating/learner-contracts";
import { useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { Button } from "@/components/Buttons";
import { MarkdownText } from "@/components/MarkdownText";
import { MermaidDiagram } from "@/components/MermaidDiagram";
import { radii, spacing, useKeatingTheme } from "@/constants/theme";

interface Props {
  node: UiTaskNode & { diagram: SystemDesignSpec };
  document: UiDocument;
  disabled: boolean;
  busy: boolean;
  submitted?: Extract<UiAction, { type: "submit-task" }>;
  onSubmit: (submission: string) => Promise<boolean>;
}

function copyGraph(spec: SystemDesignSpec): SystemDesignGraph {
  return { components: spec.components.map((component) => ({ ...component })), connections: spec.connections.map((connection) => ({ ...connection })) };
}

function nextId(prefix: string, ids: readonly string[]): string {
  let sequence = 1;
  while (ids.includes(`${prefix}-${sequence}`)) sequence += 1;
  return `${prefix}-${sequence}`;
}

/** Native graph editing shares the web submission and structural check contract. */
export function SystemDesignWorkbench({ node, document, disabled, busy, submitted, onSubmit }: Props) {
  const theme = useKeatingTheme();
  const styles = createStyles(theme);
  const kinds = getDiagramKinds(node.diagram);
  const [graph, setGraph] = useState<SystemDesignGraph>(() => copyGraph(node.diagram));
  const [explanation, setExplanation] = useState("");
  const [newLabel, setNewLabel] = useState(`Component ${node.diagram.components.length + 1}`);
  const [newKind, setNewKind] = useState<SystemDesignKind>(kinds[0]!);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [connectionLabel, setConnectionLabel] = useState("");
  const [error, setError] = useState<string>();
  const [locallySubmitted, setLocallySubmitted] = useState<string>();
  useEffect(() => {
    setGraph(copyGraph(node.diagram));
    setExplanation("");
    setNewLabel(`Component ${node.diagram.components.length + 1}`);
    setNewKind(getDiagramKinds(node.diagram)[0]!);
    setFrom("");
    setTo("");
    setConnectionLabel("");
    setError(undefined);
    setLocallySubmitted(undefined);
  }, [document.id, document.revision, node.id, node.diagram]);

  const savedSource = submitted?.submission ?? locallySubmitted;
  const saved = useMemo(() => savedSource === undefined ? undefined : parseSystemDesignSubmission(savedSource, node.diagram), [savedSource, node.diagram]);
  const readonly = savedSource !== undefined;
  const shownGraph = saved?.graph ?? graph;
  const validGraph = validateSystemDesignGraph(shownGraph);
  const checks = validGraph ? evaluateSystemDesignChecks(node.diagram, shownGraph) : [];
  const locked = disabled || busy || readonly;
  const source = validGraph && shownGraph.components.length ? systemDesignMermaid(shownGraph) : undefined;

  const updateComponent = (id: string, patch: Partial<Pick<SystemDesignComponent, "label" | "kind">>) => {
    setGraph((current) => ({ ...current, components: current.components.map((component) => component.id === id ? { ...component, ...patch } : component) }));
  };
  const removeComponent = (id: string) => {
    setGraph((current) => ({ components: current.components.filter((component) => component.id !== id), connections: current.connections.filter((connection) => connection.from !== id && connection.to !== id) }));
    if (from === id) setFrom("");
    if (to === id) setTo("");
  };
  const addComponent = () => {
    if (locked || !newLabel.trim() || graph.components.length >= 40) return;
    setGraph((current) => ({ ...current, components: [...current.components, { id: nextId("component", current.components.map((component) => component.id)), label: newLabel.trim(), kind: newKind }] }));
    setNewLabel(`Component ${graph.components.length + 2}`);
    setError(undefined);
  };
  const addConnection = () => {
    if (locked || !graph.components.some((component) => component.id === from) || !graph.components.some((component) => component.id === to) || graph.connections.length >= 80) return;
    setGraph((current) => ({ ...current, connections: [...current.connections, { id: nextId("connection", current.connections.map((connection) => connection.id)), from, to, ...(connectionLabel.trim() ? { label: connectionLabel.trim() } : {}) }] }));
    setConnectionLabel("");
    setError(undefined);
  };
  const submit = async () => {
    if (locked) return;
    if (!validGraph || !graph.components.length || !explanation.trim()) {
      setError("Give every component a name and explain your diagram before submitting.");
      return;
    }
    setError(undefined);
    try {
      const payload = JSON.stringify(createDiagramSubmission(node.diagram, graph, explanation.trim()));
      if (await onSubmit(payload)) setLocallySubmitted(payload);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not submit the diagram. Your draft is still here.");
    }
  };

  return <View style={styles.workbench} accessibilityLabel={`Diagram builder: ${node.title}`}>
    <Text style={styles.kicker}>DIAGRAM</Text>
    <Text style={styles.title}>{node.title}</Text>
    <MarkdownText content={node.brief} />
    {readonly && !saved ? <View>
      <Text accessibilityRole="alert" style={styles.error}>This saved diagram could not be read or verified. Its original submission is preserved below.</Text>
      <Text selectable style={styles.body}>{savedSource}</Text>
    </View> : <>
      {readonly ? <Text accessibilityLiveRegion="polite" style={styles.notice}>Diagram submitted. Your diagram and explanation are saved.</Text> : <Text style={styles.notice}>Add components, connect them, and explain their relationships. Removing a component also removes its connections.</Text>}
      <Text style={styles.heading}>Components ({shownGraph.components.length}/40)</Text>
      {shownGraph.components.map((component) => <View key={component.id} style={styles.card}>
        {readonly ? <Text style={styles.body}>{component.label} · {component.kind}</Text> : <>
          <TextInput style={styles.input} value={component.label} maxLength={160} editable={!locked} placeholder="Component name" placeholderTextColor={theme.colors.textMuted} accessibilityLabel={`Name for ${component.label || component.id}`} onChangeText={(label) => updateComponent(component.id, { label })} />
          <KindSelector label={`Category for ${component.label || component.id}`} kinds={kinds} value={component.kind} disabled={locked} onChange={(kind) => updateComponent(component.id, { kind })} />
          <Button compact variant="quiet" accessibilityLabel={`Remove ${component.label || component.id} and its connections`} disabled={locked} onPress={() => removeComponent(component.id)}>Remove component</Button>
        </>}
      </View>)}
      {!readonly ? <View style={styles.card}>
        <Text style={styles.label}>Add a component</Text>
        <TextInput style={styles.input} value={newLabel} maxLength={160} editable={!locked} placeholder="Component name" placeholderTextColor={theme.colors.textMuted} accessibilityLabel="New component name" onChangeText={setNewLabel} />
        <KindSelector label="New component category" kinds={kinds} value={newKind} disabled={locked} onChange={setNewKind} />
        <Button compact variant="secondary" disabled={locked || !newLabel.trim() || graph.components.length >= 40} onPress={addComponent}>Add component</Button>
      </View> : null}
      <Text style={styles.heading}>Connections ({shownGraph.connections.length}/80)</Text>
      {!shownGraph.connections.length ? <Text style={styles.notice}>No connections yet.</Text> : null}
      {shownGraph.connections.map((connection) => {
        const fromName = shownGraph.components.find((component) => component.id === connection.from)?.label ?? connection.from;
        const toName = shownGraph.components.find((component) => component.id === connection.to)?.label ?? connection.to;
        return <View key={connection.id} style={styles.card}>
          <Text style={styles.body}>{fromName} → {toName}{readonly && connection.label ? ` · ${connection.label}` : ""}</Text>
          {!readonly ? <>
            <TextInput style={styles.input} value={connection.label ?? ""} maxLength={160} editable={!locked} placeholder="Connection label (optional)" placeholderTextColor={theme.colors.textMuted} accessibilityLabel={`Connection label from ${fromName} to ${toName}`} onChangeText={(label) => setGraph((current) => ({ ...current, connections: current.connections.map((candidate) => candidate.id === connection.id ? { ...candidate, label } : candidate) }))} />
            <Button compact variant="quiet" accessibilityLabel={`Remove connection from ${fromName} to ${toName}`} disabled={locked} onPress={() => setGraph((current) => ({ ...current, connections: current.connections.filter((candidate) => candidate.id !== connection.id) }))}>Remove connection</Button>
          </> : null}
        </View>;
      })}
      {!readonly && graph.components.length ? <View style={styles.card}>
        <Text style={styles.label}>Add a directed connection</Text>
        <ComponentSelector label="From component" components={graph.components} value={from} disabled={locked} onChange={setFrom} />
        <ComponentSelector label="To component" components={graph.components} value={to} disabled={locked} onChange={setTo} />
        <TextInput style={styles.input} value={connectionLabel} maxLength={160} editable={!locked} placeholder="e.g. causes, follows, depends on (optional)" placeholderTextColor={theme.colors.textMuted} accessibilityLabel="New connection label" onChangeText={setConnectionLabel} />
        <Button compact variant="secondary" disabled={locked || !from || !to || graph.connections.length >= 80} onPress={addConnection}>Connect components</Button>
      </View> : null}
      <Text style={styles.heading}>Diagram preview</Text>
      {source ? <MermaidDiagram key={source} source={source} decodeEntityLabels /> : <Text style={styles.notice}>{validGraph ? "Add a component to see your diagram." : "Give each component a name to update the preview and checks."}</Text>}
      {node.diagram.checks.length ? <View style={styles.section}>
        <Text style={styles.heading}>Structure checks</Text>
        <Text style={styles.notice}>These check diagram structure. They do not prove correctness or learning. Keating reviews your explanation against the task criteria. Unmet checks do not block submission.</Text>
        {checks.map((check) => <View key={check.id} style={styles.check}>
          <Text style={[styles.label, { color: check.passed ? theme.colors.success : theme.colors.warning }]}>{check.passed ? "Met" : "Not yet"}: {check.label}</Text>
          <Text style={styles.notice}>{check.detail}</Text>
        </View>)}
      </View> : null}
      {node.criteria?.length ? <View style={styles.section}>
        <Text style={styles.heading}>Review criteria</Text>
        {node.criteria.map((criterion, index) => <Text key={index} style={styles.body}>• {criterion}</Text>)}
      </View> : null}
      <Text style={styles.heading}>Explain your diagram</Text>
      {readonly ? <MarkdownText content={saved!.explanation} /> : <TextInput style={[styles.input, styles.explanation]} multiline textAlignVertical="top" value={explanation} maxLength={8000} editable={!locked} accessibilityLabel="Diagram explanation" placeholder="Explain the components, their relationships, and how they answer the task." placeholderTextColor={theme.colors.textMuted} onChangeText={setExplanation} />}
      {!readonly ? <Button disabled={locked || !validGraph || !graph.components.length || !explanation.trim()} loading={busy} onPress={() => void submit()}>Submit diagram</Button> : null}
    </>}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
  </View>;
}

function KindSelector({ label, kinds, value, disabled, onChange }: { label: string; kinds: readonly SystemDesignKind[]; value: SystemDesignKind; disabled: boolean; onChange: (kind: SystemDesignKind) => void }) {
  const styles = createStyles(useKeatingTheme());
  const [open, setOpen] = useState(false);
  return <View>
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value}`} accessibilityState={{ expanded: open, disabled }} disabled={disabled} onPress={() => setOpen((current) => !current)} style={styles.selectButton}>
      <Text style={styles.label}>{label}: {value} {open ? "▴" : "▾"}</Text>
    </Pressable>
    {open ? <View accessibilityRole="radiogroup" accessibilityLabel={label}>
      {kinds.map((kind) => <Pressable key={kind} accessibilityRole="radio" accessibilityState={{ checked: kind === value, disabled }} disabled={disabled} style={[styles.option, kind === value && styles.selected]} onPress={() => { onChange(kind); setOpen(false); }}>
        <Text style={styles.body}>{kind}</Text>
      </Pressable>)}
    </View> : null}
  </View>;
}

function ComponentSelector({ label, components, value, disabled, onChange }: { label: string; components: SystemDesignComponent[]; value: string; disabled: boolean; onChange: (id: string) => void }) {
  const styles = createStyles(useKeatingTheme());
  const [open, setOpen] = useState(false);
  const chosen = components.find((component) => component.id === value);
  return <View>
    <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${chosen?.label || "Choose a component"}`} accessibilityState={{ expanded: open, disabled }} disabled={disabled} onPress={() => setOpen((current) => !current)} style={styles.selectButton}>
      <Text style={styles.label}>{label}: {chosen?.label || "Choose a component"} {open ? "▴" : "▾"}</Text>
    </Pressable>
    {open ? <View accessibilityRole="radiogroup" accessibilityLabel={label}>
      {components.map((component) => <Pressable key={component.id} accessibilityRole="radio" accessibilityState={{ checked: component.id === value, disabled }} disabled={disabled} style={[styles.option, component.id === value && styles.selected]} onPress={() => { onChange(component.id); setOpen(false); }}>
        <Text style={styles.body}>{component.label || "Unnamed component"} · {component.kind}</Text>
      </Pressable>)}
    </View> : null}
  </View>;
}

function createStyles(theme: ReturnType<typeof useKeatingTheme>) {
  const { colors, type } = theme;
  return StyleSheet.create({
    workbench: { gap: spacing.md, paddingVertical: spacing.md },
    kicker: { ...type.caption, ...type.monoBold, color: colors.primaryText },
    title: { ...type.heading, color: colors.text },
    heading: { ...type.label, color: colors.text },
    label: { ...type.label, color: colors.text },
    body: { ...type.body, color: colors.text },
    notice: { ...type.caption, color: colors.textMuted },
    error: { ...type.caption, color: colors.error },
    card: { gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, padding: spacing.md, backgroundColor: colors.surfaceRaised },
    input: { ...type.body, color: colors.text, borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radii.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, minHeight: 44, backgroundColor: colors.backgroundDeep },
    explanation: { minHeight: 160 },
    selectButton: { minHeight: 44, justifyContent: "center", paddingVertical: spacing.sm },
    option: { minHeight: 44, justifyContent: "center", padding: spacing.sm, borderRadius: radii.sm },
    selected: { backgroundColor: colors.surfacePressed },
    section: { gap: spacing.sm },
    check: { gap: spacing.xs },
  });
}
