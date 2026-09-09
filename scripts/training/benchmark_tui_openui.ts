/** Inspect actual assistant output through the production terminal UI path.
 * A rendering receipt is not visual proof and never submits an invented answer.
 */
import { splitAssistantOpenUiDocuments } from '../../src/tui/host-controller.js';
import { adaptUiDocument } from '../../src/tui/ui/adapter.js';
import { uiDocumentPresentation } from '../../src/tui/ui/render.js';

export function inspectTuiOpenUi(assistantText: string) {
  const split = splitAssistantOpenUiDocuments(assistantText);
  return {
    schema_version: 1 as const,
    content: split.content,
    documents: split.documents.map(source => {
      const adapted = adaptUiDocument(source);
      return adapted.ok
        ? { source, status: 'rendered' as const, document: adapted.document, presentation: uiDocumentPresentation(adapted.document) }
        : { source, status: 'rejected' as const, recovery: adapted.recovery };
    }),
    plain_openui_fence_present: /```openui(?:\s|$)/i.test(assistantText),
    limitations: [
      'Production terminal document extraction and text presentation only; no terminal pixels or browser parity proof.',
      'No action is submitted and no tutor continuation is triggered by this inspection.',
      'Initial terminal presentation hides deck backs and quiz explanations; this receipt does not exercise reveal or submission controls.',
      'Exams, simulations and rich media retain explicit terminal capability limitations.',
    ],
  };
}

if (import.meta.main) {
  const { readFile } = await import('node:fs/promises');
  const result = JSON.parse(await readFile(process.argv[2]!, 'utf8'));
  const steps = (result.steps ?? []).map((step: any) => ({
    index: step.index,
    assistant_outputs: (step.messages ?? []).slice(step.message_start_index ?? step.messages?.length ?? 0)
      .filter((message: any) => message.role === 'assistant')
      .map((message: any) => inspectTuiOpenUi(typeof message.content === 'string' ? message.content :
        (message.content ?? []).filter((block: any) => block.type === 'text').map((block: any) => block.text).join('\n'))),
  }));
  process.stdout.write(JSON.stringify({ status: 'inspected', steps }) + '\n');
}
