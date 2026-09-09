#!/usr/bin/env python3
"""Compile the reviewed FAQ seed using Keating's exact exported prompt. No API calls."""
import hashlib
import json
import os
from pathlib import Path
import typer

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATA = Path(__file__).parent / "data/identity-sft.json"
app = typer.Typer(add_completion=False, pretty_exceptions_enable=False)


def sha(body):
    return hashlib.sha256(body).hexdigest()


def validate_catalog(data):
    if data.get("schema_version") != 1 or data.get("base_model") != "thinkingmachines/Inkling-Small":
        raise ValueError("This identity dataset is explicitly bound to Inkling-Small")
    sources = data["sources"]
    ids, questions, families = set(), set(), {}
    for split in ("train", "validation"):
        if not data[split]:
            raise ValueError("Both training and validation examples are required")
        for row in data[split]:
            if set(row) != {"id", "family", "sources", "user", "assistant"}:
                raise ValueError("Unexpected example fields")
            if any(not isinstance(row[k], str) or not row[k].strip() for k in ("id", "family", "user", "assistant")):
                raise ValueError("Example fields must be nonempty text")
            question = " ".join(row["user"].casefold().split())
            if row["id"] in ids or question in questions:
                raise ValueError("Duplicate example ID or question")
            if row["family"] in families and families[row["family"]] != split:
                raise ValueError("Question family crosses train/validation split")
            if not row["sources"] or any(ref not in sources for ref in row["sources"]):
                raise ValueError("Every example requires known source references")
            ids.add(row["id"])
            questions.add(question)
            families[row["family"]] = split


def compile_dataset(catalog_path, prompt_path, model_record_path, root=ROOT):
    catalog_bytes = catalog_path.read_bytes()
    catalog = json.loads(catalog_bytes)
    validate_catalog(catalog)
    prompt_bytes = prompt_path.read_bytes()
    prompt = prompt_bytes.decode()
    if not prompt.strip():
        raise ValueError("Exported application prompt is empty")
    metadata = json.loads(Path(str(prompt_path) + ".metadata.json").read_text())
    if metadata.get("verifiedEqualToOriginalWebBuilder") is not True or metadata.get("promptSha256") != sha(prompt_bytes):
        raise ValueError("Prompt export verification or hash failed")
    # Reject stale source exports rather than silently training an old prompt.
    for relative, expected in metadata["sourceSha256"].items():
        if sha((root / relative).read_bytes()) != expected:
            raise ValueError(f"Prompt source changed; rerun export_system_prompt.ts: {relative}")
    model_record_bytes = model_record_path.read_bytes()
    if json.loads(model_record_bytes).get("model") != catalog["base_model"]:
        raise ValueError("Serving model and identity dataset differ")
    source_evidence = {}
    for name, source in catalog["sources"].items():
        evidence = dict(source)
        if "path" in source:
            body = (root / source["path"]).read_bytes()
            if source["anchor"] not in body.decode():
                raise ValueError(f"Source anchor changed: {name}")
            evidence["sha256"] = sha(body)
        source_evidence[name] = evidence
    tools_path = prompt_path.parent / "tool-schemas.json"
    tools_body = tools_path.read_bytes()
    if sha(tools_body) != metadata["toolSchemas"]["sha256"]:
        raise ValueError("Exported tool schemas changed")
    tools = json.loads(tools_body)
    splits = {}
    for split in ("train", "validation"):
        splits[split] = [{
            "id": row["id"], "family": row["family"], "sources": row["sources"],
            "messages": [{"role": "system", "content": prompt},
                         {"role": "user", "content": row["user"]},
                         {"role": "assistant", "content": row["assistant"]}],
            "tools": tools,
        } for row in catalog[split]]
    manifest = {
        "schema_version": 1, "dataset_id": catalog["dataset_id"],
        "base_model": catalog["base_model"], "authorship": catalog["authorship"],
        "public_model_id": catalog.get("public_model_id", "keating-pilot"),
        "public_model_name": catalog.get("public_model_name", "Keating"),
        "counts": {split: len(rows) for split, rows in splits.items()},
        "catalog_sha256": sha(catalog_bytes), "system_prompt_sha256": sha(prompt_bytes),
        "tool_schemas_sha256": sha(tools_body), "model_record_sha256": sha(model_record_bytes),
        "source_evidence": source_evidence,
        "loss_contract": "Assistant answer tokens only; system, user and tool-declaration tokens have zero loss weight",
        "rendering_contract": "Use native tml_v0 with the same effort as serving; render tools as tool_declare, not assistant text",
        "validation_purpose": "FAQ consistency on reserved question families about the same facts; not unseen-fact or tool-execution generalization",
        "limitations": [
            "Author-supplied source references require semantic review; hashes do not prove entailment.",
            "No paid training, deployment, or quality evaluation is performed by this compiler.",
            "Identity examples apply only to Inkling-Small; regenerate when the underlying model changes.",
            "Exact prompt and tools are retained as context; this is not a prompt replacement or tool-execution dataset.",
        ],
    }
    return splits, manifest


@app.command()
def main(
    catalog: Path = typer.Option(DEFAULT_DATA, exists=True, dir_okay=False),
    system_prompt: Path = typer.Option(ROOT / ".keating/outputs/training/system-prompt.txt", exists=True, dir_okay=False),
    model_record: Path = typer.Option(ROOT / ".keating/outputs/training/inkling-pilot/result.json", exists=True, dir_okay=False),
    output_dir: Path = typer.Option(ROOT / ".keating/outputs/training/identity-sft"),
):
    """Compile the FAQ seed with the exact application prompt; no provider calls."""
    splits, manifest = compile_dataset(catalog, system_prompt, model_record)
    payloads = {f"{split}.jsonl": "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows).encode()
                for split, rows in splits.items()}
    manifest["output_sha256"] = {name: sha(body) for name, body in payloads.items()}
    payloads["manifest.json"] = (json.dumps(manifest, indent=2, ensure_ascii=False) + "\n").encode()
    output_dir.mkdir(parents=True, exist_ok=False, mode=0o700)
    for name, body in payloads.items():
        fd = os.open(output_dir / name, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(fd, "wb") as output:
            output.write(body)
    print(json.dumps({"output_dir": str(output_dir), "counts": manifest["counts"],
                      "base_model": manifest["base_model"], "provider_calls": 0}))


if __name__ == "__main__":
    app()
