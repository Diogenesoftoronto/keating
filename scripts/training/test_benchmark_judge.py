import copy
import json
import unittest

import benchmark_judge as judge


class JudgeTests(unittest.TestCase):
    def setUp(self):
        self.case = {"id": "test", "messages": [{"role": "user", "content": "Explain why."}],
                     "rubric": {"correctness": {"zero": "Wrong", "one": "Incomplete", "two": "Correct"}}}
        self.transcript = [{"role": "assistant", "content": "The median is 2."}]
        self.rating = {"dimension": "correctness", "score": 2,
                       "evidence": {"kind": "quote", "transcript_index": 0, "quote": "median is 2", "observation": "Correct middle value"},
                       "reason": "Matches the definition of median", "support": "self_contained_reasoning", "uncertainty": None}

    def response(self, ratings=None):
        return {"status": "completed", "model": "gpt-5.6-sol", "id": "judge-response",
                "usage": {"input_tokens": 100, "output_tokens": 200},
                "output": [{"type": "message", "content": [{"type": "output_text", "text": json.dumps({"ratings": ratings or [self.rating]})}]}]}

    def test_request_includes_full_transcript_but_not_candidate_identity_or_labels(self):
        self.case.update(candidate_model="secret-model-identity", expected_scores={"correctness": 2})
        self.transcript.append({"role": "tool", "name": "grade", "content": "Failed", "model": "secret-model-identity"})
        request = judge.build_request(self.case, self.transcript)
        text = json.dumps(request)
        self.assertNotIn("secret-model-identity", text)
        self.assertNotIn("expected_scores", text)
        self.assertIn("Failed", text)
        self.assertIn("The median is 2.", text)
        self.assertFalse(request["store"])
        self.assertNotIn("tools", request)

    def test_verified_evidence_and_separate_ai_provenance(self):
        result = judge.judge_case(self.case, self.transcript, lambda request: self.response(), candidate_model="gpt-5.6-sol")
        self.assertEqual(result["status"], "reviewed")
        self.assertEqual(result["ratings"][0]["score"], 2)
        self.assertTrue(result["bias"]["same_model_as_candidate"])
        self.assertIn("not human", result["review_type"])
        self.assertEqual(result["usage"]["output_tokens"], 200)

    def test_fabricated_quotes_wrong_sources_and_bad_scores_fail_closed(self):
        for mutation in ("quote", "index", "boolean", "coverage", "unverifiable"):
            rating = copy.deepcopy(self.rating)
            if mutation == "quote": rating["evidence"]["quote"] = "invented evidence"
            if mutation == "index": rating["evidence"]["transcript_index"] = 2
            if mutation == "boolean": rating["score"] = True
            if mutation == "coverage": rating["dimension"] = "undeclared"
            if mutation == "unverifiable": rating["support"] = "unverifiable"
            result = judge.judge_case(self.case, self.transcript, lambda request: self.response([rating]))
            self.assertEqual(result["status"], "unscored")
            self.assertIsNone(result["ratings"][0]["score"])
        with self.assertRaises(ValueError):
            judge.validate_ratings(self.case, [{"role": "user", "content": "The median is 2."}], {"ratings": [self.rating]})

    def test_explicit_missing_behavior_and_abstention_supported(self):
        rating = copy.deepcopy(self.rating)
        rating.update(score=0, evidence={"kind": "missing_behavior", "quote": None, "transcript_index": None,
                                       "observation": "The reply never identifies the middle value requested by the learner."})
        judge.validate_ratings(self.case, self.transcript, {"ratings": [rating]})
        rating.update(score=None, support="unverifiable", uncertainty="No source for the claimed experiment is supplied")
        rating["evidence"]["kind"] = "abstain"
        judge.validate_ratings(self.case, self.transcript, {"ratings": [rating]})
        rating["uncertainty"] = None
        with self.assertRaises(ValueError):
            judge.validate_ratings(self.case, self.transcript, {"ratings": [rating]})

    def test_tool_argument_evidence_and_truncation(self):
        self.transcript = [{"role": "assistant", "content": None, "tool_calls": [{"function": {"name": "show", "arguments": '{"answer":"The median is 2."}'}}]}]
        judge.validate_ratings(self.case, self.transcript, {"ratings": [self.rating]})
        raw = self.response()
        raw["status"] = "incomplete"
        result = judge.judge_case(self.case, self.transcript, lambda request: raw)
        self.assertEqual(result["status"], "unscored")
        self.assertIsNone(result["ratings"][0]["score"])

    def test_errors_never_expose_secret_or_fabricate_scores(self):
        def dispatch(_): raise RuntimeError("PRIVATE-KEY")
        result = judge.judge_case(self.case, self.transcript, dispatch)
        self.assertNotIn("PRIVATE-KEY", json.dumps(result))
        self.assertEqual(result["error"]["type"], "RuntimeError")
        self.assertIsNone(result["ratings"][0]["score"])

    def test_authored_controls_are_distinct_and_unscored_without_judge(self):
        controls = judge.bench.read_json(judge.CALIBRATION)
        self.assertEqual(len(controls["pairs"]), 8)
        self.assertIn("not human", controls["status"])
        for pair in controls["pairs"]:
            self.assertNotEqual(pair["positive"], pair["negative"])
            for side in ("positive", "negative"):
                payload = judge.build_request(pair["case"], pair[side])
                self.assertNotIn("contrast_dimensions", json.dumps(payload))
        # A judge that cannot distinguish controls must fail the calibration gate.
        def always_same(payload):
            data = json.loads(payload["input"][1]["content"])
            rating = copy.deepcopy(self.rating)
            rating.update(dimension=next(iter(data["case"]["rubric"])), score=1,
                          evidence={"kind": "missing_behavior", "quote": None, "transcript_index": None, "observation": "Control judge gives the same rating"})
            return self.response([rating])
        result = judge.run_calibration(always_same)
        self.assertFalse(result["passed"])
        self.assertEqual(len(result["pairs"]), 8)


if __name__ == "__main__":
    unittest.main()
