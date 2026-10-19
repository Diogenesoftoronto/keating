/** Domain-neutral diagram contracts; the legacy system-design API stays available. */
export {
  DIAGRAM_KINDS,
  getDiagramKinds,
  validateSystemDesignGraph as validateDiagramGraph,
  validateSystemDesignSpec as validateDiagramSpec,
  systemDesignMermaid as diagramMermaid,
  evaluateSystemDesignChecks as evaluateDiagramChecks,
  parseSystemDesignSubmission as parseDiagramSubmission,
  systemDesignSubmissionIsComplete as diagramSubmissionIsComplete,
  type SystemDesignKind as DiagramKind,
  type SystemDesignComponent as DiagramComponent,
  type SystemDesignConnection as DiagramConnection,
  type SystemDesignGraph as DiagramGraph,
  type SystemDesignCheck as DiagramCheck,
  type SystemDesignSpec as DiagramSpec,
  type SystemDesignCheckResult as DiagramCheckResult,
  type SystemDesignSubmission as DiagramSubmission,
} from "./system-design.js";

import { createSystemDesignSubmission, type SystemDesignGraph, type SystemDesignSpec, type SystemDesignSubmission } from "./system-design.js";

export function createDiagramSubmission(spec: SystemDesignSpec, graph: SystemDesignGraph, explanation: string): SystemDesignSubmission {
  return { ...createSystemDesignSubmission(spec, graph, explanation), kind: "diagram" };
}
