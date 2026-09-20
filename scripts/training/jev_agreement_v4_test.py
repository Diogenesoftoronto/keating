"""Native v4 protocol fixtures, not live model or human-learning evidence."""
import copy
import json
import unittest

import jev_agreement as gate
import jev_agreement_v4 as adapter
from test_benchmark_judge_systemone import FakeBackend


def fixture_row(*, persisted=False, measurement="model_episode"):
    case = copy.deepcopy(adapter.v4.load_cases()[0])
    case["rubric"][0].update(dimension="adaptation", evidence_steps=[0, 1],
                             evidence_type="persisted_state" if persisted else "conversation")
    content = '{"learner":"fixture"}'
    result = {"id": case["id"], "status": "completed", "measurement": measurement,
              "steps": [{"index": step, "kind": original["kind"], "status": "completed", "message_start_index": 1,
                         "messages": [{"role": "assistant", "content": "old"},
                                      {"role": "user", "content": "learner"},
                                      {"role": "assistant", "content": f"Visible step {step} evidence.", "stopReason": "stop"}],
                         "files": [{"path": ".keating/profiles/learner.json", "content": content,
                                    "sha256": adapter.bench.digest(content)}]} for step, original in enumerate(case["steps"])]}
    packet = {"case": case, "result": result}
    adapted, transcript, origins = gate.normalize_packet(packet)
    return {"id": "v4-fixture", "suite": "teaching-v4", "case": adapted, "transcript": transcript,
            "origins": origins, "full_state": packet, "measurement": measurement}


def llm_response(row, *, drop_step=False):
    evidence = [{"kind": "quote", "step_index": step, "message_index": 2,
                 "quote": f"Visible step {step} evidence.", "observation": "fixture"} for step in range(2)]
    ratings = [{"dimension": "adaptation", "score": 2, "support": "self_contained_reasoning", "reason": "fixture",
                "evidence": evidence[0], "additional_evidence": [] if drop_step else evidence[1:], "state_evidence": []}]
    ratings.extend(adapter.abstain(rule["dimension"], "Fixture only judges one dimension.")
                   for rule in row["full_state"]["case"]["rubric"][1:])
    return {"status": "completed", "model": "incumbent-fixture", "usage": {"input_tokens": 1, "output_tokens": 1},
            "output": [{"type": "message", "content": [{"type": "output_text", "text": json.dumps({"ratings": ratings})}]}]}


class V4AgreementTests(unittest.TestCase):
    def test_independent_choices_cover_every_scoped_step(self):
        row, fake = fixture_row(), FakeBackend()
        receipt = adapter.judge(row, "jev", "judgement", fake)
        self.assertEqual(receipt["status"], "reviewed")
        rating = receipt["ratings"][0]
        self.assertEqual(rating["score"], 2)
        evidence = [rating["evidence"], *rating["additional_evidence"]]
        self.assertEqual([e["step_index"] for e in evidence], [0, 1])
        self.assertEqual([e["message_index"] for e in evidence], [2, 2])
        questions = fake.payloads[0]["questions"]
        self.assertIn("d0.step.0.evidence.1", questions)
        self.assertIn("d0.step.1.evidence.1", questions)
        self.assertNotIn("Visible step 1", str(questions["d0.step.0.evidence.1"]["criteria"]))
        adapter.v4.validate_review(row["full_state"]["case"], row["full_state"]["result"], receipt["native_review"])

    def test_no_match_at_one_required_step_abstains_even_for_zero_score(self):
        for score in (0, 2):
            row, fake = fixture_row(), FakeBackend(score_level=score)
            def dispatch(payload):
                result = fake(payload)
                for key, question in payload["questions"].items():
                    if ".step.1." in key:
                        result["answers"][key] = FakeBackend(evidence="no_match").answer(question)
                return result
            receipt = adapter.judge(row, "jev", "judgement", dispatch)
            self.assertEqual(receipt["status"], "reviewed")
            self.assertIsNone(receipt["ratings"][0]["score"])

    def test_persisted_state_is_selected_per_step_and_hash_validated(self):
        row, fake = fixture_row(persisted=True), FakeBackend()
        receipt = adapter.judge(row, "jev", "judgement", fake)
        self.assertEqual(receipt["ratings"][0]["score"], 2)
        self.assertEqual([e["step_index"] for e in receipt["ratings"][0]["state_evidence"]], [0, 1])
        self.assertIn("d0.state.0", fake.payloads[0]["questions"])
        row["full_state"]["result"]["steps"][1]["files"][0]["sha256"] = "invalid"
        self.assertIsNone(adapter.judge(row, "jev", "judgement", FakeBackend())["ratings"][0]["score"])

    def test_both_judges_use_the_native_all_steps_boundary(self):
        row = fixture_row()
        self.assertEqual(adapter.judge(row, "incumbent", "fixture", lambda _: llm_response(row))["ratings"][0]["score"], 2)
        self.assertIsNone(adapter.judge(row, "incumbent", "fixture", lambda _: llm_response(row, drop_step=True))["ratings"][0]["score"])

    def test_clipped_or_unobserved_step_abstains_for_both_judges(self):
        for problem in ("clipped", "unobserved"):
            row = fixture_row()
            step = row["full_state"]["result"]["steps"][1]
            if problem == "clipped":
                step["messages"][2]["stopReason"] = "length"
            else:
                step["status"] = "failed"
            for backend, dispatch in (("jev", FakeBackend()), ("incumbent", lambda _: llm_response(row))):
                self.assertIsNone(adapter.judge(row, backend, "fixture", dispatch)["ratings"][0]["score"])

    def test_offline_integration_is_unscored_without_calls(self):
        row = fixture_row(measurement="offline_integration")
        for backend in ("jev", "incumbent"):
            def forbidden(_):
                self.fail("Offline plumbing must not spend judge calls")
            receipt = adapter.judge(row, backend, "fixture", forbidden)
            self.assertEqual(receipt["status"], "unscored")
            self.assertEqual(receipt["provider_calls"], 0)
            self.assertIsNone(receipt["ratings"][0]["score"])

    def test_runner_routes_v4_to_extended_protocol(self):
        row = fixture_row()
        corpus = {"rows": [row], "corpus_sha256": gate.fingerprint([row])}
        report = gate.run(corpus, {"incumbent": lambda _: llm_response(row), "jev": FakeBackend()},
                          models={"incumbent": "incumbent-fixture", "jev": gate.jev.SYSTEM_ONE_MODEL})
        self.assertEqual(report["judge_errors"], 0)
        mismatch = gate.run(corpus, {"incumbent": lambda _: llm_response(row), "jev": FakeBackend()})
        self.assertEqual(mismatch["judge_errors"], 1)
        self.assertEqual(mismatch["per_suite"]["teaching-v4"]["both_scored"], 0)
        self.assertEqual(report["per_suite"]["teaching-v4"]["both_scored"], 1)
        self.assertEqual(report["per_suite"]["teaching-v4"]["exact_agreement"], 1)

    def test_repeated_text_in_distinct_steps_is_not_deduplicated(self):
        row = fixture_row()
        for step in row["full_state"]["result"]["steps"]:
            step["messages"][2]["content"] = "The same visible evidence."
        row["case"], row["transcript"], row["origins"] = gate.normalize_packet(row["full_state"])
        receipt = adapter.judge(row, "jev", "judgement", FakeBackend())
        self.assertEqual(receipt["ratings"][0]["score"], 2)
        self.assertEqual(receipt["ratings"][0]["additional_evidence"][0]["step_index"], 1)

    def test_narrowing_never_quotes_serialized_tool_suffix_or_other_block(self):
        row = fixture_row()
        long = "First relevant visible sentence. " + "Second visible sentence. " * 30
        row["full_state"]["result"]["steps"][0]["messages"][2]["content"] = [
            {"type": "text", "text": ""}, {"type": "text", "text": long},
            {"type": "thinking", "thinking": "Unquotable reasoning"},
            {"type": "text", "text": "A separate visible block."}]
        row["case"], row["transcript"], row["origins"] = gate.normalize_packet(row["full_state"])
        fake = FakeBackend()
        receipt = adapter.judge(row, "jev", "judgement", fake)
        self.assertEqual(receipt["ratings"][0]["score"], 2)
        self.assertEqual(receipt["ratings"][0]["evidence"]["quote"], "First relevant visible sentence.")
        self.assertGreater(fake.calls, 1)

    def test_incumbent_schema_exposes_native_multi_step_fields(self):
        request = adapter.build_incumbent_request(fixture_row(persisted=True), "fixture")
        rating = request["text"]["format"]["schema"]["properties"]["ratings"]["items"]
        self.assertIn("additional_evidence", rating["required"])
        self.assertIn("state_evidence", rating["required"])
        self.assertIn("step_index", rating["properties"]["evidence"]["required"])
        self.assertNotIn("transcript_index", rating["properties"]["evidence"]["properties"])

    def test_zero_call_offline_receipts_do_not_fake_hosted_latency(self):
        cost = gate.costs([{"provider_calls": 0, "wall_seconds": .001, "usage": None}], None, "live")
        self.assertEqual(cost["calls"], 0)
        self.assertIsNone(cost["hosted_mean_seconds"])


if __name__ == "__main__":
    unittest.main()
