#!/usr/bin/env python3
"""Prepare long OpenUI/tool sessions for native Inkling SFT, fully offline."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import typer

ROOT = Path(__file__).resolve().parents[2]
app = typer.Typer(add_completion=False, pretty_exceptions_enable=False)
def sha(body):
    return hashlib.sha256(body).hexdigest()


@app.command()
def main(
    catalog: Path = typer.Option(Path(__file__).parent / "data/openui-conversations.json", exists=True),
    system_prompt: Path = typer.Option(ROOT / ".keating/outputs/training/openui-context/system-prompt.txt", exists=True),
    model_record: Path = typer.Option(ROOT / ".keating/outputs/training/inkling-pilot/result.json", exists=True),
    output_dir: Path = typer.Option(ROOT / ".keating/outputs/training/openui-conversations-v2"),
):
    """Preserve the exact application context and validate all assistant/tool targets."""
    data = json.loads(catalog.read_bytes())
    prompt = system_prompt.read_bytes()
    metadata = json.loads(Path(str(system_prompt) + ".metadata.json").read_text())
    if metadata.get("verifiedEqualToOriginalWebBuilder") is not True or metadata["promptSha256"] != sha(prompt):
        raise ValueError("Invalid application prompt export")
    for relative, expected in metadata["sourceSha256"].items():
        if sha((ROOT / relative).read_bytes()) != expected:
            raise ValueError(f"Refresh stale application prompt export: {relative}")
    parent = json.loads(model_record.read_text())
    if data["base_model"] != parent["model"] or parent["model"] != "thinkingmachines/Inkling-Small":
        raise ValueError("Base model mismatch")
    tools_path = system_prompt.parent / "tool-schemas.json"
    tools_body = tools_path.read_bytes()
    if sha(tools_body) != metadata["toolSchemas"]["sha256"]:
        raise ValueError("Stale tool export")
    declarations = json.loads(tools_body)
    check = subprocess.run(["rtk", "proxy", "bun", str(ROOT / "scripts/training/validate_openui_conversations.ts"), str(catalog.resolve()), str(tools_path.resolve())], cwd=ROOT, check=True, capture_output=True, text=True)
    validation = json.loads(check.stdout)
    os.environ["HF_HUB_OFFLINE"] = "1"
    from tinker_cookbook import renderers, tokenizer_utils
    from tinker_cookbook.renderers.base import ToolCall
    renderer = renderers.get_renderer(parent["renderer"], tokenizer_utils.get_tokenizer(parent["model"]), model_name=parent["model"])
    rows = {"train": [], "validation": []}
    render_stats = []
    for conversation in data["conversations"]:
        messages = [{"role": "system", "content": prompt.decode()}, *conversation["messages"]]
        row = {"id": conversation["id"], "family": conversation["family"], "sources": conversation["sources"], "messages": messages, "tools": declarations}
        native = []
        for message in messages:
            m = dict(message)
            if m.get("tool_calls"):
                m["tool_calls"] = [ToolCall.model_validate(c) for c in m["tool_calls"]]
            native.append(m)
        native.insert(1, {"role": "tool_declare", "content": json.dumps(declarations, separators=(",", ":"))})
        tokens, weights = renderer.build_supervised_example(native, train_on_what=renderers.TrainOnWhat.ALL_ASSISTANT_MESSAGES, effort=parent["effort"])
        if tokens.length > 32768 or int((weights > 0).sum()) < 100:
            raise ValueError(f"Invalid native training length: {row['id']}")
        # Verify context masking using the identical prefix ending before any assistant target.
        prefix_examples = renderer.build_supervised_examples(native[:3], train_on_what=renderers.TrainOnWhat.ALL_ASSISTANT_MESSAGES, effort=parent["effort"])
        prefix = renderer.build_generation_prompt(native[:3], effort=parent["effort"])
        if prefix_examples or weights[:prefix.length - 16].sum().item() != 0:
            raise ValueError("System/tool-declaration/user prefix is not masked")
        render_stats.append({"id": row["id"], "tokens": tokens.length, "supervised_tokens": int((weights > 0).sum()), "messages": len(messages)})
        rows[conversation["split"]].append(row)
    manifest = {
        "schema_version": 2, "dataset_id": data["dataset_id"], "base_model": parent["model"],
        "authorship": data["authorship"], "catalog_sha256": sha(catalog.read_bytes()),
        "system_prompt_sha256": sha(prompt), "tool_schemas_sha256": sha(tools_body),
        "sources": {name: {**source, "sha256": sha((ROOT / source["path"]).read_bytes())} for name, source in data["sources"].items()},
        "counts": {split: len(value) for split, value in rows.items()}, "validation": validation,
        "native_render": render_stats, "renderer": parent["renderer"], "effort": parent["effort"],
        "loss_contract": "ALL_ASSISTANT_MESSAGES including native tool calls; system, tool declarations, user messages and tool results are context only.",
        "tool_execution": "Real local tool code using synthetic in-memory storage; no browser persistence or provider calls.",
        "provider_calls": 0,
        "limitations": ["Synthetic six-topic seed; no human-learning efficacy measurement.", "Topic-family holdout also shares curriculum templates, so it does not prove novel interaction generalization.", "No hosted training run was started and existing served models are unchanged.", "Use a multi-turn runner with ALL_ASSISTANT_MESSAGES; run_identity_sft.py intentionally only accepts single-turn rows.", "This authored corpus is separate from Downloads-derived augmentation. Source export audit and family mapping are required before mixing them."],
    }
    payloads = {f"{split}.jsonl": "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in value).encode() for split, value in rows.items()}
    manifest["output_sha256"] = {name: sha(body) for name, body in payloads.items()}
    payloads["manifest.json"] = (json.dumps(manifest, indent=2) + "\n").encode()
    output_dir.mkdir(parents=True, exist_ok=False, mode=0o700)
    for name, body in payloads.items():
        fd = os.open(output_dir / name, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        with os.fdopen(fd, "wb") as handle:
            handle.write(body)
    print(json.dumps({"output_dir": str(output_dir), **validation, "max_tokens": max(r["tokens"] for r in render_stats), "provider_calls": 0}))


if __name__ == "__main__":
    app()
