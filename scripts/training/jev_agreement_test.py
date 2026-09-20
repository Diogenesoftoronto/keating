"""Deterministic agreement, provenance and failure-boundary checks; no network."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import jev_agreement as gate
from test_benchmark_judge_systemone import FakeBackend, make_case, make_transcript


def corpus():
    rows = [{"id": "fixture", "suite": "teaching-v1", "case": make_case(),
             "transcript": make_transcript(), "measurement": "fixture",
             "full_state": {"sentinel": "retained-for-disagreement"}}]
    return {"rows": rows, "corpus_sha256": gate.fingerprint(rows)}


def incumbent_dispatch(payload):
    material = json.loads(payload["input"][1]["content"])
    ratings = [{"dimension": name, "score": 0, "reason": "fixture",
                "support": "self_contained_reasoning", "uncertainty": None,
                "evidence": {"kind": "quote", "transcript_index": 1,
                             "quote": "The median is 2.", "observation": "fixture"}}
               for name in material["case"]["rubric"]]
    return {"status": "completed", "model": payload["model"], "usage": {"input_tokens": 20, "output_tokens": 10},
            "output": [{"type": "message", "content": [{"type": "output_text", "text": json.dumps({"ratings": ratings})}]}]}


class AgreementTests(unittest.TestCase):
    def test_all_comparison_paths_refuse_a_changed_incumbent(self):
        for mode in ("live", "replay"):
            def wrong(payload):
                return {**incumbent_dispatch(payload), "model": "different-incumbent"}
            value = gate.run(corpus(), {"incumbent": wrong, "jev": FakeBackend()}, mode=mode)
            self.assertEqual(value["judge_errors"], 1)
            self.assertEqual(value["per_suite"]["teaching-v1"]["both_scored"], 0)
            self.assertTrue(all(rating["score"] is None for rating in value["reviews"][0]["incumbent"]["ratings"]))

    def test_report_retains_subset_exclusions_and_parent_identity(self):
        data = corpus()
        data.update(parent_corpus_sha256="a" * 64, selection={"reason": "gateway state budget"},
                    excluded=[{"id": "oversized-case", "suite": "teaching-v3", "reason": "state too large"}])
        value = gate.run(data, {"incumbent": incumbent_dispatch, "jev": FakeBackend()})
        self.assertEqual(value["corpus_selection"], {key: data[key] for key in ("parent_corpus_sha256", "selection", "excluded")})
        data["excluded"].clear()
        self.assertEqual(len(value["corpus_selection"]["excluded"]), 1)

    def test_partial_usage_never_becomes_a_complete_cost_estimate(self):
        value = gate.costs([{"provider_calls": 2, "usage": {"input_tokens": 20, "output_tokens": 10},
                             "usage_complete": False}], {"input_tokens": 2, "output_tokens": 4}, "live")
        self.assertEqual(value["calls"], 2)
        self.assertEqual(value["tokens"], {"input_tokens": 20, "output_tokens": 10})
        self.assertFalse(value["usage_complete"])
        self.assertIsNone(value["estimated_usd"])

    def test_incumbent_bridge_requires_exact_returned_model(self):
        for raw in ({}, {"model": "balanced"}, {"model": "different-incumbent"}):
            with self.assertRaisesRegex(ValueError, "model identity"):
                gate.exact_model_dispatch(lambda _: raw, "gpt-5.6-sol")({"model": "gpt-5.6-sol"})
        raw = {"model": "gpt-5.6-sol"}
        self.assertEqual(gate.exact_model_dispatch(lambda _: raw, "gpt-5.6-sol")({"model": "gpt-5.6-sol"}), raw)
        with self.assertRaisesRegex(ValueError, "declared comparator"):
            gate.exact_model_dispatch(lambda _: raw, "gpt-5.6-sol")({"model": "balanced"})

    def test_live_cli_can_use_two_authenticated_bridges_without_provider_keys(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            source, out, left, right = [path / name for name in ("corpus.json", "report.json", "left.json", "right.json")]
            source.write_text(json.dumps(corpus()))
            left.write_text(json.dumps(["incumbent-account-bridge"]))
            right.write_text(json.dumps(["jev-account-bridge"]))
            args = ["jev_agreement.py", "live", "--execute", "--source", str(source), "--out", str(out),
                    "--incumbent-dispatch-command", str(left), "--jev-dispatch-command", str(right),
                    "--incumbent-model", "incumbent-fixture"]
            with patch("sys.argv", args), patch.object(gate, "command_dispatch", side_effect=[incumbent_dispatch, FakeBackend()]) as bridges, \
                    patch.object(gate.incumbent, "transport", side_effect=AssertionError("direct key transport forbidden")), patch("builtins.print"):
                gate.main()
            self.assertEqual(bridges.call_count, 2)
            self.assertEqual(json.loads(out.read_text())["judge_errors"], 0)

    def test_incumbent_key_and_bridge_are_mutually_exclusive(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)
            source = path / "corpus.json"
            source.write_text(json.dumps(corpus()))
            args = ["jev_agreement.py", "live", "--execute", "--source", str(source), "--out", str(path / "report.json"),
                    "--incumbent-dispatch-command", "/missing/bridge", "--incumbent-key-file", "/missing/key"]
            with patch("sys.argv", args), self.assertRaisesRegex(ValueError, "exactly one incumbent"):
                gate.main()

    def test_kappa_denominator_does_not_turn_abstention_into_score(self):
        value = gate.agreement([(0, 0), (0, 1), (1, 1), (2, 2), (None, 2), (None, None)])
        self.assertEqual(value["both_scored"], 4)
        self.assertEqual(value["exact_agreement"], .75)
        self.assertAlmostEqual(value["cohen_kappa"], 7 / 11)
        self.assertEqual(value["incumbent_abstentions"], 2)
        self.assertEqual(value["both_abstain"], 1)

    def test_constant_or_missing_kappa_is_null(self):
        self.assertIsNone(gate.agreement([(2, 2)])['cohen_kappa'])
        self.assertIsNone(gate.agreement([(None, None)])['exact_agreement'])

    def test_shared_generation_full_state_disagreement_and_unknown_cost(self):
        value = gate.run(corpus(), {"incumbent": incumbent_dispatch, "jev": FakeBackend()})
        self.assertEqual(value["generation_calls"], 0)
        self.assertEqual(value["judge_errors"], 0)
        self.assertEqual(value["disagreements"][0]["row"]["full_state"]["sentinel"], "retained-for-disagreement")
        receipts = value["reviews"][0]
        self.assertEqual(receipts["jev"]["transcript_sha256"], receipts["incumbent"]["transcript_sha256"])
        self.assertIsNone(value["cost_latency"]["jev"]["estimated_usd"])
        self.assertIsNone(value["jev_minus_incumbent"]["hosted_mean_seconds"])
        self.assertFalse(value["gate"]["passed"])

    def test_explicit_cost_estimate_and_missing_usage(self):
        rates = {"input_tokens": 2, "output_tokens": 4}
        receipt = {"usage": {"input_tokens": 100, "output_tokens": 50}, "wall_seconds": 3}
        self.assertEqual(gate.costs([receipt], rates, "live")["estimated_usd"], .0004)
        self.assertEqual(gate.costs([receipt], rates, "live")["hosted_mean_seconds"], 3)
        self.assertIsNone(gate.costs([receipt, {"usage": None}], rates, "live")["estimated_usd"])

    def test_error_is_unscored_and_redacted(self):
        def fail(_):
            raise RuntimeError("secret learner text")
        value = gate.run(corpus(), {"incumbent": incumbent_dispatch, "jev": fail})
        self.assertEqual(value["judge_errors"], 1)
        self.assertEqual(value["per_suite"]["teaching-v1"]["both_scored"], 0)
        self.assertNotIn("secret learner text", json.dumps(value))

    def test_corpus_tampering_is_rejected(self):
        data = corpus()
        data["rows"][0]["transcript"][1]["content"] = "changed"
        with self.assertRaisesRegex(ValueError, "digest mismatch"):
            gate.run(data, {})

    def test_endpoint_safety_and_explicit_direct_override(self):
        for endpoint in ("http://host/v1/judgement", "https://user:pass@host/v1/judgement",
                         "https://host/v1/judgement?key=secret", "https://api.typesafe.ai/v1/systemone"):
            with self.assertRaises(ValueError):
                gate.validate_endpoint(endpoint)
        self.assertEqual(gate.validate_endpoint("https://api.typesafe.ai/v1/systemone", allow_direct=True),
                         "https://api.typesafe.ai/v1/systemone")

    def test_step_scope_and_v4_multistep_are_not_weakened(self):
        row = corpus()["rows"][0]
        row["origins"] = [{"step_index": 0, "completed": True}, {"step_index": 1, "completed": True}]
        row["case"]["reference_material"] = {"evidence_steps": {"correctness": [0]}}
        receipt = {"ratings": [{"dimension": "correctness", "score": 2,
                                "evidence": {"transcript_index": 1}}]}
        self.assertIsNone(gate.enforce_steps(row, receipt)["ratings"][0]["score"])
        row["suite"] = "teaching-v4"
        row["case"]["reference_material"]["evidence_steps"]["correctness"] = [0, 1]
        self.assertIsNone(gate.enforce_steps(row, receipt)["ratings"][0]["score"])
        self.assertEqual(receipt["ratings"][0]["score"], 2)

    def test_packet_history_deduplication_and_full_observation_state(self):
        packet = {"case": {"id": "p", "steps": [{"kind": "message"}], "rubric": [
            {"dimension": "d", "criteria": {"0": "poor", "1": "partial", "2": "good"}, "evidence_steps": [0]}]},
            "result": {"steps": [{"index": 0, "status": "completed", "message_start_index": 1,
                                 "state": {"skill": "unknown"}, "messages": [
                                     {"role": "assistant", "content": "old"},
                                     {"role": "toolResult", "content": [{"type": "text", "text": "fresh"}]}]}]}}
        case, transcript, origins = gate.normalize_packet(packet)
        self.assertEqual(transcript, [{"role": "tool", "content": "fresh"}])
        self.assertEqual(origins[0]["message_index"], 1)
        self.assertEqual(case["reference_material"]["step_observations"][0]["state"], {"skill": "unknown"})

    def test_returned_model_is_retained_independently_of_requested_alias(self):
        backend = FakeBackend()
        def dispatch(payload):
            return {**backend(payload), "model": "jev-concrete-test"}
        value = gate.jev.judge_case(make_case(), make_transcript(), dispatch, judge_model="judgement")
        self.assertEqual(value["judge_model"], "judgement")
        self.assertEqual(value["returned_models"], ["jev-concrete-test"])


if __name__ == "__main__":
    unittest.main()
