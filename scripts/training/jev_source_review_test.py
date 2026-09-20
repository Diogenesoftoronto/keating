"""Source review runner tests use synthetic responses and never contact a provider."""
import json
import os
from pathlib import Path
import subprocess
import sys

import pytest

import jev_source_review as review

MODEL = "jev-2026-09-19"


def fixture(tmp_path, count=1):
    roots = tmp_path / "repo"
    roots.mkdir()
    snapshot = tmp_path / "snapshot"
    snapshot.mkdir(mode=0o700)
    (snapshot / "sources").mkdir(mode=0o700)
    (snapshot / "requests").mkdir(mode=0o700)
    files, requests, authorized = [], [], []
    for index in range(count):
        relative = f"file{index}.py"
        source = f"value = {index}\n"
        raw = source.encode()
        (roots / relative).write_bytes(raw)
        stored = snapshot / "sources" / relative
        stored.write_bytes(raw)
        stored.chmod(0o600)
        identity, sha = f"repo:{relative}", review.digest(raw)
        questions = {"atomic": {"type": "choice", "instructions": "One synthetic property",
                                "criteria": {label: label for label in sorted(review.LABELS)}}}
        state = {"reviewed_file": identity, "source_sha256": sha, "source_excerpt": source,
                 "line_start": "1", "line_end": "1", "total_lines": "1"}
        request = {"model": "judgement", "state": state, "questions": questions}
        body = review.encode(request)
        request_id = review.digest(identity.encode() + b"\0" + b"1\0" + body)
        request_file = f"requests/{request_id}.json"
        (snapshot / request_file).write_bytes(body + b"\n")
        (snapshot / request_file).chmod(0o600)
        record = {"request_id": request_id, "request": request_file, "file": identity,
                  "source_sha256": sha, "line_start": 1, "line_end": 1,
                  "state_bytes": len(review.encode(state)), "questions_bytes": len(review.encode(questions)),
                  "request_bytes": len(body), "question_ids": ["atomic"], "excerpt_sha256": sha}
        requests.append(record)
        files.append({"root": "repo", "file": relative, "identity": identity, "source_sha256": sha,
                      "bytes": len(raw), "total_lines": 1, "snapshot": f"sources/{relative}",
                      "requests": [request_id]})
        authorized.append({"root": "repo", "path": relative})
    allowlist = review.encode({"roots": {"repo": str(roots)}, "files": authorized})
    (tmp_path / "allowlist.json").write_bytes(allowlist)
    manifest = {"schema": "jev-source-review/v2", "status": "prepared-not-executed", "provider_calls": 0,
                "review_results": 0, "source_allowlist": "../allowlist.json",
                "source_allowlist_sha256": review.digest(allowlist), "files": files, "requests": requests}
    (snapshot / "manifest.json").write_bytes(review.encode(manifest))
    return snapshot, roots, tmp_path / "output", manifest


def response(choice="satisfied"):
    return {"model": MODEL, "answers": {"atomic": {"type": "choice", "choice": choice,
            "confidence": 0.7, "probabilities": {label: 0.7 if label == choice else 0.1
                                                   for label in review.LABELS}}}}


def test_dry_run_never_dispatches_and_output_is_private(tmp_path):
    snapshot, _, output, _ = fixture(tmp_path)
    report = review.run_source_review(snapshot, output, MODEL, dispatch=lambda *_: pytest.fail("dispatch"))
    assert report["dispatch_attempts_this_run"] == 0
    assert report["not_executed_questions"] == 1
    assert report["unknown_questions"] == 0
    assert output.stat().st_mode & 0o777 == 0o700
    assert (output / "report.json").stat().st_mode & 0o777 == 0o600
    assert "not evidence" in report["evidence_limit"]


def test_dispatch_failure_stops_batch_and_resume_preserves_unknown(tmp_path):
    snapshot, _, output, _ = fixture(tmp_path, count=3)
    def fail(*_):
        raise review.ReviewError("dispatch-failed")
    report = review.run_source_review(snapshot, output, MODEL, execute=True, dispatch=fail)
    assert report["dispatch_attempts_this_run"] == 1
    assert report["halted_after_failure"] is True
    assert report["unknown_questions"] == 1
    assert report["not_executed_questions"] == 2
    resumed = review.run_source_review(snapshot, output, MODEL, execute=True, resume=True,
                                       dispatch=lambda *_: response())
    assert resumed["dispatch_attempts_this_run"] == 2
    assert resumed["unknown_questions"] == 1
    assert resumed["atomic_verdict_counts"]["satisfied"] == 2


def test_live_two_decimal_rounding_is_preserved_without_normalization(tmp_path):
    snapshot, _, output, manifest = fixture(tmp_path)
    observed = response()
    observed["answers"]["atomic"]["probabilities"] = {
        "satisfied": 0.81, "violated": 0.1, "not_applicable": 0.06, "insufficient_context": 0.02,
    }
    report = review.run_source_review(snapshot, output, MODEL, execute=True, dispatch=lambda *_: observed)
    assert report["unknown_questions"] == 0
    assert report["results"][0]["answers"] == observed["answers"]
    assert report["results"][0]["response"] == observed


def test_smoke_limit_then_resume_calls_only_remaining_and_preserves_distribution(tmp_path):
    snapshot, _, output, _ = fixture(tmp_path, count=2)
    calls = []
    def dispatch(body, timeout):
        calls.append(json.loads(body))
        return response()
    report = review.run_source_review(snapshot, output, MODEL, execute=True, limit=1, dispatch=dispatch)
    assert report["dispatch_attempts_this_run"] == 1 and report["not_executed_questions"] == 1
    receipt = next((output / "receipts").iterdir())
    original = receipt.read_bytes()
    report = review.run_source_review(snapshot, output, MODEL, execute=True, resume=True, dispatch=dispatch)
    assert len(calls) == 2 and report["dispatch_attempts_this_run"] == 1
    assert report["atomic_verdict_counts"]["satisfied"] == 2
    assert report["results"][0]["answers"] == response()["answers"]
    assert report["results"][0]["binding"]["source_sha256"]
    assert report["results"][0]["model"] == MODEL
    assert receipt.read_bytes() == original
    assert receipt.stat().st_mode & 0o777 == 0o600


def test_stale_source_prevents_any_call(tmp_path):
    snapshot, roots, output, _ = fixture(tmp_path)
    (roots / "file0.py").write_text("changed\n")
    with pytest.raises(review.ReviewError, match="source-stale"):
        review.run_source_review(snapshot, output, MODEL, execute=True, dispatch=lambda *_: pytest.fail("dispatch"))


def test_source_changed_during_call_is_unknown_even_if_answers_valid(tmp_path):
    snapshot, roots, output, _ = fixture(tmp_path)
    def dispatch(*_):
        (roots / "file0.py").write_text("changed\n")
        return response()
    report = review.run_source_review(snapshot, output, MODEL, execute=True, dispatch=dispatch)
    assert report["unknown_questions"] == 1
    assert report["atomic_verdict_counts"]["satisfied"] == 0
    assert report["results"][0]["answers"] is None
    assert report["results"][0]["error"] == "source-or-request-changed-during-call"


@pytest.mark.parametrize("model", ["judgement", "jev-latest", "latest", "other-2026"])
def test_actual_model_alias_or_mismatch_rejected(tmp_path, model):
    snapshot, _, output, _ = fixture(tmp_path)
    bad = {**response(), "model": model}
    report = review.run_source_review(snapshot, output, MODEL, execute=True, dispatch=lambda *_: bad)
    assert report["unknown_questions"] == 1
    assert report["results"][0]["error"] == "model-mismatch"
    assert report["results"][0]["answers"] is None


@pytest.mark.parametrize("change", ["missing", "extra", "boolean", "nan", "sum", "wrong-mode"])
def test_malformed_answer_cannot_become_verdict(tmp_path, change):
    snapshot, _, output, _ = fixture(tmp_path)
    bad = response()
    answer = bad["answers"]["atomic"]
    if change == "missing":
        del bad["answers"]["atomic"]
    elif change == "extra":
        answer["probabilities"]["invented"] = 0
    elif change == "boolean":
        answer["probabilities"]["satisfied"] = True
    elif change == "nan":
        answer["confidence"] = float("nan")
    elif change == "sum":
        answer["probabilities"]["satisfied"] = 0.5
    else:
        answer["choice"] = "violated"
    report = review.run_source_review(snapshot, output, MODEL, execute=True, dispatch=lambda *_: bad)
    assert report["unknown_questions"] == 1
    assert report["atomic_verdict_counts"]["satisfied"] == 0


def test_changed_request_rejected_on_resume(tmp_path):
    snapshot, _, output, manifest = fixture(tmp_path)
    review.run_source_review(snapshot, output, MODEL, execute=True, dispatch=lambda *_: response())
    request_path = snapshot / manifest["requests"][0]["request"]
    request = json.loads(request_path.read_bytes())
    request["questions"]["atomic"]["instructions"] = "Different property"
    request_path.write_bytes(review.encode(request))
    with pytest.raises(review.ReviewError, match="request-changed"):
        review.run_source_review(snapshot, output, MODEL, execute=True, resume=True,
                                 dispatch=lambda *_: pytest.fail("dispatch"))


def test_changed_manifest_or_model_rejected_on_resume(tmp_path):
    snapshot, _, output, manifest = fixture(tmp_path)
    review.run_source_review(snapshot, output, MODEL)
    with pytest.raises(review.ReviewError, match="resume-binding-mismatch"):
        review.run_source_review(snapshot, output, "jev-other-version", resume=True)
    manifest["extra_metadata"] = "changed"
    (snapshot / "manifest.json").write_bytes(review.encode(manifest))
    with pytest.raises(review.ReviewError, match="resume-binding-mismatch"):
        review.run_source_review(snapshot, output, MODEL, resume=True)


def test_failed_calls_stay_unknown_and_private_errors_never_persist(tmp_path):
    snapshot, _, output, _ = fixture(tmp_path)
    def fail(*_):
        raise RuntimeError("SECRET upstream body and learner source")
    report = review.run_source_review(snapshot, output, MODEL, execute=True, dispatch=fail)
    assert report["unknown_questions"] == 1
    assert "SECRET" not in (output / "report.json").read_text()
    assert report["results"][0]["error"] == "dispatch-or-validation-failed"
    resumed = review.run_source_review(snapshot, output, MODEL, execute=True, resume=True,
                                       dispatch=lambda *_: pytest.fail("do not retry unknown call"))
    assert resumed["dispatch_attempts_this_run"] == 0 and resumed["unknown_questions"] == 1


def test_public_input_and_output_rejected_before_dispatch(tmp_path):
    snapshot, _, output, manifest = fixture(tmp_path)
    request = snapshot / manifest["requests"][0]["request"]
    request.chmod(0o644)
    with pytest.raises(review.ReviewError, match="input-not-private"):
        review.run_source_review(snapshot, output, MODEL, execute=True)
    request.chmod(0o600)
    output.mkdir(mode=0o755)
    with pytest.raises(review.ReviewError, match="output-not-private"):
        review.run_source_review(snapshot, output, MODEL, execute=True)


def test_dispatch_protocol_bounded_and_stderr_redacted():
    raw = review.dispatch_process([sys.executable, "-c", "import sys;sys.stderr.write('SECRET');print('{}')"], b"{}", 1)
    assert raw == {}
    with pytest.raises(review.ReviewError, match="dispatch-failed"):
        review.dispatch_process([sys.executable, "-c", "import sys;sys.stderr.write('SECRET');sys.exit(1)"], b"{}", 1)
    with pytest.raises(review.ReviewError, match="dispatch-timeout"):
        review.dispatch_process([sys.executable, "-c", "import time;time.sleep(2)"], b"{}", 0.05)
    with pytest.raises(review.ReviewError, match="dispatch-response-too-large"):
        review.dispatch_process([sys.executable, "-c", "print('x'*2100000)"], b"{}", 1)


def test_dispatch_command_cannot_redirect_to_other_provider(tmp_path):
    path = tmp_path / "argv.json"
    path.write_text(json.dumps(["curl", "https://example.invalid"]))
    with pytest.raises(review.ReviewError, match="notorganic-bridge"):
        review.approved_command(path)
    path.write_text(json.dumps(["rtk", "proxy", "bun", "scripts/training/jev_notorganic_dispatch.ts"]))
    assert review.approved_command(path)[-1] == str(review.BRIDGE)


def test_interrupted_receipt_prevents_duplicate_call(tmp_path):
    snapshot, _, output, _ = fixture(tmp_path)
    def interrupt(*_):
        raise KeyboardInterrupt()
    with pytest.raises(KeyboardInterrupt):
        review.run_source_review(snapshot, output, MODEL, execute=True, dispatch=interrupt)
    report = review.run_source_review(snapshot, output, MODEL, execute=True, resume=True,
                                     dispatch=lambda *_: pytest.fail("duplicate side effect"))
    assert report["unknown_questions"] == 1
    assert report["results"][0]["error"] == "interrupted-or-unfinished"


def test_cli_error_never_echoes_source_or_exception(tmp_path):
    snapshot = tmp_path / "SECRET-does-not-exist"
    result = subprocess.run([sys.executable, str(Path(review.__file__)), str(snapshot), "--output",
                             str(tmp_path / "output"), "--model", MODEL], capture_output=True, text=True)
    assert result.returncode == 1 and "SECRET" not in result.stdout + result.stderr
    assert json.loads(result.stdout) == {"error": "review-input-or-io-failed"}
