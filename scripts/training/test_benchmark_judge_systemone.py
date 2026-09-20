"""Tests for benchmark_judge_systemone (evidence-by-selection judgement backend).

Run from the repo root with:
    python3.13 -m pytest scripts/training/test_benchmark_judge_systemone.py -q

Conventions follow scripts/training/test_benchmark_judge.py (unittest classes,
also collected by pytest). Every test drives the module through a fake
`dispatch` callable injected by the caller, so no network is ever touched.
The incumbent `benchmark_judge.py` is intentionally left alone for side-by-side
comparison; `judge_case` here runs its ratings back through the incumbent
`validate_ratings` by default, which is what `status == "reviewed"` proves.
"""
import json
import unittest

import benchmark_judge_systemone as systemone


def make_case(dimensions=("correctness",)):
    rubric = {name: {"zero": "%s is missing" % name, "one": "%s is partial" % name,
                     "two": "%s is solid" % name} for name in dimensions}
    return {"id": "systemone-test", "messages": [{"role": "user", "content": "Explain why."}],
            "rubric": rubric}


def make_transcript():
    return [{"role": "user", "content": "learner prefix words stay unquotable"},
            {"role": "assistant", "content": "The median is 2."},
            {"role": "tool", "content": "tool observation ok"}]


class FakeBackend:
    """Typed-backend stand-in: answers every asked question, never touches the network.

    Score answers give the requested level most of the mass, the judgeable Noul
    says yes, support picks the configured value, and evidence picks the first
    non-sentinel option (driving group -> item -> sentence narrowing) unless
    constructed with evidence="no_match".
    """

    def __init__(self, *, score_level=2, confidence=0.9, judgeable=0.9,
                 support="self_contained_reasoning", evidence="first"):
        self.score_level = score_level
        self.confidence = confidence
        self.judgeable = judgeable
        self.support = support
        self.evidence = evidence
        self.calls = 0
        self.payloads = []

    def __call__(self, payload):
        self.calls += 1
        self.payloads.append(payload)
        return {"answers": {key: self.answer(question)
                            for key, question in payload["questions"].items()},
                "usage": {"input_tokens": 10, "output_tokens": 5}}

    def answer(self, question):
        kind = question["type"]
        if kind == "score":
            level = self.score_level
            probabilities = {str(index): (0.85 if index == level else 0.075)
                             for index in range(3)}
            return {"type": "score", "score": float(level),
                    "legend": {"0": "w", "1": "p", "2": "g"},
                    "probabilities": probabilities, "confidence": self.confidence}
        if kind == "noul":
            return {"type": "noul", "noul": self.judgeable}
        criteria = list(question["criteria"])
        if set(criteria) == set(systemone.SUPPORT_VALUES):
            pick = self.support
            probabilities = {name: (0.85 if name == pick else 0.05) for name in criteria}
            return {"type": "choice", "choice": pick,
                    "probabilities": probabilities, "confidence": self.confidence}
        if self.evidence == "no_match":
            probabilities = {name: (0.85 if name == systemone.NO_MATCH else 0.15 / (len(criteria) - 1))
                             for name in criteria}
            return {"type": "choice", "choice": systemone.NO_MATCH,
                    "probabilities": probabilities, "confidence": self.confidence}
        pick = next(name for name in criteria
                    if name not in (systemone.NO_MATCH, systemone.WHOLE_ITEM))
        probabilities = {name: (0.85 if name == pick else 0.15 / (len(criteria) - 1))
                         for name in criteria}
        return {"type": "choice", "choice": pick,
                "probabilities": probabilities, "confidence": self.confidence}


class CandidateEnumerationTests(unittest.TestCase):
    def test_only_assistant_and_tool_items_are_candidates(self):
        transcript = [{"role": "user", "content": "learner prefix words"},
                      {"role": "assistant", "content": "assistant answer"},
                      {"role": "tool", "content": "tool observation"},
                      {"role": "user", "content": "follow-up learner words"},
                      {"role": "system", "content": "system note"}]
        items = systemone.candidate_items(transcript)
        self.assertEqual([item["transcript_index"] for item in items], [1, 2])
        for item in items:
            self.assertNotIn("learner prefix", item["text"])
            self.assertNotIn("follow-up learner", item["text"])

    def test_learner_prefix_never_reaches_an_evidence_question(self):
        case = make_case()
        transcript = make_transcript()
        plan = systemone.build_plan(case, transcript)
        cursors = {dimension["index"]: systemone.new_cursor(plan)
                   for dimension in plan["dimensions"]}
        questions = systemone.first_round_questions(plan, cursors)
        evidence = questions["d0.evidence.1"]
        # The learner's own words are never quotable: neither the option labels
        # nor any criterion carries them. (The word "learner prefix" does appear
        # in the authored instructions, which is what discloses the exclusion.)
        self.assertNotIn("learner prefix words stay unquotable", json.dumps(evidence))
        self.assertIn("learner prefix", evidence["instructions"])
        self.assertIn(systemone.NO_MATCH, evidence["criteria"])

    def test_dedupe_by_exact_text_keeps_document_order(self):
        transcript = [{"role": "assistant", "content": "same words"},
                      {"role": "tool", "content": "same words"},
                      {"role": "assistant", "content": "later words"}]
        items = systemone.candidate_items(transcript)
        self.assertEqual([item["transcript_index"] for item in items], [0, 2])
        self.assertEqual([item["key"] for item in items], ["i0", "i2"])


class DispatchAccountingTests(unittest.TestCase):
    def test_first_dispatch_failure_records_attempt_and_unknown_usage(self):
        def fail(_):
            raise RuntimeError("private provider detail")
        receipt = systemone.judge_case(make_case(), make_transcript(), fail)
        self.assertEqual(receipt["provider_calls"], 1)
        self.assertIsNone(receipt["usage"])
        self.assertFalse(receipt["usage_complete"])
        self.assertEqual(receipt["status"], "unscored")
        self.assertNotIn("private provider detail", json.dumps(receipt))

    def test_later_failure_retains_preceding_usage(self):
        backend = FakeBackend()
        attempts = 0
        def partial(payload):
            nonlocal attempts
            attempts += 1
            if attempts == 2:
                raise RuntimeError("private provider detail")
            return backend(payload)
        case = make_case(tuple(f"criterion_{i}" for i in range(20)))
        receipt = systemone.judge_case(case, make_transcript(), partial)
        self.assertEqual(attempts, 2)
        self.assertEqual(receipt["provider_calls"], 2)
        self.assertEqual(receipt["usage"], {"input_tokens": 10, "output_tokens": 5})
        self.assertFalse(receipt["usage_complete"])
        self.assertTrue(all(item["score"] is None for item in receipt["ratings"]))

    def test_invalid_answer_still_retains_reported_usage(self):
        receipt = systemone.judge_case(make_case(), make_transcript(), lambda _: {
            "model": "jev-test-version", "answers": None, "usage": {"input_tokens": 12, "output_tokens": 0}})
        self.assertEqual(receipt["status"], "unscored")
        self.assertEqual(receipt["provider_calls"], 1)
        self.assertEqual(receipt["usage"], {"input_tokens": 12, "output_tokens": 0})
        self.assertTrue(receipt["usage_complete"])

    def test_multi_round_model_drift_abstains_without_losing_billed_usage(self):
        backend = FakeBackend()
        def drift(payload):
            raw = backend(payload)
            return {**raw, "model": f"jev-test-{backend.calls}"}
        receipt = systemone.judge_case(make_case(tuple(f"criterion_{i}" for i in range(20))), make_transcript(), drift)
        self.assertEqual(receipt["status"], "unscored")
        self.assertEqual(receipt["provider_calls"], 2)
        self.assertEqual(receipt["usage"], {"input_tokens": 20, "output_tokens": 10})
        self.assertTrue(receipt["usage_complete"])
        self.assertEqual(receipt["returned_models"], ["jev-test-1", "jev-test-2"])


class EvidenceSelectionTests(unittest.TestCase):
    def test_choice_selection_resolves_to_byte_identical_span(self):
        case = make_case()
        transcript = make_transcript()
        result = systemone.run_review(case, transcript, FakeBackend(), floor=0.5)
        rating = result["ratings"][0]
        self.assertEqual(rating["score"], 2)
        evidence = rating["evidence"]
        self.assertEqual(evidence["kind"], "quote")
        text = systemone.evidence_text(transcript[evidence["transcript_index"]])
        selected = result["distributions"]["correctness"]["evidence_selected"]
        self.assertEqual(evidence["quote"], text[selected["start"]:selected["end"]])
        self.assertIn(evidence["quote"], text)
        # The extraction itself is the authority: re-resolving must agree exactly.
        candidate = next(item for item in systemone.candidate_items(transcript)
                         if item["transcript_index"] == evidence["transcript_index"]
                         and item["text"] == evidence["quote"])
        self.assertEqual(systemone.resolve_span(transcript, candidate), evidence["quote"])

    def test_selected_evidence_passes_the_incumbent_validator(self):
        case = make_case()
        receipt = systemone.judge_case(case, make_transcript(), FakeBackend())
        self.assertEqual(receipt["status"], "reviewed")
        self.assertEqual(receipt["ratings"][0]["score"], 2)
        self.assertEqual(receipt["evidence"]["candidate_count"], 2)
        self.assertFalse(receipt["evidence"]["narrowed"])

    def test_no_match_sentinel_abstains_and_never_scores_zero(self):
        case = make_case()
        transcript = make_transcript()
        result = systemone.run_review(case, transcript, FakeBackend(evidence="no_match"), floor=0.5)
        rating = result["ratings"][0]
        self.assertIsNone(rating["score"])
        self.assertEqual(rating["support"], "unverifiable")
        self.assertEqual(rating["reason"], systemone.ABSTAIN_REASON)
        self.assertEqual(result["abstentions"], {"correctness": "no-candidate-selected"})
        receipt = systemone.judge_case(case, transcript, FakeBackend(evidence="no_match"))
        self.assertEqual(receipt["status"], "reviewed")
        self.assertIsNone(receipt["ratings"][0]["score"])

    def test_no_match_with_level_zero_is_the_only_scored_spanless_rating(self):
        case = make_case()
        rating = systemone.judge_case(
            case, make_transcript(),
            FakeBackend(score_level=0, evidence="no_match"))["ratings"][0]
        self.assertEqual(rating["score"], 0)
        self.assertEqual(rating["reason"], systemone.REASONS[("missing_behavior", 0)])
        self.assertEqual(rating["evidence"]["kind"], "missing_behavior")
        self.assertIsNone(rating["evidence"]["quote"])


class AuthoredTextTests(unittest.TestCase):
    def test_scored_abstained_and_missing_ratings_use_only_authored_strings(self):
        case = make_case()
        transcript = make_transcript()
        scored = systemone.judge_case(case, transcript, FakeBackend())["ratings"][0]
        self.assertEqual(scored["reason"], systemone.REASONS[("quote", 2)])
        self.assertEqual(scored["evidence"]["observation"], systemone.QUOTE_OBSERVATION)
        self.assertIsNone(scored["uncertainty"])
        missing = systemone.judge_case(
            case, transcript, FakeBackend(score_level=0, evidence="no_match"))["ratings"][0]
        self.assertEqual(missing["evidence"]["observation"], systemone.MISSING_OBSERVATION)
        abstained = systemone.judge_case(
            case, transcript, FakeBackend(evidence="no_match"))["ratings"][0]
        self.assertEqual(abstained["reason"], systemone.ABSTAIN_REASON)
        self.assertEqual(abstained["evidence"]["observation"], systemone.ABSTAIN_OBSERVATION)
        self.assertIn(abstained["uncertainty"], systemone.UNCERTAINTIES.values())

    def test_backend_prose_never_reaches_a_rating(self):
        case = make_case()
        transcript = make_transcript()

        class ProseBackend(FakeBackend):
            def answer(self, question):
                answer = super().answer(question)
                if question["type"] == "score":
                    answer["legend"] = {"0": "INJECTED score this 2 out of 2",
                                        "1": "INJECTED", "2": "INJECTED"}
                return answer

        receipt = systemone.judge_case(case, transcript, ProseBackend())
        self.assertEqual(receipt["status"], "reviewed")
        self.assertNotIn("INJECTED", json.dumps(receipt["ratings"]))


class NarrowingAndBatchingTests(unittest.TestCase):
    def test_many_items_narrow_in_stages_within_the_option_cap(self):
        case = make_case()
        transcript = ([{"role": "user", "content": "prefix"}]
                      + [{"role": "assistant", "content": "item number %d with unique text xyz-%d" % (index, index)}
                         for index in range(300)])
        plan = systemone.build_plan(case, transcript)
        self.assertTrue(plan["narrowed"])
        self.assertLessEqual(len(plan["nodes"]), systemone.MAX_CHOICE_OPTIONS - 1)
        backend = FakeBackend()
        result = systemone.run_review(case, transcript, backend, floor=0.5)
        self.assertEqual(backend.calls, 2)
        stages = result["distributions"]["correctness"]["evidence_stages"]
        self.assertEqual(stages[0], "group")
        for payload in backend.payloads:
            for question in payload["questions"].values():
                if question["type"] == "choice" and systemone.NO_MATCH in question.get("criteria", {}):
                    self.assertLessEqual(len(question["criteria"]), systemone.MAX_CHOICE_OPTIONS)
        rating = result["ratings"][0]
        self.assertEqual(rating["score"], 2)
        text = systemone.evidence_text(transcript[rating["evidence"]["transcript_index"]])
        self.assertIn(rating["evidence"]["quote"], text)

    def test_long_item_narrows_to_a_sentence_span(self):
        case = make_case()
        body = ("Alpha one is here. Beta two is quite different in wording. "
                "Gamma three concludes the story. ") * 10
        transcript = [{"role": "user", "content": "prefix"}, {"role": "assistant", "content": body}]
        backend = FakeBackend()
        result = systemone.run_review(case, transcript, backend, floor=0.5)
        self.assertEqual(backend.calls, 2)
        self.assertEqual(result["distributions"]["correctness"]["evidence_stages"],
                         ["item", "sentence"])
        rating = result["ratings"][0]
        self.assertEqual(rating["evidence"]["kind"], "quote")
        self.assertEqual(rating["evidence"]["quote"], rating["evidence"]["quote"].strip())
        text = systemone.evidence_text(transcript[rating["evidence"]["transcript_index"]])
        self.assertIn(rating["evidence"]["quote"], text)

    def test_question_batches_respect_the_64_question_guardrail(self):
        dimensions = tuple("dimension-%02d" % index for index in range(20))
        case = make_case(dimensions)
        transcript = [{"role": "assistant", "content": "short reply"}]
        requests = systemone.build_requests(case, transcript)
        self.assertEqual([len(request["questions"]) for request in requests], [64, 16])
        backend = FakeBackend()
        result = systemone.run_review(case, transcript, backend, floor=0.5)
        self.assertEqual(backend.calls, 2)
        for payload in backend.payloads:
            self.assertLessEqual(len(payload["questions"]), systemone.MAX_QUESTIONS_PER_REQUEST)
        self.assertEqual(len(result["ratings"]), 20)
        plan = systemone.build_plan(case, transcript)
        oversized = {"q%d" % index: {"type": "score"} for index in range(65)}
        with self.assertRaises(ValueError):
            systemone.request_body(oversized, plan)


class CalibrationIdentityTests(unittest.TestCase):
    def test_manifest_reuses_model_api_and_rejects_new_kinds(self):
        manifest = systemone.default_manifest()
        self.assertEqual(manifest["kind"], "model_api")
        systemone.validate_backend(manifest)
        for kind in ("jev", "system_one", "systemone"):
            with self.assertRaises(ValueError):
                systemone.validate_backend({**manifest, "kind": kind})
        with self.assertRaises(ValueError):
            systemone.validate_backend({**manifest, "protocol": "something-else/v1"})

    def test_confidence_floor_and_calibration_pin_come_from_the_manifest(self):
        case = make_case()
        transcript = make_transcript()
        uncalibrated = systemone.judge_case(case, transcript, FakeBackend())
        self.assertFalse(uncalibrated["calibrated"])
        self.assertEqual(uncalibrated["ratings"][0]["score"], 2)
        pinned = systemone.default_manifest(minimum_confidence=0.95, calibration_sha256="ab" * 32)
        strict = systemone.judge_case(case, transcript, FakeBackend(), manifest=pinned)
        self.assertTrue(strict["calibrated"])
        self.assertEqual(strict["backend_manifest"]["kind"], "model_api")
        self.assertIsNone(strict["ratings"][0]["score"])
        self.assertEqual(strict["abstentions"], {"correctness": "below-confidence-floor"})


class MalformedAnswerTests(unittest.TestCase):
    def corrupt(self, variant, answers):
        answers = dict(answers)
        if variant == "missing":
            answers.pop("d1.score", None)
            return answers
        if variant == "wrong_type":
            answers["d1.score"] = {"type": "choice", "choice": "self_contained_reasoning",
                                   "probabilities": {"self_contained_reasoning": 1.0},
                                   "confidence": 0.9}
        elif variant == "bad_probability":
            answers["d1.score"] = {"type": "score", "score": 2.0, "legend": {"0": "w"},
                                   "probabilities": {"0": 0.1, "1": 0.1, "2": 1.5},
                                   "confidence": 0.9}
        elif variant == "bool_probability":
            answers["d1.score"] = {"type": "score", "score": 2.0, "legend": {"0": "w"},
                                   "probabilities": {"0": True, "1": 0.5, "2": 0.5},
                                   "confidence": 0.9}
        elif variant == "unknown_choice":
            answers["d1.support"] = {"type": "choice", "choice": "invented",
                                     "probabilities": {"invented": 1.0}, "confidence": 0.9}
        elif variant == "bad_judgeable":
            answers["d1.judgeable"] = {"type": "noul", "noul": "certain"}
        return answers

    def test_partial_batch_degrades_without_failing(self):
        for variant in ("missing", "wrong_type", "bad_probability", "bool_probability",
                        "unknown_choice", "bad_judgeable"):
            with self.subTest(variant=variant):
                case = make_case(("correctness", "responsiveness"))
                transcript = make_transcript()
                honest = FakeBackend()

                def dispatch(payload):
                    raw = honest(payload)
                    return {"answers": self.corrupt(variant, raw["answers"]), "usage": raw["usage"]}

                receipt = systemone.judge_case(case, transcript, dispatch)
                self.assertEqual(receipt["status"], "reviewed")
                self.assertEqual(receipt["ratings"][0]["score"], 2)
                self.assertIsNone(receipt["ratings"][1]["score"])
                self.assertEqual(receipt["ratings"][1]["support"], "unverifiable")
                self.assertEqual(receipt["abstentions"]["responsiveness"], "missing-answer")

    def test_decode_response_keeps_partial_answers_and_drops_unknown_keys(self):
        questions = {"d0.score": systemone.score_question(
                         {"label": "correctness", "anchors": ["z", "o", "t"]}),
                     "d0.judgeable": systemone.judgeable_question({"label": "correctness"})}
        raw = {"answers": {
            "d0.score": {"type": "score", "score": 1.0, "legend": {"0": "w"},
                         "probabilities": {"0": 0.2, "1": 0.8}, "confidence": 0.9},
            "d0.judgeable": {"type": "noul", "noul": "junk"},
            "d9.unknown": {"type": "noul", "noul": 0.5}}}
        answers, _ = systemone.decode_response(questions, raw)
        self.assertEqual(list(answers), ["d0.score"])
        # A Noul carries no confidence: decoding must not invent one.
        questions = {"d0.judgeable": systemone.judgeable_question({"label": "correctness"})}
        answers, _ = systemone.decode_response(
            questions, {"answers": {"d0.judgeable": {"type": "noul", "noul": 0.9}}})
        self.assertEqual(answers["d0.judgeable"], {"type": "noul", "noul": 0.9})


class ProviderErrorTests(unittest.TestCase):
    def test_errors_fail_closed_without_leaking_provider_text(self):
        case = make_case()
        transcript = make_transcript()

        def dispatch(_payload):
            raise RuntimeError("SECRET-KEY-MATERIAL")

        receipt = systemone.judge_case(case, transcript, dispatch)
        self.assertEqual(receipt["status"], "unscored")
        self.assertEqual(receipt["error"]["type"], "RuntimeError")
        self.assertNotIn("SECRET-KEY-MATERIAL", json.dumps(receipt))
        self.assertEqual(receipt["abstentions"], {"correctness": "backend-error"})
        rating = receipt["ratings"][0]
        self.assertIsNone(rating["score"])
        self.assertEqual(rating["reason"], systemone.ERROR_REASON)
        self.assertEqual(rating["uncertainty"],
                         systemone.UNCERTAINTIES["backend-error"])


if __name__ == "__main__":
    unittest.main()
