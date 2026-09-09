#!/usr/bin/env python3
"""Attach verified default prompts to public traces without learner/account data."""
import hashlib
import json
from pathlib import Path
import typer

ROOT = Path(__file__).resolve().parents[2]
app = typer.Typer(add_completion=False, pretty_exceptions_enable=False)


def read_default_prompt(path: Path, expected: str | None = None) -> dict:
    body = path.read_bytes()
    digest = hashlib.sha256(body).hexdigest()
    metadata = json.loads(Path(str(path) + ".metadata.json").read_text())
    if (metadata.get("verifiedEqualToOriginalWebBuilder") is not True
        or digest != metadata["promptSha256"] or (expected and digest != expected)):
        raise ValueError("Prompt hash does not match its recorded use")
    state = metadata["state"]
    if (state["persona"] != "DEFAULT_TEACHER_PERSONA"
        or any(state[k] for k in ["learnerContext", "sessionStartContext", "runtime", "course", "activeTeachingRevision"])
        or state["speechEnabled"]):
        raise ValueError("Only the default prompt without private session context may be published")
    return {"sha256": digest, "text": body.decode(), "bytes": len(body),
            "tool_count": metadata["toolSchemas"]["count"],
            "scope": "Default application context. Tool schemas were supplied separately; no private learner context is included."}


@app.command()
def main():
    path = ROOT / "web/public/reports/learning-to-teach/report-data.json"
    data = json.loads(path.read_text())
    base = ROOT / ".keating/outputs/training"
    digest = data["three_arm"]["system_prompt_sha256"]
    recorded = read_default_prompt(base / "openui-training-context/system-prompt.txt", digest)
    recorded["label"] = "Prompt used for these recorded responses"
    for arm, folder in [("before", "openui-eval-before"), ("after", "openui-eval-after"), ("sdpo", "openui-eval-sdpo")]:
        evaluation = json.loads((base / folder / "evaluation.json").read_text())
        if evaluation["system_prompt_sha256"] != digest:
            raise ValueError(f"Unexpected prompt for {arm}")
        for trace in data["interaction_round"][arm]:
            trace["system_prompt_sha256"] = digest
    manifest = json.loads((base / "openui-training-data/manifest.json").read_text())
    if manifest["system_prompt_sha256"] != digest:
        raise ValueError("The training conversation compiler used a different prompt")
    data["conversation_system_prompt_sha256"] = digest
    data["interaction_round"]["system_prompt_sha256"] = digest
    revised = read_default_prompt(ROOT / ".keating/outputs/prompt-review/2026-09-07/system-prompt.txt")
    revised["label"] = "Later application prompt revision, not used for these results"
    data["system_prompts"] = {digest: recorded, revised["sha256"]: revised}
    data["later_system_prompt_sha256"] = revised["sha256"]
    data["three_arm"]["limitations"] = [
        s.replace("same current Keating prompt", "same recorded Keating prompt").replace(
            "No new weight updates; the new OpenUI conversation corpus has not been trained.",
            "This earlier comparison predates OpenUI SFT; the later interaction experiment trained that corpus.")
        for s in data["three_arm"]["limitations"]
    ]
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"recorded_prompt": digest, "later_prompt": revised["sha256"], "private_context": False}))


if __name__ == "__main__":
    app()
