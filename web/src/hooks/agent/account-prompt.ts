/**
 * Connected Not Organic accounts may carry an activated pedagogy revision; it
 * replaces the local default prompt when it has a supported system prompt.
 */
import {
  BROWSER_DECLARATIVE_ARTIFACT_KINDS,
  browserSystemPromptFromRevision,
  canReadAccountEvolution,
  createBrowserAccountEvolutionClient,
} from "../../keating/account-evolution";
import { recordDiagnostic } from "../../lib/diagnostics";
import { notOrganicPublicClient } from "../../notorganic-provider";

const BROWSER_EVOLUTION_COMPATIBILITY = Object.freeze({
  agentApi: "keating-agent-hooks-v1",
  learnerContract: 1,
  capabilities: BROWSER_DECLARATIVE_ARTIFACT_KINDS,
});

export async function resolveConnectedAccountPrompt(localPrompt: string): Promise<string> {
  const publicClient = notOrganicPublicClient();
  if (!publicClient || !canReadAccountEvolution(publicClient)) return localPrompt;
  try {
    const revision = await createBrowserAccountEvolutionClient(
      publicClient,
      BROWSER_EVOLUTION_COMPATIBILITY,
    ).resolveActiveRevision();
    if (!revision) return localPrompt;
    const prompt = browserSystemPromptFromRevision(revision);
    if (!prompt) {
      recordDiagnostic(
        "warning",
        "account-evolution",
        "The active account revision has no supported system prompt; using the local prompt.",
        { revisionId: revision.revisionId, generation: revision.generation },
      );
      return localPrompt;
    }
    recordDiagnostic(
      "info",
      "account-evolution",
      "Activated the connected Not Organic account pedagogy revision.",
      { revisionId: revision.revisionId, generation: revision.generation },
    );
    return prompt;
  } catch (error) {
    recordDiagnostic(
      "warning",
      "account-evolution",
      error,
      { fallback: "local-prompt" },
    );
    return localPrompt;
  }
}
