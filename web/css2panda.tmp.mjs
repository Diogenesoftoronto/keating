import postcss from "postcss";
import fs from "node:fs";

const file = process.argv[2];
const css = fs.readFileSync(file, "utf8");
const root = postcss.parse(css);

function camel(prop) {
  if (prop.startsWith("--")) return prop; // custom property, keep literal
  return prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function needsQuote(key) {
  return !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key);
}

function keyStr(key) {
  return needsQuote(key) ? JSON.stringify(key) : key;
}

function valStr(v) {
  // preserve as JS string literal, escape properly
  return JSON.stringify(v);
}

// selector -> { prop: value } (last decl wins per property, matching CSS cascade for same-specificity/source-order... NOT fully accurate for combined selectors, but ok since each rule kept separate as its own object entry, mapped 1:1 to its own selector key)
const globalEntries = []; // { selector, decls: [[prop,val]], mediaWrap: string|null }
const keyframesEntries = []; // { name, frames: [{selector, decls}] }
const fontFaceEntries = [];

function collectDecls(rule) {
  const decls = [];
  rule.walkDecls((d) => {
    if (d.parent !== rule) return;
    decls.push([d.prop, d.value + (d.important ? " !important" : "")]);
  });
  return decls;
}

root.walk((node) => {
  if (node.type === "rule" && node.parent === root) {
    globalEntries.push({ selector: node.selector, decls: collectDecls(node), mediaWrap: null });
  }
});

root.walkAtRules("media", (atrule) => {
  if (atrule.parent !== root) return;
  atrule.walkRules((rule) => {
    globalEntries.push({ selector: rule.selector, decls: collectDecls(rule), mediaWrap: `@media ${atrule.params}` });
  });
});

root.walkAtRules("keyframes", (atrule) => {
  const frames = [];
  atrule.walkRules((rule) => {
    frames.push({ selector: rule.selector, decls: collectDecls(rule) });
  });
  keyframesEntries.push({ name: atrule.params, frames });
});

root.walkAtRules("font-face", (atrule) => {
  fontFaceEntries.push({ decls: collectDecls(atrule) });
});

function serializeDeclsObj(decls, indent) {
  const pad = "  ".repeat(indent);
  const padEnd = "  ".repeat(indent - 1);
  const lines = decls.map(([p, v]) => `${pad}${keyStr(camel(p))}: ${valStr(v)}`);
  return `{\n${lines.join(",\n")}\n${padEnd}}`;
}

// group globalEntries by mediaWrap, then merge duplicate selectors within
// the same media bucket (later rule's properties override earlier ones for
// the same property name, matching normal CSS cascade for same-specificity
// same-selector rules in source order — properties are appended in order,
// with later same-name entries replacing earlier ones by re-inserting at
// the end so JS object literal key order still reflects final winner order).
const byMedia = new Map();
for (const e of globalEntries) {
  const k = e.mediaWrap || "__root__";
  if (!byMedia.has(k)) byMedia.set(k, new Map());
  const sels = byMedia.get(k);
  if (!sels.has(e.selector)) sels.set(e.selector, []);
  const merged = sels.get(e.selector);
  for (const [prop, val] of e.decls) {
    const existingIdx = merged.findIndex(([p]) => p === prop);
    if (existingIdx !== -1) merged.splice(existingIdx, 1);
    merged.push([prop, val]);
  }
}

let out = "";
out += "// ===== GLOBALCSS ENTRIES (grouped; __root__ = top-level, merge into globalCss root) =====\n";
for (const [media, sels] of byMedia) {
  out += `\n// -- ${media} --\n`;
  for (const [selector, decls] of sels) {
    if (decls.length === 0) continue;
    out += `${keyStr(selector)}: ${serializeDeclsObj(decls, 1)},\n`;
  }
}

out += "\n\n// ===== KEYFRAMES (theme.extend.keyframes) =====\n";
for (const kf of keyframesEntries) {
  out += `${keyStr(kf.name)}: {\n`;
  for (const f of kf.frames) {
    out += `  ${keyStr(f.selector)}: ${serializeDeclsObj(f.decls, 2)},\n`;
  }
  out += `},\n`;
}

if (fontFaceEntries.length) {
  out += "\n\n// ===== FONT-FACE (raw, needs manual placement) =====\n";
  for (const ff of fontFaceEntries) {
    out += `${serializeDeclsObj(ff.decls, 1)},\n`;
  }
}

fs.writeFileSync(process.argv[3], out);
console.error(`entries: ${globalEntries.length}, keyframes: ${keyframesEntries.length}, fontface: ${fontFaceEntries.length}`);
