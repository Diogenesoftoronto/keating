export interface MermaidNode { id: string; label: string; level: number }
export interface MermaidEdge { from: string; to: string; label?: string }
export interface MermaidFlowchart { direction: "TD" | "BT" | "LR" | "RL"; nodes: MermaidNode[]; edges: MermaidEdge[] }

const NODE = String.raw`([A-Za-z0-9_.-]+)(?:\[([^\]]*)\]|\(\(([^)]*)\)\)|\(([^)]*)\)|\{([^}]*)\})?`;
const EDGE = new RegExp(`^\\s*${NODE}\\s*(?:-->|---|-.->|==>)\\s*(?:\\|([^|]+)\\|\\s*)?${NODE}\\s*$`);
const DECLARATION = new RegExp(`^\\s*${NODE}\\s*$`);

function cleanLabel(value: string | undefined): string | undefined {
  if (!value?.trim()) return undefined;
  const trimmed = value.trim();
  const unquoted = (trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))
    ? trimmed.slice(1, -1)
    : trimmed;
  return unquoted.replace(/<br\s*\/?>/gi, " ").replaceAll("&quot;", '"').trim();
}

/** A bounded native renderer for the flowcharts Keating emits most often. */
export function parseMermaidFlowchart(source: string): MermaidFlowchart | null {
  if (source.length > 16_384) return null;
  const statements = source.split(/[;\n]+/).map((line) => line.trim()).filter(Boolean);
  const header = statements.shift()?.match(/^(?:graph|flowchart)\s+(TD|TB|BT|LR|RL)$/i);
  if (!header) return null;
  const direction = header[1]!.toUpperCase() === "TB" ? "TD" : header[1]!.toUpperCase() as MermaidFlowchart["direction"];
  const labels = new Map<string, string>();
  const edges: MermaidEdge[] = [];
  const addNode = (id: string, ...possible: Array<string | undefined>) => labels.set(id, possible.map(cleanLabel).find(Boolean) ?? labels.get(id) ?? id);
  for (const statement of statements) {
    // Native uses the Keating theme, so safe visual-only directives are ignored.
    if (/^(?:classDef|class|style|linkStyle)\b/i.test(statement)) continue;
    // Grouping is flattened while retaining its nodes and edges.
    if (/^(?:subgraph\b|end$|direction\b|accTitle\s*:|accDescr\s*:|title\s+)/i.test(statement)) continue;
    // Mermaid click callbacks and URLs are executable navigation and never run natively.
    if (/^click\b/i.test(statement)) return null;
    const edge = statement.match(EDGE);
    if (edge) {
      const [from, fromBox, fromCircle, fromRound, fromDiamond, edgeLabel, to, toBox, toCircle, toRound, toDiamond] = edge.slice(1);
      addNode(from!, fromBox, fromCircle, fromRound, fromDiamond);
      addNode(to!, toBox, toCircle, toRound, toDiamond);
      edges.push({ from: from!, to: to!, ...(edgeLabel?.trim() ? { label: edgeLabel.trim() } : {}) });
      continue;
    }
    const declaration = statement.match(DECLARATION);
    if (!declaration) return null;
    addNode(declaration[1]!, declaration[2], declaration[3], declaration[4], declaration[5]);
  }
  if (!labels.size || labels.size > 48 || edges.length > 96) return null;
  const levels = new Map([...labels.keys()].map((id) => [id, 0]));
  for (let pass = 0; pass < labels.size; pass += 1) {
    let changed = false;
    for (const edge of edges) {
      const next = Math.min(labels.size - 1, (levels.get(edge.from) ?? 0) + 1);
      if (next > (levels.get(edge.to) ?? 0)) { levels.set(edge.to, next); changed = true; }
    }
    if (!changed) break;
  }
  return {
    direction,
    nodes: [...labels].map(([id, label]) => ({ id, label, level: levels.get(id) ?? 0 })),
    edges,
  };
}
