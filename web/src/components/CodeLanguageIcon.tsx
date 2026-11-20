import type { IconType } from "react-icons";
import {
	SiC, SiCplusplus, SiCss, SiDocker, SiGnubash, SiGo, SiHtml5, SiJavascript,
	SiJson, SiKubernetes, SiLinux, SiNixos, SiPython, SiRust, SiTypescript,
	SiWebassembly, SiYaml,
} from "react-icons/si";
import { KeatingGlyph, type GlyphName } from "../design-system/glyphs";

const marks: Readonly<Record<string, IconType | GlyphName>> = {
	javascript: SiJavascript, js: SiJavascript, mjs: SiJavascript, cjs: SiJavascript, jsx: SiJavascript,
	typescript: SiTypescript, ts: SiTypescript, tsx: SiTypescript,
	python: SiPython, py: SiPython,
	rust: SiRust, rs: SiRust,
	go: SiGo, golang: SiGo,
	c: SiC, cpp: SiCplusplus, "c++": SiCplusplus,
	html: SiHtml5, css: SiCss, json: SiJson, yaml: SiYaml, yml: SiYaml,
	bash: SiGnubash, sh: "terminal", shell: "terminal",
	kubernetes: SiKubernetes, k8s: SiKubernetes,
	nix: SiNixos, nixos: SiNixos,
	wasm: SiWebassembly, wat: SiWebassembly, webassembly: SiWebassembly,
	dockerfile: SiDocker, linux: SiLinux,
	asm: "chip", assembly: "chip", gdb: "bug", lldb: "bug", strudel: "music",
};

/** Decorative companion to the visible language name. */
export function CodeLanguageIcon({ language, size = 16 }: { language: string; size?: number }) {
	const key = language.trim().toLowerCase();
	const Mark = Object.hasOwn(marks, key) ? marks[key]! : "terminal";
	return typeof Mark === "string"
		? <KeatingGlyph name={Mark} size={size} />
		: <Mark size={size} aria-hidden="true" focusable="false" />;
}
