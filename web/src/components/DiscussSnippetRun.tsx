import { createContext, useContext } from "react";
import { Button } from "../design-system/kit";

export const SnippetDiscussionContext = createContext<((text: string) => void) | null>(null);

function excerpt(text: string) {
  const limit = 4000;
  return text.length > limit ? text.slice(0, limit) + "\n[Excerpt ends here]" : text;
}

export function DiscussSnippetRun({ environment, source, output, status, invocation }: {
  environment: string; source: string; output: string; status: string; invocation?: string;
}) {
  const addToDraft = useContext(SnippetDiscussionContext);
  if (!addToDraft) return null;
  const discuss = () => {
    const request = [
      `Help me understand this ${environment} run (${status}).`,
      invocation && `Invocation: ${invocation}`,
      "Code I ran:\n" + excerpt(source),
      "Observed output:\n" + excerpt(output || "(empty)"),
    ].filter(Boolean).join("\n\n");
    addToDraft(request);
  };
  return <Button size="sm" variant="outline" glyph="message" onClick={event => {
    discuss();
    event.currentTarget.closest("[data-chat-thread]")?.querySelector<HTMLTextAreaElement>(".composer-root textarea")?.focus();
  }}>Discuss this run</Button>;
}
