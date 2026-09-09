#!/usr/bin/env python3
"""Package only the approved report and its synthetic data for Railway."""
import hashlib
import json
import shutil
from pathlib import Path

import typer

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "web/public/reports/learning-to-teach"
CONFIG = Path(__file__).parent
app = typer.Typer(add_completion=False, pretty_exceptions_enable=False)


@app.command()
def main(output_dir: Path = typer.Option(ROOT / ".keating/outputs/railway-report")):
    """Create an exclusive, allowlisted deployment snapshot, with no account credentials."""
    source_names = ["index.html", "report.css", "report.js", "benchmark-charts.js", "benchmark-charts.css", "benchmark-v3-results.js", "benchmark-v3-results.css", "benchmark-v3-results.json", "benchmark-trajectories.js", "benchmark-trajectories.css", "openui-preview.js", "report-data.json", "keating-openui-conversations.json"]
    catalog_bytes = (SOURCE / "keating-openui-conversations.json").read_bytes()
    if catalog_bytes != (ROOT / "scripts/training/data/openui-conversations.json").read_bytes():
        raise ValueError("Report download differs from the synthetic source catalog")
    catalog = json.loads(catalog_bytes)
    report = json.loads((SOURCE / "report-data.json").read_bytes())
    if report["conversations"] != catalog["conversations"] or catalog["schema_version"] != 2:
        raise ValueError("Report and synthetic conversation data disagree")
    benchmark = report["benchmark"]
    benchmark_dir = ROOT / "scripts/training/benchmarks/teaching-v1"
    manifest = json.loads((benchmark_dir / "manifest.json").read_text())
    if benchmark["manifest"] != manifest:
        raise ValueError("Report benchmark manifest differs from the frozen release")
    for name, field in [("cases.json", "case_definition"), ("rubric.json", "rubric"), ("context.json", "context")]:
        body = (benchmark_dir / name).read_bytes()
        if (hashlib.sha256(body).hexdigest() != manifest["files"][name]
            or benchmark[field] != json.loads(body)):
            raise ValueError(f"Report benchmark differs from frozen {name}")
    if benchmark["context"]["provenance"]["private_context"] is not False:
        raise ValueError("Only public default benchmark context may be packaged")
    if report.get("benchmark_v2"):
        v2 = report["benchmark_v2"]
        v2_dir = ROOT / "scripts/training/benchmarks/teaching-v2"
        if v2["manifest"] != json.loads((v2_dir / "manifest.json").read_text()):
            raise ValueError("V2 manifest mismatch")
        if v2["context"] != json.loads((v2_dir / "context.json").read_text()):
            raise ValueError("V2 context mismatch")
        for name, field in [("cases.json", "cases"), ("rubric.json", "rubric"), ("context.json", "context")]:
            body = (v2_dir / name).read_bytes()
            value = json.loads(body)
            if name == "cases.json" and isinstance(value, dict):
                value = value["cases"]
            if hashlib.sha256(body).hexdigest() != v2["manifest"]["files"][name] or v2[field] != value:
                raise ValueError(f"V2 public definition differs from frozen {name}")
        if v2["context"]["provenance"]["private_context"] is not False:
            raise ValueError("V2 requires public default context")
    if report.get("benchmark_v3"):
        v3_dir = ROOT / "scripts/training/benchmarks/teaching-v3-profiles"
        v3 = report["benchmark_v3"]
        manifest3 = json.loads((v3_dir / "manifest.json").read_text())
        if v3["manifest"] != manifest3 or v3["definition"] != json.loads((v3_dir / "cases.json").read_text()):
            raise ValueError("V3 public definition mismatch")
        for name, digest in manifest3["files"].items():
            if hashlib.sha256((v3_dir / name).read_bytes()).hexdigest() != digest:
                raise ValueError("V3 frozen definition changed")
        results3 = json.loads((SOURCE / "benchmark-v3-results.json").read_text())
        if results3["version"] != manifest3["version"] or results3["cases"] != v3["definition"]["cases"]:
            raise ValueError("V3 results do not reference the exact frozen public cases")
    html = (SOURCE / "index.html").read_text()
    replacements = {
        'class="wordmark" href="/"': 'class="wordmark" href="https://keating.help/"',
        'href="http://127.0.0.1:3001/">Open local Keating ↗': 'href="https://keating.help/">Visit Keating ↗',
        'Local services must be running. Checkpoints have a 24-hour TTL. Browser click-through was not verified.': 'The pilot models use the local endpoints below; the public Keating app is separate. Pilot checkpoints have a 24-hour TTL. Browser click-through was not verified.',
    }
    for before, after in replacements.items():
        if before not in html:
            raise ValueError(f"Report structure changed: {before}")
        html = html.replace(before, after)
    output_dir.mkdir(parents=True, exist_ok=False)
    public = output_dir / "public"
    (public / "brand").mkdir(parents=True)
    for name in source_names:
        if name == "index.html":
            (public / name).write_text(html)
        else:
            shutil.copyfile(SOURCE / name, public / name)
    shutil.copyfile(ROOT / "web/public/brand/mascot-head-v2.png", public / "brand/mascot-head-v2.png")
    for name in ["Dockerfile", "Caddyfile", "railway.toml"]:
        shutil.copyfile(CONFIG / name, output_dir / name)
    hashes = {str(path.relative_to(output_dir)): hashlib.sha256(path.read_bytes()).hexdigest()
              for path in sorted(output_dir.rglob("*")) if path.is_file()}
    (output_dir / "snapshot.json").write_text(json.dumps({"report": "Learning to teach", "files": hashes}, indent=2) + "\n")
    print(json.dumps({"output_dir": str(output_dir), "files": list(hashes), "bytes": sum(p.stat().st_size for p in output_dir.rglob("*") if p.is_file())}))


if __name__ == "__main__":
    app()
