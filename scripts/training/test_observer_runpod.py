"""Authored REST/SSH protocol fixtures; no cloud request, weights or paid work."""
import copy
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import time
import os
import unittest
import urllib.error
from unittest.mock import patch

import observer_runpod as manager


def projection():
    return {"record_id": "real-id-local-only", "family_id": "person-local-only",
            "group_ids": ["person-local-only"], "source": "authored_protocol_fixture",
            "boundary": "delivered", "latest_allowed_event_id": "answer",
            "labels": {"concept": None}, "label_provenance": {"concept": "unknown"},
            "events": [{"event_id": "question", "phase": "pre_action", "visibility": "public",
                        "kind": "learner_message", "text": "Hint please."},
                       {"event_id": "private", "phase": "pre_action", "visibility": "private",
                        "text": "PRIVATE_RUBRIC"},
                       {"event_id": "answer", "phase": "delivered", "visibility": "public",
                        "kind": "actor_message", "text": "Try equal units.", "internal": "SECRET_METADATA"},
                       {"event_id": "later", "phase": "retrospective", "visibility": "public",
                        "kind": "learner_message", "text": "FUTURE_RESPONSE"}],
            "spans": [{"event_id": "answer", "start": 0, "end": 16}]}


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now

    def sleep(self, seconds):
        self.now += seconds


class FakeAPI:
    def __init__(self):
        self.calls, self.pods = [], []
        self.lose_create_response = False
        self.rate = 1.09

    def call(self, method, path, data=None, *, timeout=20):
        self.calls.append((method, path, copy.deepcopy(data)))
        if path.startswith("/catalog/gpus/"):
            return {"id": manager.GPU, "memory": 48, "secure": True,
                    "price": {"secure": self.rate}, "availability": "MEDIUM"}
        if method == "GET" and path == "/pods":
            return {"pods": copy.deepcopy(self.pods)}
        if method == "POST" and path == "/pods":
            pod = {**copy.deepcopy(data), "id": "owned123", "status": "RUNNING", "cost": self.rate,
                   "ssh": {"direct": {"host": "192.0.2.1", "port": 22001, "username": "root"}}}
            self.pods.append(pod)
            if self.lose_create_response:
                raise TimeoutError("Lost response after accepted creation")
            return copy.deepcopy(pod)
        if path == "/pods/owned123" and method == "GET":
            return copy.deepcopy(self.pods[0])
        if path == "/pods/owned123/action" and data == {"action": "stop"}:
            self.pods[0]["status"] = "EXITED"
            self.pods[0]["cost"] = 0
            return copy.deepcopy(self.pods[0])
        if path == "/pods/owned123" and method == "DELETE":
            self.pods[0]["status"] = "TERMINATED"
            return None
        raise AssertionError((method, path, data))


class RunpodTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="observer-runpod-test-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / "projection.json"
        self.source.write_text(json.dumps({"records": [projection()]}))
        self.public = self.root / "dedicated.pub"
        self.public.write_text("ssh-ed25519 AAAABBBB personal-comment\n")
        self.api, self.clock = FakeAPI(), Clock()
        self.quote = self.root / "quote.json"
        self.quote.write_text(json.dumps(manager.quote(self.api, self.clock())))
        self.directory = self.root / "job"
        manager.prepare(self.source, self.quote, self.directory, "5", "2", "1.20", self.public)
        self.job = manager.Job(self.directory, self.api, clock=self.clock, sleep=self.clock.sleep)
        self.api.calls.clear()

    def create(self):
        self.job.create(self.job.state["plan_sha256"])

    def test_execution_root_keeps_packages_local_and_legacy_paths_resumable(self):
        key = self.root / "test-key"
        key.write_text("authored fixture; never used for SSH")
        pod = {"ssh": {"direct": {"username": "root", "host": "127.0.0.1", "port": 22}}}
        suffix = "observer-" + self.job.plan["job_id"]
        with patch.dict(os.environ, {"OBSERVER_SSH_PRIVATE_KEY": str(key)}):
            self.assertEqual(manager.SSH(self.job, pod).root, "/tmp/" + suffix)
            self.job.plan.pop("execution_root")
            self.assertEqual(manager.SSH(self.job, pod).root, "/workspace/" + suffix)
            self.job.plan["execution_root"] = "/tmp/another-job"
            with self.assertRaisesRegex(ValueError, "bound to this job"):
                manager.SSH(self.job, pod)

    def export(self, failure=True):
        files = {"extract.log": b"AUTHORED_PROTOCOL_FIXTURE: no GPU was used\n"}
        if not failure:
            manifest = {"evidence": "model_extraction", "observer_revision": manager.MODEL_REVISION,
                        "tokenizer_revision": manager.MODEL_REVISION, "sae_revision": manager.SAE_REVISION,
                        "sae_sha256": manager.SAE_HASH, "module": "language_model.layers.12", "layer": 12,
                        "dtype": "bfloat16", "device": "cuda", "max_tokens": manager.MAX_TOKENS,
                        "observer_model": "Qwen/Qwen3.5-9B-Base", "tokenizer_model": "Qwen/Qwen3.5-9B-Base",
                        "sae_model": "Qwen/SAE-Res-Qwen3.5-9B-Base-W64K-L0_50", "sae_file": "layer12.sae.pt",
                        "hook": "residual_post_block", "truncation": False,
                        "dimensions": {"hidden": 4096, "width": 65536, "top_k": 50},
                        "encoding": "affine_then_signed_topk_no_relu_no_centering",
                        "model_files_sha256": {"authored-protocol-fixture": "a" * 64},
                        "tokenizer_files_sha256": {"authored-protocol-fixture": "b" * 64},
                        "software": {"torch": "2.8.0+cu128", "transformers": "5.3.0", "numpy": "2.2.6"},
                        "implementation_files_sha256": {name: self.job.plan["bundle_files_sha256"][
                            "scripts/training/" + name] for name in manager.SOURCE_NAMES}}
            rows = [{"record_id": row["record_id"], "record_sha256": manager.digest(row),
                     "observer_manifest_sha256": manager.digest(manifest), "view": manager.boundary_view(row),
                     "family_id": row["family_id"], "boundary": row["boundary"],
                     "text": manager.boundary_view(row)["text"], "sae_width": 65536, "raw": [0.] * 4096,
                     "input_token_ids": [1], "selected_token_indices": [0], "sae": {"0": 0.},
                     "sparse_tokens": [{"token_index": 0, "indices": list(range(50)), "values": [0.] * 50}]}
                    for row in json.loads(self.job.files["input.json"])["records"]]
            result = {"manifest": manifest, "manifest_sha256": manager.digest(manifest),
                      "input_sha256": self.job.plan["uploaded_input_sha256"], "rows": rows}
            files["features.json"] = manager.canonical(result).encode()
        receipt = {"exit_code": 1 if failure else 0, "files": {k: manager.sha(v) for k, v in files.items()}}
        files["receipt.json"] = json.dumps(receipt).encode()
        return manager.archive_bytes(files)

    def test_upload_allowlist_excludes_private_future_metadata_keys_and_original_ids(self):
        files = manager.read_archive(self.job.body, set(self.job.files), 8 * manager.MAX_INPUT)
        self.assertEqual(set(files), {"bundle.json", "run.py", "input.json",
            "scripts/training/observer_core.py", "scripts/training/observer_extract.py",
            "scripts/training/observer_models.py"})
        uploaded = files["input.json"].decode()
        for secret in ("PRIVATE_RUBRIC", "SECRET_METADATA", "FUTURE_RESPONSE", "labels",
                       "person-local-only", "real-id-local-only", "personal-comment"):
            self.assertNotIn(secret, uploaded)
        self.assertIn("Try equal units.", uploaded)
        local = next(iter(self.job.join.values()))
        self.assertIsNone(local["labels"]["concept"])
        self.assertIn("Try equal units.", manager.boundary_view(json.loads(uploaded)["records"][0])["text"])

    def test_exact_archive_and_join_pins_reject_mutation(self):
        with (self.directory / "payload.tar").open("ab") as out:
            out.write(b"changed")
        with self.assertRaisesRegex(ValueError, "archive changed"):
            manager.Job(self.directory, self.api)

    def test_manager_source_drift_blocks_loading_approved_job(self):
        changed = self.root / "different_manager.py"
        changed.write_text("# Changed cleanup or budget guards\n")
        with patch.object(manager, "__file__", str(changed)), self.assertRaisesRegex(ValueError, "Supervisor source changed"):
            manager.Job(self.directory, self.api)
        self.assertEqual(self.api.calls, [])

    def test_prepared_request_matches_single_post_and_contains_no_credentials(self):
        expected = json.loads((self.directory / "request.json").read_text())
        self.assertEqual(expected["gpu"]["id"], "NVIDIA L40S")
        self.create()
        sent = [data for method, path, data in self.api.calls if method == "POST" and path == "/pods"]
        self.assertEqual(sent, [expected])
        self.assertEqual(set(expected["env"]), {"PUBLIC_KEY", "OBSERVER_JOB_SHA256"})
        expected["disk"] = 1000
        (self.directory / "request.json").write_text(json.dumps(expected))
        with self.assertRaisesRegex(ValueError, "request changed"):
            manager.Job(self.directory, self.api)

    def test_unmapped_boundary_and_empty_pack_are_rejected_without_upload(self):
        row = projection()
        row["spans"][0]["event_id"] = "later"
        with self.assertRaises(ValueError):
            manager.project_input(json.dumps({"records": [row]}).encode())
        with self.assertRaises(ValueError):
            manager.project_input(b'{"records":[]}')

    def test_tar_rejects_traversal_symlink_duplicate_and_oversize(self):
        for names, kind in [(["../input.json"], tarfile.REGTYPE), (["input.json"], tarfile.SYMTYPE),
                            (["input.json", "input.json"], tarfile.REGTYPE)]:
            buffer = io.BytesIO()
            with tarfile.open(fileobj=buffer, mode="w") as archive:
                for name in names:
                    info = tarfile.TarInfo(name); info.type = kind; info.linkname = "/etc/passwd"
                    archive.addfile(info)
            with self.subTest(names=names, kind=kind), self.assertRaises(ValueError):
                manager.read_archive(buffer.getvalue(), {"input.json"}, 100000)
        with self.assertRaises(ValueError):
            manager.read_archive(self.job.body, set(self.job.files), 100)

    def test_prepare_rejects_nonfinite_negative_and_insufficient_caps(self):
        for cost, hours, rate in [("NaN", "2", "1.20"), ("5", "Infinity", "1.20"),
                                  ("5", "-1", "1.20"), ("5", "3", "1.20"),
                                  ("1", "2", "1.20"), ("5", "2", ".10")]:
            with self.subTest(limits=(cost, hours, rate)), self.assertRaises(ValueError):
                manager.prepare(self.source, self.quote, self.root / "bad", cost, hours, rate, self.public)

    def test_confirmation_required_before_any_remote_request(self):
        with self.assertRaises(ValueError):
            self.job.create("wrong-hash")
        self.assertEqual(self.api.calls, [])

    def test_live_quote_expiry_and_price_change_prevent_creation(self):
        self.clock.now += manager.QUOTE_TTL + 1
        with self.assertRaisesRegex(ValueError, "expired"):
            self.create()
        self.assertEqual(self.api.calls, [])
        self.clock.now = 1000
        self.api.rate = 1.20
        with self.assertRaisesRegex(ValueError, "hourly cap"):
            self.create()
        self.assertNotIn("POST", [c[0] for c in self.api.calls])

    def test_draft_requires_fresh_quote_and_public_key(self):
        draft_dir = self.root / "draft"
        manager.prepare(self.source, self.quote, draft_dir, "5", "2", "1.20")
        draft = manager.Job(draft_dir, self.api, clock=self.clock)
        with self.assertRaisesRegex(ValueError, "Draft"):
            draft.create(draft.state["plan_sha256"])
        self.assertEqual(self.api.calls, [])

    def test_single_creation_journal_precedes_request_and_lost_reply_reconciles(self):
        original = self.api.call
        def inspect(method, path, data=None, **kwargs):
            if method == "POST" and path == "/pods":
                saved = json.loads((self.directory / "state.json").read_text())
                self.assertEqual(saved["phase"], "creation_uncertain")
                self.assertEqual(saved["create_attempted_at"], 1000)
            return original(method, path, data, **kwargs)
        self.api.call = inspect
        self.api.lose_create_response = True
        with self.assertRaises(TimeoutError):
            self.create()
        resumed = manager.Job(self.directory, self.api, clock=self.clock)
        with self.assertRaisesRegex(ValueError, "already attempted"):
            resumed.create(resumed.state["plan_sha256"])
        resumed.reconcile()
        self.assertEqual(resumed.state["pod_id"], "owned123")
        self.assertEqual(sum(m == "POST" and p == "/pods" for m, p, _ in self.api.calls), 1)
        self.clock.now += 100
        self.assertEqual(resumed.remaining(), 7100)

    def test_uncertain_empty_or_ambiguous_inventory_never_creates(self):
        self.job.save(phase="creation_uncertain", create_attempted_at=1000)
        with self.assertRaises(ValueError):
            self.job.reconcile()
        self.assertEqual([c[:2] for c in self.api.calls], [("GET", "/pods")])
        matching = {"name": self.job.plan["pod_name"], "id": "owned123", "gpu": {"id": manager.GPU, "count": 1},
                    "env": {"OBSERVER_JOB_SHA256": self.job.state["plan_sha256"]}}
        self.api.pods = [matching, {**matching, "id": "other123"}]
        with self.assertRaisesRegex(ValueError, "exactly one"):
            self.job.reconcile()
        self.assertFalse(any(m == "POST" for m, _, _ in self.api.calls))

    def test_ownership_prevents_stopping_foreign_pod_or_arbitrary_id(self):
        with self.assertRaises(ValueError):
            self.job.stop("no id")
        self.create()
        self.api.pods[0]["env"]["OBSERVER_JOB_SHA256"] = "different-job"
        with self.assertRaisesRegex(ValueError, "ownership"):
            self.job.stop("foreign")
        self.assertFalse(any(p.endswith("/action") for _, p, _ in self.api.calls))

    def test_output_preservation_required_before_delete(self):
        self.create()
        with self.assertRaises(ValueError):
            self.job.terminate()
        self.assertFalse(any(m == "DELETE" for m, _, _ in self.api.calls))
        body = self.export()
        self.job.import_outputs(body)
        self.assertFalse(self.job.state["extraction_valid"])
        self.job.terminate()
        self.assertEqual(self.job.state["phase"], "terminated")
        self.assertEqual((self.directory / "outputs.tar").read_bytes(), body)

    def test_corrupt_output_or_changed_local_archive_blocks_cleanup(self):
        self.create()
        files = manager.read_archive(self.export(), {"receipt.json", "extract.log"}, manager.MAX_EXPORT)
        files["extract.log"] += b"bad"
        with self.assertRaisesRegex(ValueError, "hash mismatch"):
            self.job.import_outputs(manager.archive_bytes(files))
        self.assertNotIn("outputs_sha256", self.job.state)
        self.job.import_outputs(self.export())
        (self.directory / "outputs.tar").write_bytes(b"tampered")
        with self.assertRaises(ValueError):
            self.job.terminate()

    def test_import_restores_unknown_labels_locally_not_in_cloud_payload(self):
        self.job.import_outputs(self.export(failure=False))
        self.assertTrue(self.job.state["extraction_valid"])
        joined = json.loads((self.directory / "features.local.json").read_text())
        self.assertIsNone(joined["rows"][0]["labels"]["concept"])
        self.assertEqual(joined["rows"][0]["group_ids"], ["person-local-only"])

    def test_wrong_model_or_partial_extraction_retained_but_not_validated(self):
        for partial in (False, True):
            body = self.export(failure=False)
            files = manager.read_archive(body, {"receipt.json", "extract.log", "features.json"}, manager.MAX_EXPORT)
            result = json.loads(files["features.json"])
            if partial:
                result["rows"] = []
            else:
                result["manifest"]["observer_revision"] = "b" * 40
            files["features.json"] = json.dumps(result).encode()
            receipt = json.loads(files["receipt.json"])
            receipt["files"]["features.json"] = manager.sha(files["features.json"])
            files["receipt.json"] = json.dumps(receipt).encode()
            with self.subTest(partial=partial):
                self.job.import_outputs(manager.archive_bytes(files))
                self.assertFalse(self.job.state["extraction_valid"])
                (self.directory / "outputs.tar").unlink()

    def test_rate_violation_stops_only_owned_pod_without_deletion(self):
        self.create()
        self.api.pods[0]["cost"] = 1.20
        with self.assertRaisesRegex(ValueError, "exceeds approved"):
            manager.supervise(self.job, sleep=self.clock.sleep)
        self.assertEqual(self.job.state["last_observed_status"], "EXITED")
        self.assertFalse(any(m == "DELETE" for m, _, _ in self.api.calls))

    def test_supervisor_collects_before_delete(self):
        self.create()
        job = self.job
        body = self.export()
        class Transport:
            def __init__(self, job, pod): pass
            def install(self): pass
            def start(self): pass
            def done(self): return True
            def collect(self):
                self_outer.assertFalse(any(m == "DELETE" for m, _, _ in self_outer.api.calls))
                return body
        self_outer = self
        manager.supervise(job, ssh_factory=Transport, sleep=self.clock.sleep)
        self.assertEqual(job.state["phase"], "terminated")
        self.assertFalse(job.state["extraction_valid"])

    def test_download_failure_stops_and_preserves_remote_volume(self):
        self.create()
        self.job.save(launch_attempted=True, launch_acknowledged=True)
        class BrokenDownload:
            def __init__(self, job, pod): pass
            def done(self): return True
            def collect(self): raise TimeoutError("Interrupted download")
        with self.assertRaises(TimeoutError):
            manager.supervise(self.job, ssh_factory=BrokenDownload, sleep=self.clock.sleep)
        self.assertEqual(self.job.state["last_observed_status"], "EXITED")
        self.assertEqual(self.job.state["phase"], "stopped_preservation_required")
        self.assertFalse(any(m == "DELETE" for m, _, _ in self.api.calls))

    def test_resume_after_local_launch_journal_does_not_skip_execution(self):
        self.create()
        self.job.save(launch_attempted=True, phase="extraction_running")
        starts, body = [], self.export()
        class Resume:
            def __init__(self, job, pod): pass
            def install(self): raise AssertionError("Install already journaled")
            def start(self): starts.append(True)
            def done(self): return True
            def collect(self): return body
        manager.supervise(self.job, ssh_factory=Resume, sleep=self.clock.sleep)
        self.assertEqual(starts, [True])
        self.assertEqual(sum(m == "POST" and p == "/pods" for m, p, _ in self.api.calls), 1)

    def test_unconfirmed_stop_is_not_reported_as_stopped(self):
        self.create()
        original = self.api.call
        def no_stop(method, path, data=None, **kwargs):
            if path.endswith("/action"):
                return copy.deepcopy(self.api.pods[0])
            return original(method, path, data, **kwargs)
        self.api.call = no_stop
        with self.assertRaisesRegex(RuntimeError, "not confirmed"):
            self.job.stop("test unconfirmed")
        self.assertEqual(self.job.state["phase"], "stop_unconfirmed")
        self.assertTrue(self.job.state["intervention_required"])

    def test_stop_waits_for_exit_after_transitional_status(self):
        self.create()
        original, observations = self.api.call, []
        def delayed(method, path, data=None, **kwargs):
            if method == "GET" and kwargs.get("timeout") is not None:
                observations.append(kwargs["timeout"])
                pod = copy.deepcopy(self.api.pods[0])
                pod["status"] = "STOPPING" if len(observations) == 1 else "EXITED"
                return pod
            return original(method, path, data, **kwargs)
        self.api.call = delayed
        self.job.stop("delayed stop")
        self.assertEqual(len(observations), 2)
        self.assertTrue(all(t <= 5 for t in observations))
        self.assertEqual(self.job.state["last_observed_status"], "EXITED")
        self.assertEqual(self.clock.now, 1002)

    def test_delete_ack_requires_observed_termination(self):
        self.create()
        self.job.import_outputs(self.export())
        original, observations = self.api.call, []
        def delayed(method, path, data=None, **kwargs):
            if method == "DELETE":
                return None  # An ACK is not itself terminal state.
            if method == "GET" and kwargs.get("timeout") is not None:
                observations.append(kwargs["timeout"])
                if len(observations) == 2:
                    raise manager.APIError("GET", 404)
                return copy.deepcopy(self.api.pods[0])
            return original(method, path, data, **kwargs)
        self.api.call = delayed
        self.job.terminate()
        self.assertEqual(len(observations), 2)
        self.assertEqual(self.job.state["phase"], "terminated")
        self.assertEqual(self.job.state["last_observed_status"], "NOT_FOUND_AFTER_OWN_DELETE")

    def test_lost_delete_ack_unconfirmed_then_read_only_confirmation(self):
        self.create()
        self.job.import_outputs(self.export())
        original, polls, deletes = self.api.call, [], []
        def lost(method, path, data=None, **kwargs):
            if method == "DELETE":
                deletes.append(True)
                raise TimeoutError("Lost deletion response")
            if method == "GET" and kwargs.get("timeout") is not None:
                polls.append(True)
                raise TimeoutError("Verification temporarily unavailable")
            return original(method, path, data, **kwargs)
        self.api.call = lost
        with self.assertRaisesRegex(RuntimeError, "not observed"):
            self.job.terminate()
        self.assertEqual(len(polls), 3)
        self.assertEqual(self.job.state["phase"], "termination_unconfirmed")
        self.assertTrue(self.job.state["intervention_required"])
        self.assertTrue((self.directory / "outputs.tar").is_file())
        def now_missing(method, path, data=None, **kwargs):
            self.assertEqual(method, "GET")
            raise manager.APIError("GET", 404)
        self.api.call = now_missing
        self.job.terminate()
        self.assertEqual(self.job.state["phase"], "terminated")
        self.assertEqual(deletes, [True])

    def test_time_budget_includes_provisioning_and_survives_resume(self):
        self.create()
        self.api.pods[0]["status"] = "PROVISIONING"
        self.clock.now = 1000 + 7200
        class NotReady:
            def __init__(self, job, pod): raise RuntimeError("Not ready")
        resumed = manager.Job(self.directory, self.api, clock=self.clock)
        with self.assertRaises(RuntimeError):
            manager.supervise(resumed, ssh_factory=NotReady, sleep=self.clock.sleep)
        self.assertEqual(resumed.state["last_observed_status"], "EXITED")

    def test_process_lock_prevents_concurrent_management(self):
        with manager.locked_job(self.directory):
            with self.assertRaises(BlockingIOError):
                with manager.locked_job(self.directory):
                    self.fail("Second owner acquired lock")

    def test_bootstrap_extracts_only_pinned_files_and_is_repeatable_without_execution(self):
        root = self.root / "remote"
        command = [sys.executable, "-c", manager.BOOTSTRAP, self.job.plan["archive_sha256"], str(root)]
        for _ in range(2):
            subprocess.run(command, input=self.job.body, check=True, capture_output=True, timeout=10)
        self.assertEqual((root / "input.json").read_bytes(), self.job.files["input.json"])
        self.assertFalse((root / "started.json").exists())
        damaged = subprocess.run(command, input=self.job.body + b"bad", capture_output=True, timeout=10)
        self.assertNotEqual(damaged.returncode, 0)
        (root / "input.json").write_text("changed-after-first-install")
        changed = subprocess.run(command, input=self.job.body, capture_output=True, timeout=10)
        self.assertNotEqual(changed.returncode, 0)

    def test_remote_runner_timeout_and_duplicate_launch_without_gpu_or_installs(self):
        # Exercise the generated supervisor with an authored sleeping process;
        # replace both the uv install and model command. No packages or weights.
        runner = manager.remote_runner().decode()
        original = '([sys.executable,"-m","pip","install","--target",str(root/"bootstrap"),"uv==0.12.5"], ' + repr(manager.gpu_command()) + ')'
        replacement = "([sys.executable,'-c','import time; time.sleep(30)'],)"
        self.assertIn(original, runner)
        root = self.root / "remote-runner"; root.mkdir()
        script = root / "run.py"; script.write_text(runner.replace(original, replacement))
        done = subprocess.run([sys.executable, str(script), "1"], capture_output=True, timeout=10)
        self.assertEqual(done.returncode, 124)
        receipt = (root / "outputs/receipt.json").read_bytes()
        again = subprocess.run([sys.executable, str(script), "1"], capture_output=True, timeout=10)
        self.assertNotEqual(again.returncode, 0)
        self.assertEqual((root / "outputs/receipt.json").read_bytes(), receipt)

    def test_api_redirect_refused_without_credentials_reaching_other_origin(self):
        with self.assertRaisesRegex(ValueError, "redirect refused"):
            manager.NoRedirect().redirect_request(None, None, 302, None, {}, "https://other.invalid")

    def test_actual_http_client_uses_bearer_v2_and_never_retries_or_logs_error_body(self):
        api = object.__new__(manager.RunpodAPI)
        api.key = "AUTHORED_FAKE_SECRET"
        requests = []
        class Opener:
            def open(self, request, timeout):
                requests.append(request)
                raise urllib.error.HTTPError(request.full_url, 503, "unavailable", {}, io.BytesIO(b"AUTHORED_FAKE_SECRET"))
        api.opener = Opener()
        with self.assertRaisesRegex(RuntimeError, "HTTP 503") as caught:
            api.call("POST", "/pods", {"name": "authored-fixture"})
        self.assertEqual(len(requests), 1)
        self.assertEqual(requests[0].full_url, "https://api.runpod.io/v2/pods")
        self.assertEqual(requests[0].get_header("Authorization"), "Bearer AUTHORED_FAKE_SECRET")
        self.assertNotIn("AUTHORED_FAKE_SECRET", str(caught.exception))

    def test_offline_prepare_and_planning_quote_never_initialize_api(self):
        estimate = self.root / "estimate.json"
        with patch.object(manager, "RunpodAPI", side_effect=AssertionError("No credentials")), patch("sys.stdout", io.StringIO()):
            manager.main(["quote", "--planning-rate", "1.09", "--output", str(estimate)])
            manager.main(["prepare", "--input", str(self.source), "--quote", str(estimate),
                          "--job-dir", str(self.root / "draft2"), "--cost-cap", "5", "--hour-cap", "2",
                          "--hourly-cap", "1.20"])
        self.assertFalse(json.loads((self.root / "draft2/plan.json").read_text())["launch_ready"])


class ExperimentRunpodTests(unittest.TestCase):
    """Offline new-mode integration; no model files or provider operations."""

    def setUp(self):
        from test_observer_experiment_job import fixture
        self.base = RunpodTests()
        self.base.setUp(); self.addCleanup(self.base.doCleanups)
        self.root, self.api, self.clock = self.base.root, self.base.api, self.base.clock
        self.fixture = fixture

    def prepare_mode(self, mode, *, with_public_key=True):
        from observer_experiment_job import write_bounded, preflight
        from test_observer_experiment_job import Tokens
        values = self.fixture(mode)
        worker, join = values[:2]
        source, local = self.root / (mode + '.json'), self.root / (mode + '-join.json')
        write_bounded(source, worker); write_bounded(local, join)
        flight = self.root / (mode + '-preflight.json'); write_bounded(flight, preflight(worker, Tokens()))
        directory = self.root / (mode + '-job')
        prepared = manager.prepare(source, self.base.quote, directory, '1.50', '.75', '1.20',
            self.base.public if with_public_key else None,
            job_mode=mode, local_join_path=local, preflight_path=flight)
        return manager.Job(directory, self.api, clock=self.clock, sleep=self.clock.sleep), values, prepared

    def test_overlay_both_modes_seal_image_installer_tokens_and_import_bootstrap_failure(self):
        import observer_experiment_job as worker
        from test_observer_experiment_job import authored_overlay
        original_fixture = self.fixture
        with authored_overlay() as profile, patch.object(manager, 'IMAGE', 'runpod/pytorch@sha256:' + manager.sha(b'{}\n')):
            def overlay_fixture(mode):
                values = list(original_fixture(mode))
                values[0], values[1] = worker.prepare_job(values[2], values[3], values[4], values[5], dependencies=profile)
                return values
            self.fixture = overlay_fixture
            for mode in ('readout', 'intervention'):
                with self.subTest(mode=mode):
                    job, values, prepared = self.prepare_mode(mode)
                    self.assertEqual(self.api.calls, [])
                    self.assertEqual(job.plan['dependency_binding']['overlay_lock_sha256'], worker.OVERLAY_LOCK)
                    self.assertEqual(job.plan['command'], [worker.OVERLAY_PYTHON, 'scripts/training/observer_experiment_job.py'])
                    self.assertEqual(manager.sha(job.files['scripts/training/observer_experiment_job.py']),
                        job.plan['dependency_binding']['installer_sha256'])
                    self.assertEqual(json.loads(job.files['expected-preflight.json'])['preflight_sha256'], job.plan['expected_preflight_sha256'])
                    self.assertEqual(job.request['image'], manager.IMAGE)
                    self.assertEqual(job.request['env']['PUBLIC_KEY'], job.plan['public_key'])
                    remote = self.root/(mode+'-remote'); remote.mkdir()
                    # Exercise the actual allowlisted upload bootstrap, including
                    # the new expected-preflight artifact, in both job modes.
                    subprocess.run([sys.executable, '-c', manager.bootstrap(mode), manager.sha(job.body), str(remote)],
                        input=job.body, check=True, capture_output=True, timeout=10)
                    self.assertEqual((remote/'expected-preflight.json').read_bytes(), job.files['expected-preflight.json'])
                    stub = remote/'image_probe_stub.py'
                    stub.write_text('import sys\nprint("Image Torch/CUDA mismatch: authored bootstrap failure")\nsys.exit(1)\n')
                    script = job.files['run.py'].decode()
                    start = '["/usr/bin/python3.12","scripts/training/observer_experiment_job.py"'
                    self.assertEqual(script.count(start), 1)
                    script = script.replace(start, '['+repr(sys.executable)+','+repr(str(stub)))
                    (remote/'run.py').write_text(script)
                    runtime = {'creation_started_at': time.time(), 'rate_observed_at': time.time(), 'observed_gpu_hourly_rate': .1}
                    run = subprocess.run([sys.executable, str(remote/'run.py'), '10', json.dumps(runtime)], capture_output=True, timeout=15)
                    self.assertEqual(run.returncode, 1, run.stderr)
                    archive = worker.archive_outputs(remote/'outputs')
                    diagnostic = worker.import_outputs(values[0], values[1], archive)
                    self.assertTrue(diagnostic['diagnostic_only']); self.assertFalse(diagnostic['fit_eligible'])
                    self.assertEqual(diagnostic['diagnostic']['failure_stage'], 'bootstrap')
                    self.assertIn('Image Torch/CUDA mismatch', diagnostic['diagnostic']['log_text'])
                    self.assertNotIn('uv0.12', diagnostic['diagnostic']['log_text'])
                    # Resealing the outer manager plan cannot detach the lock.
                    plan = json.loads(json.dumps(job.plan)); plan['dependency_binding']['installer_sha256'] = '0'*64
                    manager.write_json(job.directory/'plan.json', plan)
                    manager.write_json(job.directory/'state.json', {'phase':'prepared','plan_sha256':manager.digest(plan)})
                    manager.write_json(job.directory/'request.json', manager.create_request(plan, manager.digest(plan)))
                    with self.assertRaisesRegex(ValueError, 'Overlay manager'):
                        manager.Job(job.directory, self.api, clock=self.clock, sleep=self.clock.sleep)

    def test_experiment_commented_public_key_binds_plan_and_actual_create_request(self):
        private = self.root / 'generated-ed25519'
        subprocess.run(['ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-C', '', '-f', str(private)],
                       check=True, capture_output=True, timeout=10)
        expected_key = subprocess.run(['ssh-keygen', '-y', '-P', '', '-f', str(private)],
            check=True, capture_output=True, text=True, timeout=10).stdout.strip()
        comment = 'authored-comment-not-for-upload@example.invalid'
        commented_key = expected_key + ' ' + comment + '\n'
        self.base.public.write_text(commented_key)
        for mode in ('readout', 'intervention'):
            with self.subTest(mode=mode):
                self.api.calls.clear(); self.api.pods.clear()
                job, _, prepared = self.prepare_mode(mode)
                self.assertEqual(prepared['plan']['public_key'], expected_key)
                self.assertEqual(job.plan['public_key'], expected_key)
                self.assertTrue(job.plan['launch_ready'])
                request = json.loads((job.directory / 'request.json').read_text())
                self.assertEqual(request['env'], {'PUBLIC_KEY': expected_key,
                    'OBSERVER_JOB_SHA256': prepared['plan_sha256']})
                self.assertEqual(request, job.request)
                self.assertNotIn(comment, manager.canonical(prepared))
                self.assertEqual(self.base.public.read_text(), commented_key)
                self.assertEqual(self.api.calls, [])
                job.create(prepared['plan_sha256'])  # Injected FakeAPI, never a provider.
                self.assertEqual([call for call in self.api.calls if call[0] == 'POST'],
                                 [('POST', '/pods', request)])
                request['env']['PUBLIC_KEY'] = 'hourly_cap_usd'
                (job.directory / 'request.json').write_text(json.dumps(request))
                with self.assertRaisesRegex(ValueError, 'Prepared REST request changed'):
                    manager.Job(job.directory, self.api, clock=self.clock, sleep=self.clock.sleep)

    def test_experiment_keyless_drafts_omit_key_and_cannot_create(self):
        for mode in ('readout', 'intervention'):
            with self.subTest(mode=mode):
                job, _, prepared = self.prepare_mode(mode, with_public_key=False)
                self.assertIsNone(prepared['plan']['public_key'])
                self.assertIsNone(job.plan['public_key'])
                self.assertFalse(job.plan['launch_ready'])
                request = json.loads((job.directory / 'request.json').read_text())
                self.assertEqual(request['env'], {'OBSERVER_JOB_SHA256': prepared['plan_sha256']})
                self.assertEqual(request, job.request)
                with self.assertRaisesRegex(ValueError, 'Draft lacks'):
                    job.create(prepared['plan_sha256'])
                self.assertEqual(self.api.calls, [])
                self.assertEqual(job.state['phase'], 'prepared')
                self.assertNotIn('create_attempted_at', job.state)

    def test_both_modes_have_exact_sources_caps_and_no_cloud_calls(self):
        for mode in ('readout', 'intervention'):
            job, values, prepared = self.prepare_mode(mode)
            worker = values[0]
            self.assertEqual(job.job_mode, mode)
            self.assertEqual(job.plan['experiment_job_sha256'], worker['job_sha256'])
            self.assertEqual(job.plan['worker_limits'], worker['limits'])
            self.assertEqual(set(job.files), {'bundle.json','run.py','input.json'} |
                {'scripts/training/'+n for n in worker['source_files_sha256']})
            uploaded = job.files['input.json'].decode()
            self.assertNotIn('SECRET', uploaded); self.assertNotIn('"labels"', uploaded)
            self.assertEqual(prepared['plan']['hour_cap'], '0.75')
            compile(job.files['run.py'], 'run.py', 'exec')
            compile(manager.export_script(mode), 'export.py', 'exec')
            self.assertIn('materialize', job.files['run.py'].decode())
            self.assertIn('--allow-download', job.files['run.py'].decode())
        self.assertEqual(self.api.calls, [])

    def test_mode_caps_or_worker_source_drift_reject_before_creation(self):
        from observer_experiment_job import write_bounded
        worker, join, *_ = self.fixture()
        source, local = self.root/'worker.json', self.root/'join.json'
        write_bounded(source, worker); write_bounded(local, join)
        for mode, cap in [('intervention', '1.50'), ('readout', '5')]:
            with self.assertRaises(ValueError):
                manager.prepare(source, self.base.quote, self.root/'invalid', cap, '.75', '1.20', self.base.public,
                    job_mode=mode, local_join_path=local)
        self.assertFalse((self.root/'invalid').exists()); self.assertEqual(self.api.calls, [])

    def test_new_bootstrap_exact_archive_and_export_allowlist(self):
        job, _, _ = self.prepare_mode('readout')
        remote = self.root/'remote'
        command = [sys.executable, '-c', manager.bootstrap('readout'), job.plan['archive_sha256'], str(remote)]
        subprocess.run(command, input=job.body, check=True, capture_output=True, timeout=10)
        self.assertTrue((remote/'scripts/training/observer_experiment_job.py').is_file())
        # The stable extract bootstrap refuses the expanded archive.
        refused = subprocess.run([sys.executable, '-c', manager.BOOTSTRAP, job.plan['archive_sha256'], str(self.root/'wrong')],
            input=job.body, capture_output=True, timeout=10)
        self.assertNotEqual(refused.returncode, 0)

    def test_generated_experiment_runner_assembles_and_exports_exact_helper_result(self):
        import observer_experiment_job as worker
        from test_observer_experiment_job import Tokens, materialization, result_fixture
        job, values, _ = self.prepare_mode('readout'); payload, local = values[:2]
        mat = materialization(payload, values[-1]); flight = worker.preflight(payload, Tokens())
        expected = result_fixture(payload, flight, mat)
        def run(_job, _flight, journal, result):
            result['observer_manifests'] = expected['observer_manifests']
            for row in expected['rows']: journal.append(row)
        now = time.time(); runtime = {'creation_started_at': now-10, 'rate_observed_at': now-1, 'observed_gpu_hourly_rate': 1.09}
        fixture_dir = self.root/'authored-result'
        with patch.object(worker, 'cached_tokenizer', return_value=Tokens()), patch.object(worker, 'stream_execute', side_effect=run):
            worker.execute_job(payload, mat, self.root, fixture_dir, runtime)
        mat_path = self.root/'authored-materialization.json'; worker.write_bounded(mat_path, mat)
        fake = self.root/'authored-stages.py'
        fake.write_text('import pathlib,shutil,sys\n'
            'if sys.argv[1]=="materialize":\n'
            ' p=pathlib.Path(sys.argv[3]);p.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile('+repr(str(mat_path))+',p)\n'
            'else: shutil.copytree('+repr(str(fixture_dir))+',sys.argv[4])\n')
        with patch.object(manager, 'gpu_command', return_value=[sys.executable, str(fake)]):
            script = manager.experiment_remote_runner('readout').decode()
        script = script.replace('[sys.executable,"-m","pip","install","--target",str(root/"bootstrap"),"uv==0.12.5"]',
                                repr([sys.executable, '-c', 'pass']))
        remote = self.root/'actual-local-runner'; remote.mkdir()
        (remote/'input.json').write_text(manager.canonical(payload)); (remote/'run.py').write_text(script)
        completed = subprocess.run([sys.executable, str(remote/'run.py'), '10', manager.canonical(runtime)], capture_output=True, timeout=15)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        exported = subprocess.run([sys.executable, '-c', manager.export_script('readout'), str(remote)], capture_output=True, timeout=10)
        self.assertEqual(exported.returncode, 0, exported.stderr)
        imported = worker.import_outputs(payload, local, exported.stdout)
        self.assertTrue(imported['complete']); self.assertEqual(imported['validated_completed_trials'], 3)
        self.assertEqual(self.api.calls, [])

    def test_generated_runner_dependency_failure_imports_diagnostic_in_both_modes(self):
        import observer_experiment_job as worker
        for mode in ('readout', 'intervention'):
            with self.subTest(mode=mode):
                job, values, _ = self.prepare_mode(mode); payload, local = values[:2]
                fake = self.root/(mode+'-dependency-failure.py')
                fake.write_text('import pathlib,sys\n'
                    'assert sys.argv[1] == "materialize"\n'
                    'pathlib.Path("attempted-stage.txt").write_text(sys.argv[1])\n'
                    'print("AUTHORED uv: Failed to download nvidia-cufft-cu12==11.3.3.83; operation timed out")\n'
                    'sys.exit(1)\n')
                with patch.object(manager, 'gpu_command', return_value=[sys.executable, str(fake)]):
                    script = manager.experiment_remote_runner(mode).decode()
                script = script.replace('[sys.executable,"-m","pip","install","--target",str(root/"bootstrap"),"uv==0.12.5"]',
                                        repr([sys.executable, '-c', 'pass']))
                remote = self.root/(mode+'-failed-runner'); remote.mkdir()
                (remote/'input.json').write_text(manager.canonical(payload)); (remote/'run.py').write_text(script)
                now = time.time(); runtime = {'creation_started_at': now-10, 'rate_observed_at': now-1, 'observed_gpu_hourly_rate': 1.09}
                completed = subprocess.run([sys.executable, str(remote/'run.py'), '10', manager.canonical(runtime)], capture_output=True, timeout=15)
                self.assertEqual(completed.returncode, 1, completed.stderr)
                self.assertEqual((remote/'attempted-stage.txt').read_text(), 'materialize')
                self.assertFalse((remote/'.keating/outputs/materialization.json').exists())
                exported = subprocess.run([sys.executable, '-c', manager.export_script(mode), str(remote)], capture_output=True, timeout=10)
                self.assertEqual(exported.returncode, 0, exported.stderr)
                imported = worker.import_outputs(payload, local, exported.stdout)
                self.assertTrue(imported['diagnostic_only']); self.assertEqual(imported['validated_completed_trials'], 0)
                job.import_outputs(exported.stdout)
                self.assertEqual((job.directory/'outputs.tar').read_bytes(), exported.stdout)
                self.assertTrue(job.state['diagnostic_valid'])
                self.assertFalse(job.state['experiment_valid']); self.assertFalse(job.state['partial_valid'])
                self.assertFalse(job.state['fit_eligible']); self.assertIsNone(job.state['experiment_error'])
                self.assertEqual(job.state['worker_failure_stage'], 'materialization')
                self.assertIn('nvidia-cufft', json.loads((job.directory/'diagnostic.local.json').read_text())['log_text'])
                self.assertFalse((job.directory/'partial.local.json').exists())
                self.assertFalse((job.directory/'results.local.json').exists())
        self.assertEqual(self.api.calls, [])

    def test_complete_and_partial_experiment_import_preserves_original_archive(self):
        import observer_experiment_job as worker
        from test_observer_experiment_job import Tokens, materialization, result_fixture
        from unittest.mock import patch
        for mode, timeout in [('readout', False), ('intervention', True)]:
            job, values, _ = self.prepare_mode(mode); payload, local = values[:2]
            mat = materialization(payload, values[-1]); flight = worker.preflight(payload, Tokens())
            expected = result_fixture(payload, flight, mat)
            def run(_job, _flight, journal, result):
                result.update(observer_manifests=expected['observer_manifests'], calibrations=expected['calibrations'])
                for i, row in enumerate(expected['rows']):
                    if timeout and i == 1: raise TimeoutError('authored timeout')
                    journal.append(row)
            now = time.time()
            runtime = {'creation_started_at': now-10, 'rate_observed_at': now-1, 'observed_gpu_hourly_rate': 1.09}
            with patch.object(worker, 'cached_tokenizer', return_value=Tokens()), patch.object(worker, 'stream_execute', side_effect=run):
                directory = self.root/(mode+'-remote-output')
                worker.execute_job(payload, mat, self.root, directory, runtime)
            archive = worker.archive_outputs(directory); job.import_outputs(archive)
            self.assertEqual((job.directory/'outputs.tar').read_bytes(), archive)
            self.assertEqual(job.state['experiment_valid'], not timeout)
            self.assertEqual(job.state['partial_valid'], timeout)
            self.assertEqual(job.state['fit_eligible'], not timeout)
            self.assertEqual(job.state['validated_completed_trials'], 1 if timeout else 3)
        self.assertEqual(self.api.calls, [])

    def test_historical_report_is_offline_even_after_manager_source_changes(self):
        from unittest.mock import patch
        plan = self.base.job.plan.copy(); plan['manager_sha256'] = '0'*64
        manager.write_json(self.base.directory/'plan.json', plan)
        state = self.base.job.state.copy(); state['plan_sha256'] = manager.digest(plan)
        manager.write_json(self.base.directory/'state.json', state)
        with patch.object(manager, 'RunpodAPI', side_effect=AssertionError('No provider for report')):
            report = manager.report_job(self.base.directory)
            self.assertFalse(report['manager_matches_current']); self.assertEqual(report['job_mode'], 'extract')
        with self.assertRaisesRegex(ValueError, 'Supervisor source changed'):
            manager.Job(self.base.directory, self.api)
        self.assertEqual(self.api.calls, [])


if __name__ == "__main__":
    unittest.main()
