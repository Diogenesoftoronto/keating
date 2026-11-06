/** A deterministic derived index; clients may render richer local previews. */
export function sessionSearchText(messages: readonly unknown[]): string {
  return messages.map(message => {
    const content = (message as { content?: unknown })?.content;
    if (typeof content === "string") return content;
    if (!Array.isArray(content)) return "";
    return content.filter(part => part?.type === "text" && typeof part.text === "string")
      .map(part => part.text as string).join(" ");
  }).filter(Boolean).join("\n");
}
