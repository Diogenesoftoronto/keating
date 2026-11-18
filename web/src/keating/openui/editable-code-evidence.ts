import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import type { CodePracticeLanguage } from "../../../../packages/learner-contracts/src/judgement/code-practice-language";
import { isStrudelBlock } from "../../components/labs/strudel-detect";
import { editableCodeLanguage } from "../editable-code-language";
import { parseOpenUIMessageSegments } from "./segments";

const markdown = unified().use(remarkParse).use(remarkGfm).use(remarkMath);
type Node = { type: string; lang?: string | null; value?: string; children?: Node[]; position?: {start:{offset?:number}; end:{offset?:number}} };
type EditorEvidence = { editableCode: CodePracticeLanguage[] | null; editorOutsideWords: number | null };
const words = (source: string) => source.trim().split(/\s+/u).filter(Boolean).length;

/** Derive both measurements from the same accepted code spans without retaining their source. */
export function inspectEditableCodeEvidence(text: string): EditorEvidence {
  if (!text.includes("```") && !text.includes("~~~")) return { editableCode: [], editorOutsideWords: null };
  if (text.length > 256_000) return { editableCode: null, editorOutsideWords: null };
  const languages = new Set<CodePracticeLanguage>();
  let outsideWords = 0;
  try {
    // The product removes OpenUI before sending the remaining segments to MarkdownBlock.
    for (const segment of parseOpenUIMessageSegments(text)) {
      if (segment.type !== "text") continue;
      const source = segment.content;
      let cursor = 0;
      const visit = (node: Node) => {
        if (node.type === "blockquote") return;
        if (node.type === "code" && node.lang && node.value?.trim()) {
          const language = editableCodeLanguage(node.lang);
          if (!language || isStrudelBlock(node.lang, node.value)) return;
          const start = node.position?.start.offset, end = node.position?.end.offset;
          if (start === undefined || end === undefined) return;
          const original = source.slice(start, end);
          const opener = /^(`{3,}|~{3,})/u.exec(original)?.[1];
          const closer = /\n[ \t]*(`{3,}|~{3,})[ \t]*$/u.exec(original)?.[1];
          if (opener && closer && closer[0] === opener[0] && closer.length >= opener.length) {
            languages.add(language);
            outsideWords += words(source.slice(cursor, start));
            cursor = end;
          }
        } else for (const child of node.children ?? []) visit(child);
      };
      visit(markdown.parse(source));
      outsideWords += words(source.slice(cursor));
    }
    return { editableCode: [...languages].sort(), editorOutsideWords: languages.size ? outsideWords : null };
  } catch { return { editableCode: null, editorOutsideWords: null }; }
}

/** Historical adapters can continue requesting only the editor languages. */
export function inspectEditableCodeLanguages(text: string): CodePracticeLanguage[] | null {
  return inspectEditableCodeEvidence(text).editableCode;
}
