#!/usr/bin/env python3
"""Execute prepared v2 source reviews through Not Organic, never a direct provider.

Dry-run is the default. Example (a concrete model version is required):
  python scripts/training/jev_source_review.py SNAPSHOT --output RUN --model jev-VERSION
Add --execute --limit 1 for a smoke call, then --execute --resume for remaining requests.
The same manifest and model must be used when resuming. Failed receipts stay unknown;
use a new output directory for an explicitly requested retry. Model verdicts are source
review suggestions, not proof of tests, runtime behavior, calibration, or correctness.
"""
from __future__ import annotations

import argparse
import contextlib
import fcntl
import hashlib
import json
import math
import os
from pathlib import Path
import re
import selectors
import signal
import stat
import subprocess
import tempfile
import time

from benchmark_judge_systemone import decode_answer

LABELS = {"satisfied", "violated", "insufficient_context", "not_applicable"}
SCHEMA = "jev-source-review-run/v1"
REPO = Path(__file__).resolve().parents[2]
BRIDGE = REPO / "scripts/training/jev_notorganic_dispatch.ts"
EVIDENCE_LIMIT = ("Model source-review suggestions only; not evidence that tests passed, "
                  "runtime behavior is correct, probabilities are calibrated, or learning improved.")


class ReviewError(Exception):
    """Only authored, non-sensitive error codes may be exposed."""


def require(condition, code):
    if not condition:
        raise ReviewError(code)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()


def read_json(raw):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, "duplicate-json-key")
            result[key] = value
        return result
    return json.loads(raw, object_pairs_hook=unique,
                      parse_constant=lambda _: (_ for _ in ()).throw(ReviewError("invalid-json-number")))


def contained(base, relative):
    require(isinstance(relative, str) and not Path(relative).is_absolute(), "invalid-relative-path")
    target = (base / relative).resolve()
    require(target.is_relative_to(base.resolve()), "path-escapes-root")
    return target


def private_file(path):
    info = path.stat()
    require(stat.S_ISREG(info.st_mode) and info.st_mode & 0o077 == 0, "input-not-private")


def concrete_model(value):
    return (isinstance(value, str) and bool(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}", value))
            and value not in {"judgement", "jev", "latest"} and not value.endswith("-latest"))


def load_snapshot(snapshot, *, private=False):
    """Reconstruct all files and bind every request byte to its manifest identity."""
    snapshot = snapshot.resolve()
    manifest_path = snapshot / "manifest.json"
    manifest_raw = manifest_path.read_bytes()
    manifest = read_json(manifest_raw)
    require(manifest["schema"] == "jev-source-review/v2", "invalid-manifest-schema")
    require(manifest["status"] == "prepared-not-executed" and manifest["provider_calls"] == 0
            and manifest["review_results"] == 0, "invalid-prepared-manifest")
    # v2 deliberately references the parent staging allowlist.
    allowlist_path = (snapshot / manifest["source_allowlist"]).resolve()
    allowlist_raw = allowlist_path.read_bytes()
    require(digest(allowlist_raw) == manifest["source_allowlist_sha256"], "allowlist-changed")
    allowlist = read_json(allowlist_raw)
    authorized = {(entry["root"], entry["path"]) for entry in allowlist["files"]}
    files = {item["identity"]: item for item in manifest["files"]}
    records = {item["request_id"]: item for item in manifest["requests"]}
    require(len(files) == len(manifest["files"]) and len(records) == len(manifest["requests"])
            and bool(files) and bool(records), "duplicate-or-empty-manifest")
    requests, seen = {}, set()
    for identity, item in files.items():
        require((item["root"], item["file"]) in authorized, "source-not-allowlisted")
        require(identity == item["root"] + ":" + item["file"], "source-identity-mismatch")
        source = contained(Path(allowlist["roots"][item["root"]]), item["file"])
        stored = contained(snapshot, item["snapshot"])
        if private:
            private_file(stored)
        raw = stored.read_bytes()
        require(digest(raw) == item["source_sha256"] and len(raw) == item["bytes"], "snapshot-changed")
        require(digest(source.read_bytes()) == item["source_sha256"], "source-stale")
        lines = raw.decode("utf-8").splitlines(keepends=True) or [""]
        require(len(lines) == item["total_lines"], "source-line-count-mismatch")
        start = 1
        for request_id in item["requests"]:
            require(request_id not in seen and request_id in records, "duplicate-or-missing-request")
            seen.add(request_id)
            record = records[request_id]
            request_path = contained(snapshot, record["request"])
            if private:
                private_file(request_path)
            body = request_path.read_bytes().removesuffix(b"\n")
            require(digest(identity.encode() + b"\0" + str(start).encode() + b"\0" + body) == request_id,
                    "request-changed")
            request = read_json(body)
            state, questions = request["state"], request["questions"]
            end = record["line_end"]
            require(type(end) is int and start <= end <= len(lines), "invalid-excerpt-range")
            require(record["line_start"] == start and state["line_start"] == str(start)
                    and state["line_end"] == str(end) and state["total_lines"] == str(len(lines)),
                    "excerpt-range-mismatch")
            require(record["file"] == state["reviewed_file"] == identity and
                    record["source_sha256"] == state["source_sha256"] == item["source_sha256"],
                    "request-source-mismatch")
            excerpt = "".join(lines[start - 1:end])
            require(state["source_excerpt"] == excerpt and digest(excerpt.encode()) == record["excerpt_sha256"],
                    "excerpt-mismatch")
            require(request["model"] == "judgement" and all(isinstance(v, str) for v in state.values()),
                    "invalid-request-state")
            require(isinstance(questions, dict) and 0 < len(questions) <= 64
                    and list(questions) == record["question_ids"], "invalid-question-ids")
            for question in questions.values():
                require(question["type"] == "choice" and set(question["criteria"]) == LABELS
                        and isinstance(question["instructions"], str)
                        and all(isinstance(v, str) for v in question["criteria"].values()), "invalid-review-question")
            for key in ("state", "questions"):
                require(len(encode(request[key])) == record[key + "_bytes"] <= 90_000, "request-part-too-large")
            require(len(body) == record["request_bytes"] <= 240_000, "request-too-large")
            requests[request_id] = {"record": record, "request": request, "body": body,
                                    "request_sha256": digest(body), "source": source,
                                    "request_path": request_path, "snapshot_path": stored}
            start = end + 1
        require(start == len(lines) + 1, "incomplete-source-coverage")
    require(seen == set(records), "orphan-request")
    return {"manifest": manifest, "manifest_sha256": digest(manifest_raw), "requests": requests,
            "manifest_path": manifest_path, "allowlist_path": allowlist_path,
            "allowlist_sha256": digest(allowlist_raw)}


def fresh(snapshot, request, *, private):
    require(digest(snapshot["manifest_path"].read_bytes()) == snapshot["manifest_sha256"], "manifest-changed")
    require(digest(snapshot["allowlist_path"].read_bytes()) == snapshot["allowlist_sha256"], "allowlist-changed")
    require(digest(request["source"].read_bytes()) == request["record"]["source_sha256"], "source-stale")
    require(digest(request["snapshot_path"].read_bytes()) == request["record"]["source_sha256"], "snapshot-changed")
    if private:
        private_file(request["request_path"])
        private_file(request["snapshot_path"])
    require(digest(request["request_path"].read_bytes().removesuffix(b"\n")) == request["request_sha256"],
            "request-changed")


def decode_review(request, response, expected_model):
    require(isinstance(response, dict) and not response.get("error"), "invalid-response")
    actual = response.get("model")
    require(concrete_model(actual) and actual == expected_model, "model-mismatch")
    body = response.get("answers")
    require(isinstance(body, dict) and set(body) == set(request["questions"]), "answer-set-mismatch")
    decoded = {}
    for key, question in request["questions"].items():
        answer = decode_answer(question, body[key])
        require(answer is not None, "malformed-answer")
        probabilities = answer["probabilities"]
        # Live Jev returns probabilities rounded to two decimal places. Preserve
        # those values; allow only the corresponding total rounding error.
        rounded = all(math.isclose(value, round(value, 2), abs_tol=1e-9) for value in probabilities.values())
        tolerance = 0.005 * len(probabilities) + 1e-9 if rounded else 1e-6
        require(set(probabilities) == LABELS and math.isclose(sum(probabilities.values()), 1, abs_tol=tolerance),
                "invalid-distribution")
        require(probabilities[answer["choice"]] == max(probabilities.values()), "choice-not-mode")
        decoded[key] = answer
    return decoded


def approved_command(path=None):
    argv = read_json(path.read_bytes()) if path else ["bun", str(BRIDGE)]
    require(isinstance(argv, list) and all(isinstance(x, str) for x in argv), "invalid-dispatch-command")
    prefix, script = argv[:-1], argv[-1] if argv else ""
    require(prefix in (["bun"], ["rtk", "proxy", "bun"]) and
            (REPO / script).resolve() == BRIDGE, "dispatch-must-use-notorganic-bridge")
    return [*prefix, str(BRIDGE)]


def dispatch_process(argv, body, timeout):
    """Bound stdout and elapsed time; discard stderr, never echo upstream diagnostics."""
    with tempfile.TemporaryFile() as stdin:
        stdin.write(body)
        stdin.seek(0)
        process = subprocess.Popen(argv, cwd=REPO, stdin=stdin, stdout=subprocess.PIPE,
                                   stderr=subprocess.DEVNULL, start_new_session=True)
        try:
            deadline, output = time.monotonic() + timeout, bytearray()
            with selectors.DefaultSelector() as selector:
                selector.register(process.stdout, selectors.EVENT_READ)
                while selector.get_map():
                    remaining = deadline - time.monotonic()
                    require(remaining > 0, "dispatch-timeout")
                    for key, _ in selector.select(min(remaining, 0.2)):
                        chunk = os.read(key.fileobj.fileno(), 65_536)
                        if not chunk:
                            selector.unregister(key.fileobj)
                        else:
                            output.extend(chunk)
                            require(len(output) <= 2_000_000, "dispatch-response-too-large")
                try:
                    code = process.wait(timeout=max(0.001, deadline - time.monotonic()))
                except subprocess.TimeoutExpired:
                    raise ReviewError("dispatch-timeout") from None
            require(code == 0, "dispatch-failed")
            return read_json(bytes(output))
        finally:
            # Also terminate descendants which outlive the dispatcher.
            with contextlib.suppress(ProcessLookupError):
                os.killpg(process.pid, signal.SIGKILL)
            process.wait()
            process.stdout.close()


def write_private(path, value):
    fd, temporary = tempfile.mkstemp(prefix=".review-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(encode(value) + b"\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(temporary)


def binding(snapshot, item, model):
    return {"manifest_sha256": snapshot["manifest_sha256"], "request_id": item["record"]["request_id"],
            "request_sha256": item["request_sha256"], "file": item["record"]["file"],
            "source_sha256": item["record"]["source_sha256"], "expected_model": model}


def run_source_review(snapshot_path, output, model, *, execute=False, resume=False, limit=None,
                      timeout=40, dispatch=None):
    require(concrete_model(model), "concrete-model-required")
    require(type(timeout) in (int, float) and math.isfinite(timeout) and 0 < timeout <= 120, "invalid-timeout")
    require(limit is None or type(limit) is int and limit > 0, "invalid-limit")
    snapshot = load_snapshot(snapshot_path, private=execute)
    require(not output.is_symlink(), "output-symlink-forbidden")
    output.mkdir(mode=0o700, parents=True, exist_ok=True)
    require(output.stat().st_mode & 0o077 == 0, "output-not-private")
    # Nonblocking OS lock prevents concurrent duplicate calls, released on process exit.
    fd = os.open(output / "run.lock", os.O_CREAT | os.O_RDWR | os.O_NOFOLLOW, 0o600)
    try:
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ReviewError("review-already-running") from None
        descriptor = {"schema": SCHEMA, "manifest_sha256": snapshot["manifest_sha256"], "model": model}
        state_path = output / "run.json"
        if state_path.exists():
            require(resume, "existing-run-requires-resume")
            private_file(state_path)
            require(read_json(state_path.read_bytes()) == descriptor, "resume-binding-mismatch")
        else:
            require(not any(p.name != "run.lock" for p in output.iterdir()), "output-not-empty")
            write_private(state_path, descriptor)
        receipts = output / "receipts"
        receipts.mkdir(mode=0o700, exist_ok=True)
        require(not receipts.is_symlink() and receipts.stat().st_mode & 0o077 == 0, "receipts-not-private")
        calls, results, halted = 0, [], False
        for item in snapshot["requests"].values():
            path = receipts / (item["record"]["request_id"] + ".json")
            expected = binding(snapshot, item, model)
            fresh(snapshot, item, private=execute)
            if path.exists():
                require(resume, "existing-receipt-requires-resume")
                private_file(path)
                receipt = read_json(path.read_bytes())
                require(receipt.get("binding") == expected, "resume-receipt-mismatch")
                if receipt.get("status") == "reviewed":
                    decode_review(item["request"], {"model": receipt.get("model"),
                                  "answers": receipt.get("answers")}, model)
                else:
                    require(receipt.get("status") == "unknown" and receipt.get("answers") is None,
                            "invalid-failure-receipt")
            elif not execute or halted or limit is not None and calls >= limit:
                receipt = {"binding": expected, "status": "not-executed", "answers": None}
            else:
                calls += 1
                started = time.monotonic()
                receipt = {"schema": SCHEMA, "binding": expected, "status": "unknown", "answers": None,
                           "model": None, "error": None}
                # Persist intent before the side effect. Interrupted calls are unknown and
                # never automatically repeated (the bridge has its own idempotency key).
                write_private(path, {**receipt, "error": "interrupted-or-unfinished"})
                try:
                    response = dispatch(item["body"], timeout) if dispatch else dispatch_process(
                        approved_command(), item["body"], timeout)
                    # Keep the private response even if later validation fails;
                    # usage and received answers must not disappear from audit.
                    try:
                        receipt["response"] = read_json(encode(response))
                    except Exception:
                        receipt["response_capture_error"] = "not-json-serializable"
                    answers = decode_review(item["request"], response, model)
                    fresh(snapshot, item, private=True)
                    receipt.update(status="reviewed", model=model, answers=answers)
                except Exception as error:
                    receipt["error"] = str(error) if isinstance(error, ReviewError) else "dispatch-or-validation-failed"
                    # Account capabilities are short-lived. One failed dispatch
                    # stops this batch; never consume every remaining request
                    # with the same unavailable account or provider.
                    halted = True
                    # Freshness must be checked even when dispatch or decoding failed.
                    try:
                        fresh(snapshot, item, private=True)
                    except Exception:
                        receipt["error"] = "source-or-request-changed-during-call"
                receipt["elapsed_seconds"] = time.monotonic() - started
                write_private(path, receipt)
            results.append({**receipt, "line_start": item["record"]["line_start"],
                            "line_end": item["record"]["line_end"],
                            "question_ids": item["record"]["question_ids"]})
        counts = {label: 0 for label in LABELS}
        unknown, pending = 0, 0
        for item in results:
            if item["status"] == "reviewed":
                for answer in item["answers"].values():
                    counts[answer["choice"]] += 1
            elif item["status"] == "unknown":
                unknown += len(item["question_ids"])
            else:
                pending += len(item["question_ids"])
        report = {**descriptor, "evidence_limit": EVIDENCE_LIMIT, "dispatch_attempts_this_run": calls,
                  "halted_after_failure": halted,
                  "atomic_verdict_counts": counts, "unknown_questions": unknown,
                  "not_executed_questions": pending, "results": results}
        write_private(output / "report.json", report)
        return report
    finally:
        os.close(fd)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("snapshot", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--model", required=True, help="Expected concrete model version; aliases rejected")
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--resume", action="store_true")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--timeout", type=float, default=40)
    parser.add_argument("--dispatch-command", type=Path, help="JSON argv for the existing Not Organic bridge")
    args = parser.parse_args()
    try:
        argv = approved_command(args.dispatch_command)
        report = run_source_review(args.snapshot, args.output, args.model, execute=args.execute,
                                   resume=args.resume, limit=args.limit, timeout=args.timeout,
                                   dispatch=lambda body, timeout: dispatch_process(argv, body, timeout))
        print(json.dumps({key: report[key] for key in ("dispatch_attempts_this_run", "atomic_verdict_counts",
                                                      "unknown_questions", "not_executed_questions")}))
        return 1 if report["unknown_questions"] else 0
    except Exception as error:
        print(json.dumps({"error": str(error) if isinstance(error, ReviewError) else "review-input-or-io-failed"}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
