#!/usr/bin/env python3
"""Token-only Laya preflight; no weights, GPU, inference, or text rewriting.

Build state-only previews from catalog bindings, retaining every original
question and gold label. Compare finalized builder output when --localized-plan is
provided. Load Agent with __new__ and use the existing runner's context_proof.
Only pinned tokenizer/config metadata may be fetched; model weights never are.
"""
import argparse
from collections import Counter
import copy
import hashlib
import importlib.metadata
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import urllib.request

SOURCE_REVISION = "970dc8c5f63d7b886a68409493f37d569424f933"
LANGUAGES = ["en", "es", "fr", "ar", "hi", "zh-Hans"]
VARIANTS = [
    ("laya-english", "laya", "55cf4c4ebb4ebe31b2550e8bdf3bd21b99753851"),
    ("laya-multilingual", "laya-multilingual", "e4e9ddf21a7b1903b7acffd8814ad4307bf63a67"),
    ("laya-typed-decisions", "laya-typed-decisions", "1a793eb568e6718f15941d08f85432581df534e3"),
]


def read(path):
    return json.loads(Path(path).read_text())


def digest_file(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def write_private(path, value):
    with os.fdopen(os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w") as handle:
        json.dump(value, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def preview_trials(plan, catalog, translations_dir, condition="state-only"):
    if condition not in ("state-only", "state-and-evidence-descriptions"):
        raise ValueError("unknown-condition")
    if catalog["parentPlanSha256"] != plan["sha256"]:
        raise ValueError("catalog-parent-mismatch")
    entries = {e["id"]: e["english"] for e in catalog["translatorInput"]["entries"]}
    original = {t["id"]: t for t in plan["trials"]}
    output, reviews = [], {}
    for language in LANGUAGES:
        if language == "en":
            texts = entries
            reviews[language] = {"status": "original-English-control"}
        else:
            path = Path(translations_dir) / (language + ".json")
            translation = read(path)
            texts = translation["translations"]
            if not isinstance(texts, dict) or set(texts) != set(entries) or any(not isinstance(v, str) for v in texts.values()):
                raise ValueError("translation-entry-mismatch")
            reviews[language] = {"status": translation.get("reviewStatus"), "sha256": digest_file(path)}
        trials = {key: copy.deepcopy(t) for key, t in original.items()}
        for binding in catalog["stateBindings"]:
            state = trials[binding["trialId"]]["request"]["state"]
            path = binding["path"]
            text = "".join(texts[s["entryId"]] if "entryId" in s else s["literal"] for s in binding["segments"])
            if not path:
                trials[binding["trialId"]]["request"]["state"] = text
            else:
                for key in path[:-1]:
                    state = state[key]
                state[path[-1]] = text
        for binding in (catalog["evidenceBindings"] if condition == "state-and-evidence-descriptions" else []):
            # English sentence keys remain unchanged. Every condition, including
            # English, gets its localized sentence as the criterion description.
            criteria = trials[binding["trialId"]]["request"]["questions"][binding["questionId"]]["criteria"]
            criteria[binding["sourceKey"]] = texts[binding["entryId"]]
        for original_id, trial in trials.items():
            before = original[original_id]
            if condition == "state-only" and trial["request"]["questions"] != before["request"]["questions"]:
                raise ValueError("original-question-changed")
            if language == "en" and condition == "state-only" and trial["request"] != before["request"]:
                raise ValueError("English-control-request-changed")
            if trial.get("expected") != before.get("expected") or trial.get("fullExpected") != before.get("fullExpected"):
                raise ValueError("gold-label-changed")
            for qid, question in trial["request"]["questions"].items():
                old = before["request"]["questions"][qid]
                if question["type"] == "choice" and list(question["criteria"]) != list(old["criteria"]):
                    raise ValueError("choice-key-changed")
            output.append({"id": language + "/" + original_id, "language": language, "originalTrialId": original_id,
                           "request": trial["request"], "expected": trial.get("expected"), "fullExpected": trial.get("fullExpected")})
    return output, reviews


def compare_final(previews, localized):
    def signature(t):
        return canonical({"request": t["request"], "expected": t.get("expected"), "fullExpected": t.get("fullExpected")})
    expected, actual = Counter(map(signature, previews)), Counter(map(signature, localized["trials"]))
    if expected != actual:
        raise ValueError("final-builder-requests-or-labels-differ-from-preview")
    return {"matchedTrials": sum(actual.values()), "requestsAndGoldUnchanged": True}


class CachedTokenizer:
    """Memoize identical tokenization across the three length-limit audits."""
    def __init__(self, tokenizer):
        self.tokenizer, self.cache = tokenizer, {}

    def __getattr__(self, name):
        return getattr(self.tokenizer, name)

    def __call__(self, text, **kwargs):
        key = (text, canonical(kwargs))
        if key not in self.cache:
            self.cache[key] = self.tokenizer(text, **kwargs)
        return self.cache[key]


def pinned_metadata(repo, revision, path):
    url = "https://huggingface.co/convaiinnovations/" + repo + "/resolve/" + revision + "/" + path
    with urllib.request.urlopen(url, timeout=30) as response:
        return json.load(response)


def verify_tokenizer(source, repo, revision):
    path = source / (repo + "-tokenizer.json")
    url = "https://huggingface.co/api/models/convaiinnovations/" + repo + "/tree/" + revision + "/tokenizer"
    with urllib.request.urlopen(url, timeout=30) as response:
        files = json.load(response)
    info = next(row for row in files if row["path"] == "tokenizer/tokenizer.json")
    data = path.read_bytes()
    lfs_sha = info.get("lfs", {}).get("oid")
    # Small tokenizer JSONs are Git blobs; large ones use LFS SHA256 objects.
    actual = hashlib.sha256(data).hexdigest() if lfs_sha else hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
    if actual != (lfs_sha or info.get("oid")):
        raise ValueError("cached-tokenizer-hash-mismatch")
    return path, hashlib.sha256(data).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", required=True)
    parser.add_argument("--catalog", required=True)
    parser.add_argument("--translations-dir", required=True)
    parser.add_argument("--source", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--localized-plan")
    parser.add_argument("--condition", choices=("state-only", "state-and-evidence-descriptions"), default="state-only",
                        help="Evidence-description mode reproduces abandoned preparation only")
    args = parser.parse_args()
    os.environ["CUDA_VISIBLE_DEVICES"] = ""
    os.environ["TOKENIZERS_PARALLELISM"] = "false"
    source = Path(args.source).resolve()
    if subprocess.check_output(["git", "-C", str(source), "rev-parse", "HEAD"], text=True).strip() != SOURCE_REVISION:
        raise ValueError("source-revision-mismatch")
    subprocess.run(["git", "-C", str(source), "diff", "--quiet", "HEAD", "--", "laya"], check=True)
    sys.path.insert(0, str(source))
    from laya.agent import Agent
    from laya.common import render_options
    from transformers import PreTrainedTokenizerFast
    import laya
    if not Path(laya.__file__).resolve().is_relative_to(source):
        raise ValueError("imported-source-mismatch")
    runner_path = Path(__file__).with_name("laya-inference.py")
    spec = importlib.util.spec_from_file_location("laya_benchmark_runner", runner_path)
    runner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(runner)
    plan, catalog = read(args.plan), read(args.catalog)
    trials, reviews = preview_trials(plan, catalog, args.translations_dir, args.condition)
    final = compare_final(trials, read(args.localized_plan)) if args.localized_plan else None
    results, tokenizers = [], {}
    for provider, repo, revision in VARIANTS:
        tokenizer_path, tokenizer_hash = verify_tokenizer(source, repo, revision)
        config = pinned_metadata(repo, revision, "tokenizer/tokenizer_config.json")
        agent_config = pinned_metadata(repo, revision, "rl_agent_config.json")
        tok = CachedTokenizer(PreTrainedTokenizerFast(tokenizer_file=str(tokenizer_path), **config))
        agent = Agent.__new__(Agent)  # Never calls __init__, torch.load, or model.from_pretrained.
        agent.tok, agent.cfg = tok, agent_config
        head_max_len = agent_config.get("head_max_len", 192)
        tokenizers[provider] = {"repository": "convaiinnovations/" + repo, "revision": revision,
                               "tokenizerSha256": tokenizer_hash, "tokenizerConfig": config,
                               "agentConfig": agent_config}
        for language in LANGUAGES:
            selected = [trial for trial in trials if trial["language"] == language]
            for max_len in (1024, 2048, 8192):
                failures, counts = [], Counter()
                max_state = max_unclipped = max_option = max_head = 0
                for trial in selected:
                    proof = runner.context_proof(agent, trial["request"], max_len, head_max_len)
                    counts["trials"] += 1
                    counts["questionRows"] += proof["questionCount"]
                    counts["failedTrials"] += not proof["fullContext"]
                    for row in proof["questions"]:
                        q = agent._to_internal(trial["request"]["questions"][row["question"]])
                        ins = tok(f'{q["t"]} question: {q["ins"]}'.replace(tok.mask_token, " "), add_special_tokens=False)["input_ids"]
                        options = render_options(q)
                        option_lengths = [len(tok(" " + text.replace(tok.mask_token, " "), add_special_tokens=False)["input_ids"]) for text in options]
                        head_total = len(ins) + sum(n + 1 for n in option_lengths)
                        max_state = max(max_state, row["stateTokens"])
                        max_unclipped = max(max_unclipped, row["unclippedTokens"])
                        max_option = max(max_option, row["maxOptionTokens"])
                        max_head = max(max_head, head_total)
                        counts["optionOver48Rows"] += row["maxOptionTokens"] > 48
                        counts["headBudgetExceededRows"] += head_total > head_max_len
                        counts["sequenceOverLimitRows"] += row["unclippedTokens"] > max_len
                        counts["literalMaskRows"] += row["literalMaskReplaced"]
                        if not row["fullContext"]:
                            failures.append({"originalTrialId": trial["originalTrialId"], **row,
                                             "instructionTokens": len(ins), "optionTokens": option_lengths,
                                             "unclippedHeadTokens": head_total})
                results.append({"providerId": provider, "language": language, "maxLen": max_len,
                                "headMaxLen": head_max_len, **dict(counts), "failedQuestionRows": len(failures),
                                "maxStateTokens": max_state, "maxUnclippedTokens": max_unclipped,
                                "maxOptionTokens": max_option, "maxHeadTokens": max_head,
                                "allFit": not failures, "failures": failures})
                print(json.dumps({k: v for k, v in results[-1].items() if k != "failures"}), flush=True)
    result = {"schemaVersion": 1, "parentPlanSha256": plan["sha256"], "sourceRevision": SOURCE_REVISION,
              "planFileSha256": digest_file(args.plan), "catalogFileSha256": digest_file(args.catalog),
              "runnerSha256": digest_file(runner_path), "preflightSha256": digest_file(__file__),
              "translationReviews": reviews, "finalBuilderComparison": final,
              "weightsLoaded": False, "modelCalls": 0, "gpuUsed": False,
              "condition": args.condition, "originalQuestionsUnchanged": args.condition == "state-only",
              "EnglishControlRequestUnchanged": args.condition == "state-only",
              "originalCriteriaKeysPreserved": True, "originalExpectedLabelsPreserved": True,
              "versions": {p: importlib.metadata.version(p) for p in ("torch", "transformers", "tokenizers")},
              "tokenizers": tokenizers, "results": results}
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    write_private(output, result)


if __name__ == "__main__":
    main()
