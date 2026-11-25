#!/usr/bin/env python3
"""Re-sync a specialist interactive-reply lane from the mockups into the production web app.

    python3 scripts/port-interactive-lane.py <lane|all> [--lanes DIR]

DIR defaults to web/.keating-mockups/lanes in the main checkout. The port is mechanical so a
lane fix can be re-synced without hand edits (docs/design/interactive-replies.md, "Specialist
components"):

- Files in MANIFEST are copied verbatim into web/src/components/interactive-replies/<kind>/.
- CSS: `Nrem` -> `calc(N * var(--ir-rem))`; each `@media (prefers-color-scheme: dark|light) { ... }`
  block is unwrapped and every selector inside it is prefixed with `:root.dark ` /
  `:root:not(.dark) ` (the app theme is the `dark` class on <html>, not the OS scheme).
- TS/TSX: the exact substitutions in EDITS (DEV gates for window.keating* hooks and test flags,
  the theme class instead of matchMedia). Each must match exactly once, so a lane change that
  moves one fails loudly instead of shipping an ungated hook.
"""
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEST = ROOT / "web/src/components/interactive-replies"
DEFAULT_LANES = pathlib.Path("/home/diogenes/Projects/experiments/keating/web/.keating-mockups/lanes")

# lane dir -> (contract kind, files)
MANIFEST = {
    "anatomy3d": ("anatomy", ["component.tsx", "engine.ts", "view3d.ts", "component.css"]),
    "pharm": ("pharmacology", ["component.tsx", "model.ts", "component.css"]),
    "methods": ("methods", ["component.tsx", "config.ts", "dag.tsx", "diagnostic.tsx", "meta.tsx", "model.ts", "presets.ts", "shared.tsx", "survival.tsx", "component.css"]),
    "physics": ("physics", ["component.tsx", "common.tsx", "field.tsx", "physics.ts", "quantum.tsx", "types.ts", "waves.tsx", "component.css"]),
}

EDITS = {
    ("anatomy3d", "component.tsx"): [(
        "  useEffect(() => {\n    const stage = () => stageRef.current!.getBoundingClientRect();",
        "  useEffect(() => {\n    if (!import.meta.env.DEV) return;\n    const stage = () => stageRef.current!.getBoundingClientRect();",
    )],
    ("anatomy3d", "engine.ts"): [(
        "    if ((window as unknown as { __keatingNoWebGL?: boolean }).__keatingNoWebGL) return false;",
        "    if (import.meta.env.DEV && (window as unknown as { __keatingNoWebGL?: boolean }).__keatingNoWebGL) return false;",
    )],
    ("pharm", "component.tsx"): [(
        '    if (typeof window === "undefined") return;\n    window.keatingPharm = {',
        '    if (!import.meta.env.DEV) return;\n    if (typeof window === "undefined") return;\n    window.keatingPharm = {',
    )],
    ("physics", "common.tsx"): [(
        "  useEffect(() => {\n    const w = window as unknown as { keatingPhysics?: LabApi };",
        "  useEffect(() => {\n    if (!import.meta.env.DEV) return;\n    const w = window as unknown as { keatingPhysics?: LabApi };",
    ), (
        '''    if (typeof window === "undefined" || !window.matchMedia) return;
    const q = window.matchMedia("(prefers-color-scheme: light)");
    setDark(!q.matches);
    const on = () => setDark(!q.matches);
    q.addEventListener?.("change", on);
    return () => q.removeEventListener?.("change", on);''',
        '''    // Keating port: the app theme is the `dark` class on <html> (theme-sync), not the OS scheme.
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    const on = () => setDark(root.classList.contains("dark"));
    on();
    const observer = new MutationObserver(on);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();''',
    )],
    ("physics", "waves.tsx"): [(
        "    if ((window as unknown as { keatingPhysicsNoGL?: boolean }).keatingPhysicsNoGL) return null;",
        "    if (import.meta.env.DEV && (window as unknown as { keatingPhysicsNoGL?: boolean }).keatingPhysicsNoGL) return null;",
    )],
}


def rem(css: str) -> str:
    return re.sub(r"(?<![\w.-])(\d*\.?\d+)rem\b", lambda m: f"calc({m.group(1)} * var(--ir-rem))", css)


def block_end(text: str, start: int) -> int:
    depth = 0
    for index in range(start, len(text)):
        if text[index] == "{":
            depth += 1
        elif text[index] == "}":
            depth -= 1
            if depth == 0:
                return index
    raise ValueError("unbalanced braces")


def prefix_rules(body: str, prefix: str) -> str:
    out, index = [], 0
    while index < len(body):
        brace = body.find("{", index)
        if brace < 0:
            out.append(body[index:])
            break
        selector = body[index:brace]
        end = block_end(body, brace)
        lead = selector[: len(selector) - len(selector.lstrip())]
        selectors = ", ".join(prefix + part.strip() for part in selector.split(","))
        out.append(f"{lead}{selectors} {body[brace:end + 1]}")
        index = end + 1
    return "".join(out)


def scheme(css: str) -> str:
    pattern = re.compile(r"@media\s*\(prefers-color-scheme:\s*(dark|light)\)\s*\{")
    while match := pattern.search(css):
        open_at = match.end() - 1
        end = block_end(css, open_at)
        prefix = ":root.dark " if match.group(1) == "dark" else ":root:not(.dark) "
        body = prefix_rules(css[open_at + 1:end], prefix).strip("\n")
        body = "\n".join(line[2:] if line.startswith("  ") else line for line in body.split("\n"))
        css = css[:match.start()] + body + css[end + 1:]
    return css


def port(lanes: pathlib.Path, lane: str) -> None:
    kind, files = MANIFEST[lane]
    target = DEST / kind
    target.mkdir(parents=True, exist_ok=True)
    for name in files:
        text = (lanes / lane / name).read_text()
        if name.endswith(".css"):
            text = scheme(rem(text))
        for old, new in EDITS.get((lane, name), []):
            count = text.count(old)
            if count != 1:
                raise SystemExit(f"{lane}/{name}: expected one match for an edit, found {count}:\n{old}")
            text = text.replace(old, new)
        (target / name).write_text(text)
        print(f"{lane}/{name} -> {target.relative_to(ROOT)}/{name}")


def main(argv: list[str]) -> None:
    args = [arg for arg in argv if not arg.startswith("--lanes")]
    lanes = DEFAULT_LANES
    for arg in argv:
        if arg.startswith("--lanes="):
            lanes = pathlib.Path(arg.split("=", 1)[1])
    if len(args) != 1 or (args[0] != "all" and args[0] not in MANIFEST):
        raise SystemExit(f"usage: port-interactive-lane.py <{'|'.join(MANIFEST)}|all> [--lanes=DIR]")
    for lane in MANIFEST if args[0] == "all" else [args[0]]:
        port(lanes, lane)


if __name__ == "__main__":
    main(sys.argv[1:])
