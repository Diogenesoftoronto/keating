import { observeAssessmentCheckpoints, openUiDiagnosticComponentForNode, type AssessmentCheckpointSignal, type CodingChallengeLanguage } from "../../../../packages/learner-contracts/src/openui-diagnostic-turn";
import { tryCompileOpenUISourceToSharedDocument } from "./shared-bridge";
import { parseOpenUIMessageSegments } from "./segments";

/** Offline-safe observation of a model's text. The renderer confirms delivery separately. */
export function inspectOpenUIDiagnosticText(text: string): { attempted: boolean; components: string[]; outsideWords: number } {
  const {attempted, components, outsideWords} = inspectSelectedOpenUIDiagnosticText(text);
  return {attempted, components, outsideWords};
}

/** Signal names only. A fence that did not compile leaves the reply unmeasured. */
export function inspectAssessmentCheckpoints(text: string): AssessmentCheckpointSignal[] | null {
  const components = new Set<string>();
  const simulationBriefs: string[] = [];
  let prose = "";
  for (const segment of parseOpenUIMessageSegments(text)) {
    if (segment.type === "text") { prose += segment.content + "\n"; continue; }
    if (!segment.complete) return null;
    let document = segment.format === "document" ? segment.document : undefined;
    if (segment.format === "source") {
      const compiled = tryCompileOpenUISourceToSharedDocument(segment.rawProgram, {
        documentId: segment.metadata.id, revision: segment.metadata.revision, retention: segment.metadata.lifecycle,
      });
      if (compiled.ok) document = compiled.document;
    }
    if (!document) return null;
    for (const node of document.nodes) {
      components.add(openUiDiagnosticComponentForNode(node));
      if (node.type === "simulation" && node.brief) simulationBriefs.push(node.brief);
    }
  }
  return observeAssessmentCheckpoints({ components: [...components], simulationBriefs, prose });
}

/** Read the language from the same validated nodes that supply the selected component list. */
export function inspectSelectedOpenUIDiagnosticText(text: string) {
  const components = new Set<string>();
  const languages = new Set<CodingChallengeLanguage>();
  let attempted = false;
  let outsideWords = 0;
  for (const segment of parseOpenUIMessageSegments(text)) {
    if (segment.type === "text") {
      outsideWords += segment.content.trim().split(/\s+/u).filter(Boolean).length;
      continue;
    }
    attempted = true;
    if (!segment.complete) continue;
    let document = segment.format === "document" ? segment.document : undefined;
    if (segment.format === "source") {
      const compiled = tryCompileOpenUISourceToSharedDocument(segment.rawProgram, {
        documentId: segment.metadata.id, revision: segment.metadata.revision, retention: segment.metadata.lifecycle,
      });
      if (compiled.ok) document = compiled.document;
    }
    for (const node of document?.nodes ?? []) {
      components.add(openUiDiagnosticComponentForNode(node));
      if (node.type === "coding-challenge") languages.add(node.language);
    }
  }
  return { attempted, components: [...components].sort(), outsideWords, codingChallengeLanguages: [...languages].sort() };
}
