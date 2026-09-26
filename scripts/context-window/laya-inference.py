#!/usr/bin/env python3
"""Pinned Laya SDK runner. No gold labels, model patches, or silent clipping.

Install the pinned upstream source plus torch 2.8.0 and transformers 5.17.0.
Input: {"trials": [{"id", "requestSha256", "request": {"state", "questions"}}]}.
Each original question batch is one unmodified Agent.system_one call.
"""
import argparse
import hashlib
import importlib.metadata
import json
import subprocess
import time
from pathlib import Path

SOURCE_REVISION = "970dc8c5f63d7b886a68409493f37d569424f933"
CHECKPOINTS = {
    "english": ("convaiinnovations/laya", "55cf4c4ebb4ebe31b2550e8bdf3bd21b99753851"),
    "multilingual": ("convaiinnovations/laya-multilingual", "e4e9ddf21a7b1903b7acffd8814ad4307bf63a67"),
    "typed-decisions": ("convaiinnovations/laya-typed-decisions", "1a793eb568e6718f15941d08f85432581df534e3"),
}


def context_proof(agent, request, max_len, head_max_len):
    """Compare upstream sequence with an uncropped assembly, token for token."""
    from laya.common import build_sequence, render_options, serialize_state
    tokenizer = agent.tok
    encode = lambda text: tokenizer(text, add_special_tokens=False)["input_ids"]
    state_text = serialize_state(request["state"])
    state_ids = encode(state_text.replace(tokenizer.mask_token, " "))
    rows = []
    for key, question in request["questions"].items():
        agent._check_question(key, question)
        internal = agent._to_internal(question)
        instruction = f'{internal["t"]} question: {internal["ins"]}'
        options = render_options(internal)
        head = encode(instruction.replace(tokenizer.mask_token, " "))
        option_ids = [[tokenizer.mask_token_id] + encode(" " + option.replace(tokenizer.mask_token, " ")) for option in options]
        complete = [tokenizer.cls_token_id] + head + [tokenizer.sep_token_id]
        markers = []
        for ids in option_ids:
            markers.append(len(complete))
            complete.extend(ids)
        complete += [tokenizer.sep_token_id] + state_ids + [tokenizer.sep_token_id]
        actual, actual_markers = build_sequence(tokenizer, request["state"], internal,
            max_len=max_len, head_max_len=head_max_len,
            truncate_left=isinstance(request["state"], list), state_ids=state_ids)
        mask_replaced = any(tokenizer.mask_token in text for text in [state_text, instruction, *options])
        rows.append({"question": key, "stateTokens": len(state_ids),
            "unclippedTokens": len(complete), "encodedTokens": len(actual),
            "maxOptionTokens": max(len(ids) - 1 for ids in option_ids),
            "fullContext": actual == complete and actual_markers == markers and not mask_replaced,
            "literalMaskReplaced": mask_replaced})
    return {"maxLen": max_len, "headMaxLen": head_max_len,
        "fullContext": all(row["fullContext"] for row in rows),
        "questionCount": len(rows), "questions": rows}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--source", required=True)
    parser.add_argument("--checkpoint", choices=CHECKPOINTS, default="english")
    parser.add_argument("--device", default="cuda")
    parser.add_argument("--mode", choices=["full-context", "native-diagnostic"], default="full-context")
    parser.add_argument("--max-len", type=int, default=1024)
    args = parser.parse_args()
    source = Path(args.source).resolve()
    actual_revision = subprocess.check_output(["git", "-C", str(source), "rev-parse", "HEAD"], text=True).strip()
    if actual_revision != SOURCE_REVISION:
        raise SystemExit("source revision mismatch")
    subprocess.run(["git", "-C", str(source), "diff", "--quiet", "HEAD", "--", "laya"], check=True)
    import laya
    if not Path(laya.__file__).resolve().is_relative_to(source):
        raise SystemExit("imported laya must be the verified editable source checkout")
    from huggingface_hub import snapshot_download
    from laya.agent import Agent
    payload = json.loads(Path(args.input).read_text())
    if not {"trials"} <= set(payload) <= {"trials", "parentPlanSha256"}:
        raise SystemExit("input must contain only gold-free trials")
    for trial in payload["trials"]:
        if set(trial) != {"id", "requestSha256", "request"} or not set(trial["request"]) <= {"state", "questions", "model"}:
            raise SystemExit("unexpected input metadata; only gold-free wire requests permitted")
    repository, revision = CHECKPOINTS[args.checkpoint]
    directory = snapshot_download(repository, revision=revision,
        allow_patterns=["rl_agent_config.json", "model.safetensors", "tokenizer/*", "encoder/*"])
    agent = Agent(directory, device=args.device, fast=False, compile=False)
    max_len = agent.cfg.get("max_len", 512) if args.mode == "native-diagnostic" else args.max_len
    head_max_len = agent.cfg.get("head_max_len", 192)
    if not 1 <= max_len <= 8192:
        raise SystemExit("requested max_len exceeds pinned encoder context")
    provider_id = f"laya-{args.checkpoint}" + ("-native-diagnostic" if args.mode == "native-diagnostic" else "")
    manifest = {"providerId": provider_id, "sourceRevision": SOURCE_REVISION,
        "runnerSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "parentPlanSha256": payload.get("parentPlanSha256"),
        "repository": repository, "revision": revision, "mode": args.mode,
        "defaultMaxLen": agent.cfg.get("max_len", 512), "maxLen": max_len, "headMaxLen": head_max_len,
        "weightsModified": False, "rawModelId": "laya-rl-agent",
        "versions": {name: importlib.metadata.version(name) for name in ["torch", "transformers", "tokenizers", "safetensors", "huggingface_hub", "laya"]}}
    output = Path(args.output)
    with output.open("x") as stream:
        for trial in payload["trials"]:
            start = time.perf_counter()
            record = {"trialId": trial["id"], "requestSha256": trial["requestSha256"],
                "providerId": provider_id, "provenance": manifest}
            try:
                request = trial["request"]
                proof = context_proof(agent, request, max_len, head_max_len)
                record["contextProof"] = proof
                if not proof["fullContext"] and args.mode == "full-context":
                    record["error"] = "context_preflight_would_modify_or_truncate_input"
                else:
                    record["raw"] = agent.system_one(request["state"], request["questions"],
                        max_len=max_len, head_max_len=head_max_len)
                    record["actualDevice"] = str(agent.device)
            except Exception as error:
                record["error"] = f"inference_failed:{type(error).__name__}"
            record["latencyMs"] = round((time.perf_counter() - start) * 1000, 3)
            stream.write(json.dumps(record, ensure_ascii=False) + "\n")
            stream.flush()


if __name__ == "__main__":
    main()
