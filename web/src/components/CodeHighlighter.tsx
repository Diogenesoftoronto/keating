// Heavy syntax-highlighting code, isolated into its own chunk so it is only
// fetched the first time a fenced code block actually renders. Lazily imported
// from MarkdownBlock via React.lazy — keep the default export.
import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
import tsx from "react-syntax-highlighter/dist/esm/languages/prism/tsx";
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript";
import python from "react-syntax-highlighter/dist/esm/languages/prism/python";
import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import css from "react-syntax-highlighter/dist/esm/languages/prism/css";
import markup from "react-syntax-highlighter/dist/esm/languages/prism/markup";
import yaml from "react-syntax-highlighter/dist/esm/languages/prism/yaml";
import rust from "react-syntax-highlighter/dist/esm/languages/prism/rust";
import go from "react-syntax-highlighter/dist/esm/languages/prism/go";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";

// Register only the languages we need (keeps bundle smaller)
SyntaxHighlighter.registerLanguage("tsx", tsx);
SyntaxHighlighter.registerLanguage("jsx", tsx);
SyntaxHighlighter.registerLanguage("javascript", javascript);
SyntaxHighlighter.registerLanguage("js", javascript);
SyntaxHighlighter.registerLanguage("typescript", typescript);
SyntaxHighlighter.registerLanguage("ts", typescript);
SyntaxHighlighter.registerLanguage("python", python);
SyntaxHighlighter.registerLanguage("py", python);
SyntaxHighlighter.registerLanguage("bash", bash);
SyntaxHighlighter.registerLanguage("sh", bash);
SyntaxHighlighter.registerLanguage("shell", bash);
SyntaxHighlighter.registerLanguage("json", json);
SyntaxHighlighter.registerLanguage("css", css);
SyntaxHighlighter.registerLanguage("html", markup);
SyntaxHighlighter.registerLanguage("yaml", yaml);
SyntaxHighlighter.registerLanguage("yml", yaml);
SyntaxHighlighter.registerLanguage("rust", rust);
SyntaxHighlighter.registerLanguage("rs", rust);
SyntaxHighlighter.registerLanguage("go", go);
SyntaxHighlighter.registerLanguage("golang", go);

export default function CodeHighlighter({
	code,
	language,
}: {
	code: string;
	language: string;
}) {
	return (
		<SyntaxHighlighter
			language={language}
			style={vscDarkPlus}
			showLineNumbers
			lineNumberStyle={{ minWidth: "2.2em", paddingRight: "1em", color: "#6e7681", fontSize: "0.75em" }}
			customStyle={{
				margin: 0,
				borderRadius: 0,
				fontSize: "0.82rem",
				lineHeight: 1.55,
				background: "#0d1117",
			}}
		>
			{code.replace(/\n$/, "")}
		</SyntaxHighlighter>
	);
}
