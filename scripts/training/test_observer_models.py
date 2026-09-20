"""Profile contracts and mocked loader plumbing, never Qwen weight execution.

All hashes/configs/manifests below are authored test metadata. No large tensors,
Hub downloads, credentials, actors or provider clients are needed.
"""
import argparse
from contextlib import redirect_stderr, redirect_stdout
from copy import deepcopy
import io
import json
from pathlib import Path
import tempfile
import subprocess
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from observer_core import SAESpec, TEMPLATE, boundary_view, digest
import observer_extract as extract
from observer_models import DEFAULT_PROFILE, PIN_LENGTHS, PROFILES, get_profile
import observer_report as report


P27 = "qwen3.5-27b"


def manifest_for(name=DEFAULT_PROFILE, layer=0, *, legacy=False):
    """Authored metadata shaped like an extraction manifest; no measured data."""
    profile = get_profile(name)
    result = {
        "schema_version": 1, "evidence": "model_extraction", "observer_profile": name,
        "observer_model": profile.model, "tokenizer_model": profile.model, "sae_model": profile.dictionary,
        "observer_revision": "a" * 40, "tokenizer_revision": "b" * 40, "sae_revision": "c" * 40,
        "sae_sha256": "d" * 64, "layer": layer, "module": f"language_model.layers.{layer}",
        "sae_file": f"layer{layer}.sae.pt", "dimensions": profile.dimensions, "model_card": profile.card,
        "dtype": "float32", "sae_dtype": "float32", "device": "cpu", "hook": "residual_post_block",
        "pooling": report.POOLING, "encoding": "affine_then_signed_topk_no_relu_no_centering",
        "truncation": False, "chat_template_applied": False, "template": TEMPLATE,
        "template_sha256": report.sha(TEMPLATE.encode()), "max_tokens": 4096,
        "tokenizer_chat_template_sha256": "e" * 64, "config_sha256": "f" * 64,
        "model_files_sha256": {"model.safetensors": "1" * 64},
        "tokenizer_files_sha256": {"tokenizer.json": "2" * 64},
        "implementation_files_sha256": {n: "3" * 64 for n in
                                        ("observer_core.py", "observer_extract.py", "observer_models.py")},
        "software": {n: "authored-test" for n in ("torch", "transformers", "numpy", "tokenizers")},
    }
    if legacy:
        del result["observer_profile"]
        del result["implementation_files_sha256"]["observer_models.py"]
    return result


def projection():
    return {"record_id": "authored", "family_id": "authored", "boundary": "pre_action",
            "latest_allowed_event_id": "event", "events": [{"event_id": "event", "phase": "pre_action",
            "visibility": "public", "kind": "learner_message", "text": "x"}],
            "spans": [{"event_id": "event", "start": 0, "end": 1}]}


def loader_args(name=DEFAULT_PROFILE, layer=0):
    return argparse.Namespace(profile=name, layer=layer, module=f"language_model.layers.{layer}",
                              model_revision="a" * 40, tokenizer_revision="b" * 40, sae_revision="c" * 40,
                              sae_sha256="d" * 64, allow_download=False, dtype="float32", device="cpu",
                              max_tokens=4096)


class ProfileTests(unittest.TestCase):
    def test_exact_profiles_and_unchanged_default(self):
        self.assertEqual(get_profile().spec, SAESpec())
        self.assertEqual(extract.MODEL, "Qwen/Qwen3.5-9B-Base")
        self.assertEqual(extract.DICTIONARY, "Qwen/SAE-Res-Qwen3.5-9B-Base-W64K-L0_50")
        p = get_profile(P27)
        self.assertEqual(p.model, "Qwen/Qwen3.5-27B")
        self.assertEqual(p.dictionary, "Qwen/SAE-Res-Qwen3.5-27B-W80K-L0_50")
        self.assertEqual(p.spec, SAESpec(5120, 81920, 50))
        self.assertEqual(p.layers, 64)
        for name in ("Qwen/Qwen3.5-27B-Instruct", "qwen3.5-27b-base", None, {}):
            with self.subTest(name=name), self.assertRaises(ValueError):
                get_profile(name)

    def test_architecture_validated_without_allocating_weights(self):
        for p in PROFILES.values():
            config = SimpleNamespace(model_type="qwen3_5_text", hidden_size=p.spec.hidden,
                                     num_hidden_layers=p.layers)
            p.validate_config(config)
            p.validate_config(SimpleNamespace(text_config=config))
            for field, value in (("hidden_size", 16), ("num_hidden_layers", 1), ("model_type", "qwen3"),
                                 ("hidden_size", float(p.spec.hidden)), ("num_hidden_layers", True)):
                wrong = deepcopy(config)
                setattr(wrong, field, value)
                with self.subTest(profile=p.name, field=field), self.assertRaisesRegex(ValueError, "architecture"):
                    p.validate_config(SimpleNamespace(text_config=wrong))

    def test_legacy_and_explicit_manifest_profiles(self):
        self.assertFalse(report.validate_manifest(manifest_for(legacy=True)))
        for name, layer in ((DEFAULT_PROFILE, 31), (P27, 0), (P27, 63)):
            with self.subTest(profile=name, layer=layer):
                manifest = manifest_for(name, layer)
                self.assertFalse(report.validate_manifest(manifest))
                self.assertFalse(report.validate_manifest(manifest, profile=name))
        unmarked = manifest_for(P27)
        del unmarked["observer_profile"]
        with self.assertRaises(ValueError):
            report.validate_manifest(unmarked)
        self.assertFalse(report.validate_manifest(unmarked, profile=P27))

    def test_reject_mixed_model_tokenizer_dictionary_and_profile(self):
        for name, other in ((DEFAULT_PROFILE, P27), (P27, DEFAULT_PROFILE)):
            for field in ("observer_model", "tokenizer_model", "sae_model", "observer_profile", "model_card"):
                changed = manifest_for(name)
                changed[field] = manifest_for(other)[field]
                with self.subTest(profile=name, field=field), self.assertRaises(ValueError):
                    report.validate_manifest(changed)
            with self.assertRaisesRegex(ValueError, "profile mismatch"):
                report.validate_manifest(manifest_for(name), profile=other)
        for suffix in ("-Instruct", "-Base"):
            changed = manifest_for(P27)
            changed["observer_model"] += suffix
            changed["tokenizer_model"] += suffix
            with self.assertRaisesRegex(ValueError, "identity"):
                report.validate_manifest(changed)

    def test_reject_dimensions_layers_and_approximate_module_paths(self):
        mutations = [
            {"dimensions": {"hidden": 4096, "width": 65536, "top_k": 50}},
            {"dimensions": {"hidden": 5120, "width": 81920, "top_k": 49}},
            {"dimensions": {"hidden": 5120, "width": 81920., "top_k": 50}},
            {"dimensions": None}, {"layer": -1}, {"layer": 64}, {"layer": True}, {"layer": 0.0},
            {"module": "layers.0"}, {"module": "other.language_model.layers.0"},
            {"module": "language_model.layers.0.mlp"}, {"module": "language_model.layers.1"},
            {"sae_file": "layer1.sae.pt"}, {"sae_file": "../layer0.sae.pt"},
        ]
        for mutation in mutations:
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                report.validate_manifest({**manifest_for(P27), **mutation})
        with self.assertRaisesRegex(ValueError, "layer"):
            report.validate_manifest(manifest_for(DEFAULT_PROFILE, 32))

    def test_reject_missing_malformed_and_mismatched_pins(self):
        manifest = manifest_for(P27)
        pins = {field: manifest[field] for field in PIN_LENGTHS}
        self.assertFalse(report.validate_manifest(manifest, expected_pins=pins))
        for field, length in PIN_LENGTHS.items():
            for invalid in (None, "main", "a" * (length - 1), "A" * length, "a" * length + "\n"):
                with self.subTest(field=field, invalid=invalid), self.assertRaises(ValueError):
                    report.validate_manifest({**manifest, field: invalid})
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, "mismatch"):
                report.validate_manifest({**manifest, field: "9" * length}, expected_pins=pins)
        with self.assertRaises(ValueError):
            report.validate_manifest(manifest, expected_pins={"sae_sha256": pins["sae_sha256"]})
        for field in ("model_files_sha256", "tokenizer_files_sha256", "implementation_files_sha256"):
            for invalid in ({}, {"file": "main"}):
                with self.subTest(field=field), self.assertRaises(ValueError):
                    report.validate_manifest({**manifest, field: invalid})
        del manifest["implementation_files_sha256"]["observer_models.py"]
        with self.assertRaisesRegex(ValueError, "implementation"):
            report.validate_manifest(manifest)

    def test_27b_rows_use_selected_dimensions_and_high_coordinates(self):
        record, manifest = projection(), manifest_for(P27, 63)
        view = boundary_view(record)
        span = view["spans"][0]
        coordinates, values = list(range(49)) + [81919], [1.] * 50
        row = {"record_id": record["record_id"], "family_id": record["family_id"], "boundary": record["boundary"],
               "record_sha256": digest(record), "observer_manifest_sha256": digest(manifest),
               "view": view, "text": view["text"], "pooling": report.POOLING, "sae_width": 81920,
               "raw": [0.] * 5120, "input_token_ids": [1], "selected_token_indices": [0],
               "sparse_tokens": [{"token_index": 0, "character_offsets": [span["start"], span["end"]],
                                  "indices": coordinates, "values": values}],
               "sae": {str(i): v for i, v in zip(coordinates, values)}}
        document = {"manifest": manifest, "manifest_sha256": digest(manifest), "rows": [row]}
        report.validate_rows(document, {"records": [record]})
        for field, value in (("raw", [0.] * 4096), ("sae_width", 65536)):
            wrong = deepcopy(document)
            wrong["rows"][0][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                report.validate_rows(wrong, {"records": [record]})
        row["sparse_tokens"][0]["indices"][-1] = 81920
        with self.assertRaisesRegex(ValueError, "coordinate"):
            report.validate_rows(document, {"records": [record]})


class ExtractionTests(unittest.TestCase):
    def cli_args(self, source, output, name=DEFAULT_PROFILE, layer=0):
        return [str(source), str(output), "--profile", name, "--layer", str(layer),
                "--module", f"language_model.layers.{layer}", "--model-revision", "a" * 40,
                "--tokenizer-revision", "b" * 40, "--sae-revision", "c" * 40, "--sae-sha256", "d" * 64]

    def test_cli_preflight_and_selected_spec_reach_extraction(self):
        with tempfile.TemporaryDirectory() as directory:
            source, output = Path(directory) / "input.json", Path(directory) / "output.json"
            source.write_text(json.dumps({"records": [projection()]}))
            args = self.cli_args(source, output, P27, 63)
            with patch.object(extract, "load_observer", side_effect=AssertionError("No weights")), redirect_stdout(io.StringIO()) as out:
                extract.main(args + ["--validate-only"])
            self.assertEqual(json.loads(out.getvalue())["dimensions"], get_profile(P27).dimensions)
            self.assertFalse(output.exists())
            with patch.object(extract, "load_observer", return_value=(None, None, None, {}, manifest_for(P27, 63))), \
                    patch.object(extract, "extract_record", return_value={}) as record, redirect_stdout(io.StringIO()):
                extract.main(args)
            self.assertEqual(record.call_args.kwargs["spec"], SAESpec(5120, 81920, 50))

    def test_invalid_cli_selection_never_loads_even_with_allow_download(self):
        with tempfile.TemporaryDirectory() as directory:
            source, output = Path(directory) / "input.json", Path(directory) / "output.json"
            source.write_text(json.dumps({"records": [projection()]}))
            for name, layer in ((DEFAULT_PROFILE, 32), (P27, 64), ("unknown", 0)):
                with patch.object(extract, "load_observer", side_effect=AssertionError("No weights")), \
                        redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                    extract.main(self.cli_args(source, output, name, layer) + ["--validate-only", "--allow-download"])
            self.assertFalse(output.exists())

    def test_direct_loader_preflight_runs_before_runtime_imports(self):
        for mutation in ({"profile": "unknown"}, {"layer": 64}, {"layer": True},
                         {"module": "pretend.layers.0"}, {"model_revision": "main"}, {"sae_sha256": "bad"}):
            args = loader_args(P27)
            vars(args).update(mutation)
            with patch("builtins.__import__", side_effect=AssertionError("Runtime must not be imported")), \
                    self.subTest(mutation=mutation), self.assertRaises(ValueError):
                extract.load_observer(args)

    def test_mocked_loader_uses_exact_pair_spec_pins_and_freezes_observer(self):
        # Mock only loader boundaries: no fake 27B tensors or model weights.
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "model.safetensors").write_bytes(b"authored metadata placeholder; not weights")
            (root / "config.json").write_text("{}")
            for name in PROFILES:
                profile, args = get_profile(name), loader_args(name, get_profile(name).layers - 1)
                model = Mock()
                model.to.return_value = model.eval.return_value = model.requires_grad_.return_value = model
                model.get_submodule.return_value = type("Qwen3_5DecoderLayer", (), {})()
                tokenizer = SimpleNamespace(is_fast=True, chat_template=None)
                hub = SimpleNamespace(snapshot_download=Mock(return_value=str(root)),
                                      hf_hub_download=Mock(return_value=str(root / f"layer{args.layer}.sae.pt")))
                runtime = SimpleNamespace(
                    AutoConfig=SimpleNamespace(from_pretrained=Mock(return_value=SimpleNamespace(
                        text_config=SimpleNamespace(model_type="qwen3_5_text", hidden_size=profile.spec.hidden,
                                                    num_hidden_layers=profile.layers)))),
                    AutoModel=SimpleNamespace(from_pretrained=Mock(return_value=(model, {}))),
                    AutoTokenizer=SimpleNamespace(from_pretrained=Mock(return_value=tokenizer)))
                torch = SimpleNamespace(load=Mock(return_value={}), float32="authored-dtype")
                with self.subTest(profile=name), patch.dict("sys.modules", {"torch": torch, "huggingface_hub": hub,
                        "transformers": runtime}), patch.object(extract, "validate_sae") as validate, \
                        patch.object(extract, "file_hash", return_value=args.sae_sha256), \
                        patch.object(extract, "version", return_value="authored-test"):
                    loaded = extract.load_observer(args)
                validate.assert_called_once_with({}, profile.spec)
                self.assertEqual([c.args[0] for c in hub.snapshot_download.call_args_list], [profile.model] * 2)
                self.assertEqual([c.kwargs["revision"] for c in hub.snapshot_download.call_args_list],
                                 [args.model_revision, args.tokenizer_revision])
                self.assertTrue(all(c.kwargs["local_files_only"] for c in hub.snapshot_download.call_args_list))
                hub.hf_hub_download.assert_called_once_with(profile.dictionary, f"layer{args.layer}.sae.pt",
                                                          revision=args.sae_revision, local_files_only=True)
                model.requires_grad_.assert_called_once_with(False)
                model.get_submodule.assert_called_once_with(args.module)
                self.assertFalse(report.validate_manifest(loaded[-1], profile=name))

    def test_wrong_sae_bytes_rejected_before_deserialization(self):
        args = loader_args(P27)
        hub = SimpleNamespace(snapshot_download=Mock(return_value="/unused"),
                              hf_hub_download=Mock(return_value="/unused/layer0.sae.pt"))
        torch = SimpleNamespace(load=Mock(side_effect=AssertionError("Must not deserialize")))
        runtime = SimpleNamespace(AutoConfig=None, AutoModel=None, AutoTokenizer=None)
        with patch.dict("sys.modules", {"torch": torch, "huggingface_hub": hub, "transformers": runtime}), \
                patch.object(extract, "file_hash", return_value="0" * 64), self.assertRaisesRegex(ValueError, "pinned layer hash"):
            extract.load_observer(args)
        torch.load.assert_not_called()

    def test_report_cli_passes_explicit_profile(self):
        with patch.object(report, "export_capture", return_value={"rows": [], "evidence": "authored", "artifact_sha256": "x"}) as export, \
                redirect_stdout(io.StringIO()):
            report.main(["job", "output", "--profile", P27])
        self.assertEqual(export.call_args.kwargs["profile"], P27)


class LegacyBundleTests(unittest.TestCase):
    def test_all_remote_archives_admit_and_import_real_sources_in_isolation(self):
        import observer_runpod as manager
        import observer_experiment_job as experiment
        import observer_generation_job as generation
        for mode, names, entrypoint in (
                ("extract", manager.SOURCE_NAMES, "observer_extract"),
                ("readout", experiment.SOURCE_NAMES, "observer_experiment_job"),
                ("intervention", experiment.SOURCE_NAMES, "observer_experiment_job"),
                ("generation", generation.SOURCE_NAMES, "observer_generation_job")):
            self.assertIn("observer_models.py", names)
            files = {"scripts/training/" + name: Path(__file__).with_name(name).read_bytes() for name in names}
            files.update({"run.py": b"# authored fixture; no worker launch\n", "input.json": b'{"dependency_profile":{}}'})
            if mode != "extract":
                files["expected-preflight.json"] = b"{}"
            files["bundle.json"] = json.dumps({"files": {k: manager.sha(v) for k, v in files.items()}}).encode()
            body = manager.archive_bytes(files)
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as directory:
                root = Path(directory) / "remote"
                for _ in range(2):
                    installed = subprocess.run([sys.executable, "-B", "-c", manager.bootstrap(mode),
                                                manager.sha(body), str(root)], input=body, capture_output=True, timeout=10)
                    self.assertEqual(installed.returncode, 0, installed.stderr.decode())
                # No repository path or user packages can rescue a missing upload.
                code = ("import sys; sys.path.insert(0, sys.argv[1]); import " + entrypoint + "; "
                        "import observer_extract as e; assert e.MODEL == 'Qwen/Qwen3.5-9B-Base'; "
                        "assert not {'torch','transformers','huggingface_hub'} & set(sys.modules)")
                imported = subprocess.run([sys.executable, "-I", "-S", "-B", "-c", code,
                                           str(root / "scripts/training")], cwd=directory,
                                          capture_output=True, timeout=10)
                self.assertEqual(imported.returncode, 0, imported.stderr.decode())
                # A resealed archive still must include the new dependency.
                missing = {k: v for k, v in files.items() if k != "scripts/training/observer_models.py"}
                missing["bundle.json"] = json.dumps({"files": {k: manager.sha(v) for k, v in missing.items()
                                                              if k != "bundle.json"}}).encode()
                body = manager.archive_bytes(missing)
                refused = subprocess.run([sys.executable, "-B", "-c", manager.bootstrap(mode),
                                          manager.sha(body), str(Path(directory) / "missing")],
                                         input=body, capture_output=True, timeout=10)
                self.assertNotEqual(refused.returncode, 0)
                self.assertFalse((Path(directory) / "missing/bundle.sha256").exists())

    def test_prepared_9b_extract_bundle_pins_and_validates_models_dependency(self):
        import observer_runpod as manager
        from test_observer_runpod import RunpodTests
        fixture = RunpodTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        body = fixture.export(failure=False)  # Authored result; no GPU or cloud.
        result = report.receipt_features(body)
        job = fixture.job
        name = "scripts/training/observer_models.py"
        self.assertEqual(job.files[name], Path(__file__).with_name("observer_models.py").read_bytes())
        self.assertEqual(job.plan["bundle_files_sha256"][name], manager.sha(job.files[name]))
        job.validate_result(result)
        for value in (None, "0" * 64):
            changed = deepcopy(result)
            pins = changed["manifest"]["implementation_files_sha256"]
            if value is None:
                pins.pop("observer_models.py")
            else:
                pins["observer_models.py"] = value
            changed["manifest_sha256"] = digest(changed["manifest"])
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, "different source code"):
                job.validate_result(changed)
        changed = deepcopy(result)
        changed["manifest"]["observer_model"] = get_profile(P27).model
        with self.assertRaisesRegex(ValueError, "approved observer"):
            job.validate_result(changed)
        self.assertEqual(fixture.api.calls, [])

    def test_experiment_receipt_requires_all_three_loader_pins(self):
        import observer_experiment_job as worker
        from test_observer_experiment_job import fixture, materialization, result_fixture, Tokens
        job, _, _, _, _, _, _, bodies = fixture()
        flight = worker.preflight(job, Tokens())
        mat = materialization(job, bodies)
        result = result_fixture(job, flight, mat)
        for manifest in result["observer_manifests"]:
            manifest["implementation_files_sha256"]["observer_models.py"] = job["source_files_sha256"]["observer_models.py"]
        manifests = {m["layer"]: m for m in result["observer_manifests"]}
        for row in result["rows"]:
            row["observer_manifest_sha256"] = digest(manifests[row["layer"]])
        result = worker.seal({k: v for k, v in result.items() if k != "result_sha256"}, "result_sha256")
        worker.validate_experiment_result(job, result, flight, mat)
        for value in (None, "0" * 64):
            changed = deepcopy(result)
            pins = changed["observer_manifests"][0]["implementation_files_sha256"]
            if value is None:
                pins.pop("observer_models.py")
            else:
                pins["observer_models.py"] = value
            changed = worker.seal({k: v for k, v in changed.items() if k != "result_sha256"}, "result_sha256")
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, "Loader implementation hash mismatch"):
                worker.validate_experiment_result(job, changed, flight, mat)


if __name__ == "__main__":
    unittest.main()
