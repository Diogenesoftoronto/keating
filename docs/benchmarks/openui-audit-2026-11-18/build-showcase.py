"""Build a single offline HTML file from the recorded OpenUI audit view."""

import argparse
import base64
import html
import json
import os
import re
import subprocess
import tempfile
from pathlib import Path


HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]


def data_url(path, mime):
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime};base64,{encoded}"


def browser_helpers(runtime_root):
    modules = {
        "parseOpenUIMessageSegments": "web/src/keating/openui/segments.ts",
        "tryCompileOpenUISourceToSharedDocument": "packages/learner-contracts/src/openui-source.ts",
        "parseSimulationExpression, evaluateSimulationExpression": "packages/learner-contracts/src/simulation-expression.ts",
        "objectiveCredit": "packages/learner-contracts/src/objective-quiz.ts",
        "marked": "node_modules/marked/lib/marked.esm.js",
    }
    imports = [
        f"import {{ {names} }} from {json.dumps(str(runtime_root / location))};"
        for names, location in modules.items()
    ]
    exports = ", ".join(modules.keys())
    with tempfile.TemporaryDirectory() as folder:
        entry = Path(folder) / "helpers.ts"
        bundle = Path(folder) / "helpers.js"
        entry.write_text("\n".join([*imports, f"window.auditTools = {{ {exports} }};"]))
        result = subprocess.run(
            ["bun", "build", str(entry), "--target=browser", "--format=iife",
             "--minify", "--outfile", str(bundle)],
            cwd=runtime_root, capture_output=True, text=True,
        )
        if result.returncode:
            raise RuntimeError(result.stderr.strip())
        return bundle.read_text().replace("</script", r"<\/script")


def main():
    options = argparse.ArgumentParser(description=__doc__)
    options.add_argument("--input", type=Path, default=HERE / "study-view.json")
    options.add_argument("--output", type=Path, default=HERE / "showcase.html")
    options.add_argument("--runtime-root", type=Path,
                         default=Path(os.environ.get("KEATING_AUDIT_RELEASE", REPO)),
                         help="Keating checkout that supplies the compiler and simulation evaluator")
    args = options.parse_args()
    study = json.loads(args.input.read_text())
    for field in ("headline", "dek", "metrics", "models", "examples", "historical", "production"):
        if field not in study:
            raise ValueError(f"Missing study field {field!r}")
    regular = REPO / "web/src/assets/fonts/atkinson-hyperlegible"
    template = (HERE / "showcase.template.html").read_text()
    replacements = {
        "@@BOT@@": data_url(REPO / "web/public/favicon-bot.png", "image/png"),
        "@@FONT_REGULAR@@": data_url(regular / "AtkinsonHyperlegible-Regular.woff2", "font/woff2"),
        "@@FONT_BOLD@@": data_url(regular / "AtkinsonHyperlegible-Bold.woff2", "font/woff2"),
        "@@FONT_LICENSE@@": html.escape((regular / "OFL.txt").read_text()),
        "@@HEADLINE@@": html.escape(study["headline"]),
        "@@DEK@@": html.escape(study["dek"]),
        "@@RUNTIME@@": browser_helpers(args.runtime_root.resolve()),
        "@@STUDY@@": json.dumps(study, ensure_ascii=True, separators=(",", ":"), allow_nan=False)
        .replace("<", r"\u003c").replace(">", r"\u003e").replace("&", r"\u0026"),
    }
    # Replace each trusted template marker once, without re-scanning inserted model text.
    pattern = re.compile("|".join(map(re.escape, replacements)))
    args.output.write_text(pattern.sub(lambda match: replacements[match.group()], template))
    print(f"{args.output} ({args.output.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
