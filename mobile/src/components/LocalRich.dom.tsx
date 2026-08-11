'use dom';

import type { DOMProps } from "expo/dom";
import katex from "katex";
import mermaid from "mermaid";
import { useEffect, useRef, useState } from "react";

interface SharedDomProps {
  dom?: DOMProps;
  source: string;
  description: string;
  backgroundColor: string;
  onRenderError?: (message: string | null) => void;
}

export interface LocalMathDomProps extends SharedDomProps {
  kind: "math";
  display: boolean;
  color: string;
  mutedColor: string;
}

export interface LocalMermaidDomProps extends SharedDomProps {
  kind: "mermaid";
  surfaceColor: string;
  textColor: string;
  mutedColor: string;
  borderColor: string;
  accentColor: string;
}

export type LocalRichDomProps = LocalMathDomProps | LocalMermaidDomProps;

const CONTENT_SECURITY_POLICY = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src data: blob:; connect-src 'none'; media-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

function installLocalDocumentPolicy(): () => void {
  const meta = document.createElement("meta");
  meta.httpEquiv = "Content-Security-Policy";
  meta.content = CONTENT_SECURITY_POLICY;
  document.head.append(meta);
  const prevent = (event: Event) => event.preventDefault();
  document.addEventListener("click", prevent, true);
  document.addEventListener("submit", prevent, true);
  window.open = () => null;
  return () => {
    meta.remove();
    document.removeEventListener("click", prevent, true);
    document.removeEventListener("submit", prevent, true);
  };
}

function safeSvg(svg: string, description: string): SVGElement {
  const parsed = new DOMParser().parseFromString(svg, "image/svg+xml");
  if (parsed.querySelector("parsererror")) throw new Error("Invalid generated SVG.");
  const root = parsed.documentElement;
  if (root.localName !== "svg" || parsed.querySelector("script,foreignObject,iframe,object,embed,a,form")) throw new Error("Unsafe generated SVG.");
  for (const element of Array.from(root.querySelectorAll("*"))) {
    for (const attribute of Array.from(element.attributes)) {
      const value = attribute.value;
      if (/^on/iu.test(attribute.name) || /^(?:href|xlink:href)$/iu.test(attribute.name)
        || /(?:javascript|vbscript|data|file|https?|ftp):/iu.test(value)
        || /url\(\s*(?!["']?#)/iu.test(value)) throw new Error("Unsafe generated SVG attribute.");
    }
  }
  root.setAttribute("role", "img");
  root.setAttribute("aria-label", description);
  root.setAttribute("width", "100%");
  root.removeAttribute("height");
  root.style.maxWidth = "none";
  root.style.height = "auto";
  return document.importNode(root, true) as unknown as SVGElement;
}

function LocalMathDom({ source, display, color, mutedColor, backgroundColor, description, onRenderError }: LocalMathDomProps) {
  const target = useRef<HTMLDivElement>(null);
  useEffect(installLocalDocumentPolicy, []);
  useEffect(() => {
    const element = target.current;
    if (!element) return;
    element.replaceChildren();
    try {
      katex.render(source, element, {
        displayMode: display,
        throwOnError: true,
        strict: "error",
        trust: false,
        // MathML is fully local and avoids KaTeX's webfont URLs, which Expo's
        // DOM exporter does not package into an Android offline document.
        output: "mathml",
        maxExpand: 1_000,
      });
      onRenderError?.(null);
    } catch {
      onRenderError?.("This formula could not be typeset safely.");
    }
  }, [display, onRenderError, source]);
  return <main style={{ boxSizing: "border-box", minWidth: display ? "100%" : "max-content", padding: display ? "8px 10px" : "2px 4px", color, background: backgroundColor, fontSize: display ? 18 : 16, lineHeight: 1.45 }}>
    <div ref={target} role="img" aria-label={description} />
    <style>{`html,body,#root{margin:0;min-height:0;background:${backgroundColor};color:${color}} body{overflow:${display ? "auto" : "hidden"}} .katex{display:${display ? "block" : "inline-block"};max-width:100%;overflow-x:auto}.katex math{font-size:1em;color:inherit}.katex-error{color:${mutedColor}} *{box-sizing:border-box}`}</style>
  </main>;
}

function LocalMermaidDom(props: LocalMermaidDomProps) {
  const { source, description, backgroundColor, surfaceColor, textColor, mutedColor, borderColor, accentColor, onRenderError } = props;
  const target = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(installLocalDocumentPolicy, []);
  useEffect(() => {
    let active = true;
    const render = async () => {
      try {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          htmlLabels: false,
          suppressErrorRendering: true,
          theme: "base",
          themeVariables: {
            background: backgroundColor,
            primaryColor: surfaceColor,
            primaryTextColor: textColor,
            primaryBorderColor: borderColor,
            lineColor: accentColor,
            secondaryColor: surfaceColor,
            tertiaryColor: backgroundColor,
            textColor,
            mainBkg: surfaceColor,
            nodeBorder: borderColor,
            clusterBkg: surfaceColor,
            clusterBorder: borderColor,
            titleColor: textColor,
            edgeLabelBackground: backgroundColor,
            noteBkgColor: surfaceColor,
            noteTextColor: textColor,
            noteBorderColor: borderColor,
            actorBkg: surfaceColor,
            actorBorder: borderColor,
            actorTextColor: textColor,
            signalColor: textColor,
            signalTextColor: textColor,
            labelTextColor: textColor,
            pieTitleTextColor: textColor,
            pieSectionTextColor: textColor,
            git0: accentColor,
            git1: mutedColor,
          },
          flowchart: { htmlLabels: false, useMaxWidth: false },
          sequence: { useMaxWidth: false },
        });
        const result = await mermaid.render("keating-local-diagram", source);
        if (!active || !target.current) return;
        target.current.replaceChildren(safeSvg(result.svg, description));
        onRenderError?.(null);
      } catch {
        if (!active) return;
        target.current?.replaceChildren();
        onRenderError?.("This diagram could not be rendered safely.");
      }
    };
    void render();
    return () => { active = false; };
  }, [accentColor, backgroundColor, borderColor, description, mutedColor, onRenderError, source, surfaceColor, textColor]);
  return <main style={{ display: "grid", gridTemplateRows: "auto 1fr", width: "100%", height: "100%", overflow: "hidden", color: textColor, background: backgroundColor }}>
    <nav aria-label="Diagram zoom" style={{ display: "flex", gap: 8, padding: "8px 10px", borderBottom: `1px solid ${borderColor}` }}>
      <button type="button" aria-label="Zoom out diagram" onClick={() => setScale((value) => Math.max(0.6, Number((value - 0.2).toFixed(1))))}>−</button>
      <button type="button" aria-label="Reset diagram zoom" onClick={() => setScale(1)}>{Math.round(scale * 100)}%</button>
      <button type="button" aria-label="Zoom in diagram" onClick={() => setScale((value) => Math.min(2.4, Number((value + 0.2).toFixed(1))))}>+</button>
    </nav>
    <section aria-label="Scrollable diagram" style={{ overflow: "auto", padding: 12, touchAction: "pan-x pan-y pinch-zoom" }}>
      <div ref={target} style={{ minWidth: 320, transform: `scale(${scale})`, transformOrigin: "top left" }} />
    </section>
    <style>{`html,body,#root{margin:0;width:100%;height:100%;overflow:hidden;background:${backgroundColor};color:${textColor}}*{box-sizing:border-box}button{min-width:44px;min-height:36px;border:1px solid ${borderColor};border-radius:7px;background:${surfaceColor};color:${textColor};font:600 13px system-ui}`}</style>
  </main>;
}

export default function LocalRichDom(props: LocalRichDomProps) {
  return props.kind === "math" ? <LocalMathDom {...props} /> : <LocalMermaidDom {...props} />;
}
