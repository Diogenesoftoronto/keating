import { marked, type Token, type Tokens, type TokensList } from "marked";
import { segmentMarkdownMath } from "@/lib/local-rich-renderer";

export const MAX_MARKDOWN_LENGTH = 65_536;

export function parseMarkdownDocument(content: string): TokensList {
  const bounded = content.length > MAX_MARKDOWN_LENGTH ? `${content.slice(0, MAX_MARKDOWN_LENGTH)}\n\n[Message truncated]` : content;
  return marked.lexer(bounded, { gfm: true, breaks: true });
}

export function isMermaidCode(token: Token): token is Tokens.Code {
  return token.type === "code" && /^mermaid(?:\s|$)/i.test((token as Tokens.Code).lang?.trim() ?? "");
}

export function safeMarkdownUri(value: string, kind: "link" | "image"): URL | null {
  try {
    const url = new URL(value);
    if (url.username || url.password) return null;
    if (url.protocol === "https:") return url;
    if (kind === "link" && url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return url;
    if (kind === "link" && url.protocol === "mailto:" && !url.search && !url.hash) return url;
    return null;
  } catch {
    return null;
  }
}

export function markdownTokenTypes(tokens: readonly Token[]): string[] {
  const types: string[] = [];
  const visit = (entries: readonly Token[]) => {
    for (const token of entries) {
      types.push(token.type);
      if ("tokens" in token && Array.isArray(token.tokens)) visit(token.tokens);
      if (token.type === "list") (token as Tokens.List).items.forEach((item: Tokens.ListItem) => visit(item.tokens));
      if (token.type === "table") {
        (token as Tokens.Table).header.forEach((cell: Tokens.TableCell) => visit(cell.tokens));
        (token as Tokens.Table).rows.flat().forEach((cell: Tokens.TableCell) => visit(cell.tokens));
      }
      if (token.type === "blockquote") visit((token as Tokens.Blockquote).tokens);
    }
  };
  visit(tokens);
  return types;
}

/** True when math occurs anywhere inside a formatted inline token tree. */
export function markdownTokensContainMath(tokens: readonly Token[]): boolean {
  for (const token of tokens) {
    if ((token.type === "text" || token.type === "escape")
      && segmentMarkdownMath(token.text).some((segment) => segment.kind !== "text")) return true;
    if ("tokens" in token && Array.isArray(token.tokens) && markdownTokensContainMath(token.tokens)) return true;
  }
  return false;
}
