import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

interface MarkdownBlockProps {
  content: string;
}

export function MarkdownBlock({ content }: MarkdownBlockProps) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={{
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        pre: ({ children }: any) => <pre className="overflow-x-auto rounded-md bg-muted p-3 text-xs">{children}</pre>,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        code: ({ className, children, ...props }: any) => {
          const isInline = !className?.includes("language-");
          if (isInline) {
            return <code className="rounded bg-muted px-1.5 py-0.5 text-sm font-mono" {...props}>{children}</code>;
          }
          return <code className="font-mono text-sm" {...props}>{children}</code>;
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        p: ({ children }: any) => <p className="mb-3 last:mb-0">{children}</p>,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ul: ({ children }: any) => <ul className="mb-3 list-disc pl-5">{children}</ul>,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ol: ({ children }: any) => <ol className="mb-3 list-decimal pl-5">{children}</ol>,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        li: ({ children }: any) => <li className="mb-1">{children}</li>,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        h1: ({ children }: any) => <h1 className="mb-2 mt-4 text-lg font-semibold">{children}</h1>,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        h2: ({ children }: any) => <h2 className="mb-2 mt-3 text-base font-semibold">{children}</h2>,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        h3: ({ children }: any) => <h3 className="mb-1 mt-2 text-sm font-semibold">{children}</h3>,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        strong: ({ children }: any) => <strong className="font-semibold">{children}</strong>,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        em: ({ children }: any) => <em className="italic">{children}</em>,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        a: ({ children, href }: any) => <a href={href} className="text-primary underline" target="_blank" rel="noreferrer">{children}</a>,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        blockquote: ({ children }: any) => <blockquote className="my-2 border-l-2 border-border pl-3 text-muted-foreground">{children}</blockquote>,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        table: ({ children }: any) => <table className="mb-3 w-full border-collapse text-sm">{children}</table>,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        thead: ({ children }: any) => <thead className="border-b border-border bg-muted/50">{children}</thead>,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        th: ({ children }: any) => <th className="px-3 py-2 text-left font-semibold">{children}</th>,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        td: ({ children }: any) => <td className="border-b border-border px-3 py-2">{children}</td>,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
