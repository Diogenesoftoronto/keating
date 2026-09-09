#!/usr/bin/env python3
"""Compile and locally render the OpenUI seed. Never contacts Tinker."""
import json
import os
from pathlib import Path
import subprocess
import typer
from prepare_identity_sft import ROOT, compile_dataset, sha

app = typer.Typer(add_completion=False, pretty_exceptions_enable=False)


@app.command()
def main(
    catalog: Path = typer.Option(Path(__file__).parent / "data/openui-sft.json", exists=True),
    system_prompt: Path = typer.Option(ROOT / ".keating/outputs/training/openui-context/system-prompt.txt", exists=True),
    model_record: Path = typer.Option(ROOT / ".keating/outputs/training/inkling-pilot/result.json", exists=True),
    output_dir: Path = typer.Option(ROOT / ".keating/outputs/training/openui-sft-v1"),
):
    """Validate real OpenUI, preserve the application prompt, and verify native SFT rendering offline."""
    splits, manifest = compile_dataset(catalog, system_prompt, model_record)
    result = subprocess.run(["rtk", "proxy", "bun", str(ROOT / "scripts/training/validate_openui_sft.ts"), str(catalog.resolve())],
                            cwd=ROOT, check=True, text=True, capture_output=True)
    grammar = json.loads(result.stdout)
    # Cached tokenizer only: this command cannot issue hosted inference or training.
    os.environ["HF_HUB_OFFLINE"] = "1"
    from tinker_cookbook import renderers, tokenizer_utils
    parent = json.loads(model_record.read_text())
    renderer = renderers.get_renderer(parent["renderer"], tokenizer_utils.get_tokenizer(parent["model"]), model_name=parent["model"])
    rendered = {}
    for split, rows in splits.items():
        stats = []
        for row in rows:
            messages = list(row["messages"])
            messages.insert(1, {"role": "tool_declare", "content": json.dumps(row["tools"], separators=(",", ":"))})
            tokens, weights = renderer.build_supervised_example(messages, train_on_what=renderers.TrainOnWhat.LAST_ASSISTANT_MESSAGE, effort=parent["effort"])
            supervised = int((weights > 0).sum().item())
            first_target = int((weights > 0).nonzero()[0].item())
            if tokens.length > 32768 or supervised <= 0 or first_target < 1000 or (weights[:first_target] != 0).any():
                raise ValueError(f"Unexpected target masking or token bound: {row['id']}")
            stats.append({"id": row["id"], "tokens": tokens.length, "supervised_tokens": supervised, "first_target": first_target})
        rendered[split] = stats
    manifest.update({
        "validation_purpose": "Reserved topic families for OpenUI syntax and interaction selection; no human-learning effectiveness claim.",
        "loss_contract": "Native tml_v0 LAST_ASSISTANT_MESSAGE; unchanged system, user and tool declarations are masked.",
        "limitations": ["Synthetic single-turn seed, not real learner outcomes.", "No native tool-call or serialized learner-response training examples in this version.", "Compiled document validation is not browser interaction or model-quality validation.", "No paid training or serving changes performed; existing models have not learned this dataset."],
        "grammar_validation": grammar, "native_render_validation": rendered, "provider_calls": 0,
    })
    payloads = {f"{split}.jsonl": "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows).encode() for split, rows in splits.items()}
    manifest["output_sha256"] = {name: sha(body) for name, body in payloads.items()}
    payloads["manifest.json"] = (json.dumps(manifest, indent=2) + "\n").encode()
    output_dir.mkdir(parents=True, exist_ok=False, mode=0o700)
    for name, body in payloads.items():
        fd = os.open(output_dir / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, "wb") as output:
            output.write(body)
    print(json.dumps({"output_dir": str(output_dir), "counts": manifest["counts"], "openui": grammar["openui"], "max_tokens": max(r["tokens"] for s in rendered.values() for r in s), "provider_calls": 0}))


if __name__ == "__main__":
    app()
