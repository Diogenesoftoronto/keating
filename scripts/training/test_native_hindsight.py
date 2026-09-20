"""Authored mock provider evidence only. No credentials or hosted inference."""
from copy import deepcopy
import hashlib
import io
from contextlib import redirect_stdout
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import native_hindsight as nh
import native_training as nt
import native_tinker_update as nu
import native_tinker_sampler as ns
import test_native_training as fixtures


MODEL = {"provider": "tinker", "id": ns.MODEL, "revision": "tinker://MOCK-behavior:train:0/sampler_weights/frozen0"}
TOKENIZER = {"id": ns.MODEL, "revision": ns.HF_REVISION, "chat_template_hash": ns.HF_TEMPLATE_HASH}


def inputs(accepted=True, branch="a", ui=False, multiple_actions=False):
    # A fixture exercising production validation shapes, not evidence of a run.
    with patch.object(fixtures, "MODEL", MODEL), patch.object(fixtures, "TOKENIZER", TOKENIZER):
        episode = fixtures.fixture_episode(branch=branch, ui=ui)
        if multiple_actions:
            extra = {"role": "assistant", "content": [{"type": "text", "text": "SECOND_TUTOR_ACTION"}],
                     "model": MODEL["id"], "provider": MODEL["provider"], "stopReason": "stop"}
            for event in episode["ledger"]:
                if event["kind"] == "runtime_step":
                    event["payload"]["messages"].insert(3, deepcopy(extra))
                    if event["payload"]["index"] == 1:
                        event["payload"]["message_start_index"] += 1
            actor_event = deepcopy(next(e for e in episode["ledger"] if e["kind"] == "actor_message"))
            actor_event["payload"]["message"] = extra
            at = next(i for i, e in enumerate(episode["ledger"]) if e["kind"] == "state_snapshot")
            episode["ledger"].insert(at, actor_event)
            fixtures.reseal_episode(episode)
            requests = []
            for step in episode["runtime"]["steps"]:
                for index, message in enumerate(step["messages"]):
                    if index >= step["message_start_index"] and message["role"] == "assistant":
                        request = deepcopy(episode["runtime"]["requests"][0])
                        request["data"]["index"] = len(requests)
                        request["data"]["context"]["messages"] = step["messages"][:index]
                        requests.append(request)
            episode["runtime"]["requests"] = requests
        episode["measurement"] = episode["runtime"]["measurement"] = "model_episode"
        for request in episode["runtime"]["requests"]:
            request["data"]["payload"] = {"model": ns.MODEL, "messages": [
                {"role": "system", "content": "MOCK original tutor context"},
                {"role": "user", "content": "INITIAL_LEARNER"}], "tools": [], "max_tokens": 10}
        capture = fixtures.fixture_capture(episode)
        capture["source"].update(kind="provider_capture", generation_hash="1" * 64,
            probability_hash="2" * 64, roles_hash="3" * 64,
            raw_record_hashes={k: str(i) * 64 for i, k in enumerate(("prepared", "sampled", "parsed"), 4)},
            renderer={"id": ns.RENDERER, "revision": ns.RENDERER_HASH})
        capture = nt.seal(capture, "capture_hash")
        review = fixtures.fixture_review(episode, capture)
        review.update(accepted=accepted, reviewer={"kind": "human", "id": "MOCK-independent-reviewer"})
        review = nt.seal(review, "review_hash")
    return episode, capture, review


class Renderer:
    audit = {"kind": "authored_renderer_fixture"}
    def __init__(self, original=None, prefix=None):
        self.original = original or [10, 11, 12]
        self.prefix = prefix or [30, 31, 32, 33, 34]
        self.calls = []
    def render(self, messages, tools):
        self.calls.append(deepcopy((messages, tools)))
        return list(self.prefix if messages[-1]["content"].startswith(nh.FEEDBACK_INTRO) else self.original)


def config_for(capture):
    return nt.seal({"schema_version": 1, "method": "sdpo",
        "model": {"provider": "tinker", "id": ns.MODEL, "revision": "tinker://MOCK-initial/weights/step0"},
        "tokenizer": TOKENIZER, "project_id": "MOCK-project",
        "capture_hashes": [capture["capture_hash"]], "allowed_behavior_revisions": [MODEL["revision"]],
        "learning_rate": 1e-5, "epsilon": .2, "max_abs_log_ratio": 2, "advantage_cap": 3,
        "ttl_seconds": 3600, "timeout_seconds": 30,
        "rates": {"model_id": ns.MODEL, "source": "MOCK-not-market-prices", "verified_on": "2026-09-13",
            "prefill_usd_per_million": "1.00", "train_usd_per_million": "3.00",
            "fixed_usd": "0.10", "safety_factor": 5}}, "config_hash")


def manifest_for(bundle):
    return nt.seal({"schema_version": 1, "export_hash": bundle["export_hash"],
        "registry_revision": "MOCK-registry", "approved_by": "MOCK-admission-reviewer",
        "episodes": bundle["episodes"], "families": [{"family": "authored-family", "split": "train",
            "protected": False, "aliases": ["authored-family"], "sources": [{"dataset": "MOCK-authored",
                "revision": "MOCK-v1", "record_id": "MOCK-case-1", "original_split": "train",
                "record_sha256": "d" * 64}]}]}, "split_hash")


class HindsightTests(unittest.TestCase):
    def setUp(self):
        self.episode, self.capture, self.review = inputs()
        self.config = config_for(self.capture)
        self.renderer = Renderer()

    def envelopes(self):
        return ({"schema_version": 1, "captures": [self.capture]},
                {"schema_version": 1, "reviews": [self.review]})

    def prepare(self, **kwargs):
        return nh.prepare_hindsight(self.episode, self.capture, self.review, self.config,
                                     renderer=kwargs.get("renderer", self.renderer))

    def pack(self):
        captures, reviews = self.envelopes()
        bundle = nt.build_exports([self.episode], captures, reviews)
        manifest = manifest_for(bundle)
        return nh.prepare_signals([self.episode], captures, reviews, manifest,
                                  self.config, renderer=self.renderer), manifest

    def test_actual_event_projection_has_artifact_and_next_turn_without_later_tutor(self):
        prepared = self.prepare()
        packet = nt.native_json(prepared["feedback"])
        for expected in ("VISIBLE_ARTIFACT", "LEARNER_FUTURE", "learner_delivery_evidence"):
            self.assertIn(expected, packet)
        for forbidden in ("GOLD_PRIVATE_FUTURE", "STATE_PRIVATE", "LATER_TUTOR_MUST_NOT_LEAK", "TOOL_PRIVATE_RESULT"):
            self.assertNotIn(forbidden, packet)
        self.assertIsNone(prepared["feedback"]["outcome"])
        self.assertEqual(prepared["feedback"]["outcome_status"], "unknown")
        self.assertEqual(prepared["feature"]["branch_id"], self.capture["branch_id"])

    def test_target_ids_are_original_and_prefix_masks_are_separate(self):
        prepared = self.prepare()
        self.assertEqual(prepared["teacher_prefix"]["completion_token_ids"], [20, 21, 22])
        self.assertEqual(prepared["teacher_loss_mask"], [0, 0, 0, 0, 1, 1, 1])
        self.assertEqual(prepared["student_segment"]["loss_mask"], [0, 0, 1, 1, 1])
        self.assertEqual([v for v, mask in zip(prepared["teacher_target_tokens"], prepared["teacher_loss_mask"]) if mask],
                         self.capture["completion_token_ids"])
        self.assertEqual(self.renderer.calls[1][0][:-1], self.renderer.calls[0][0])
        self.assertTrue(self.renderer.calls[1][0][-1]["content"].startswith(nh.FEEDBACK_INTRO))
        self.assertIsNone(prepared["teacher_scores"])
        self.assertIsNone(prepared["teacher_snapshot"])
        self.assertFalse(prepared["hosted_weight_revision_attested"])

    def test_original_prefix_reconstruction_mismatch_rejected(self):
        with self.assertRaisesRegex(ValueError, "original_rendered_prefix_mismatch"):
            self.prepare(renderer=Renderer(original=[99, 11, 12]))

    def test_distinct_teacher_prefix_required(self):
        with self.assertRaisesRegex(ValueError, "distinct_teacher_prefix"):
            self.prepare(renderer=Renderer(prefix=[10, 11, 12]))

    def test_missing_behavior_and_attestation_rejected(self):
        self.capture["behavior_logprobs"] = None
        self.capture = nt.seal(self.capture, "capture_hash")
        with self.assertRaises(ValueError):
            self.prepare()
        self.episode, self.capture, self.review = inputs()
        self.capture["source"].pop("probability_hash")
        self.capture = nt.seal(self.capture, "capture_hash")
        with self.assertRaisesRegex(ValueError, "attestation"):
            self.prepare()

    def test_cross_branch_capture_rejected_even_if_resealed(self):
        self.capture["branch_id"] = "another-branch"
        self.capture = nt.seal(self.capture, "capture_hash")
        with self.assertRaises(ValueError):
            self.prepare()

    def test_delivered_only_review_cannot_supply_next_event(self):
        with patch.object(fixtures, "MODEL", MODEL), patch.object(fixtures, "TOKENIZER", TOKENIZER):
            review = fixtures.fixture_review(self.episode, self.capture, "delivered")
        review["reviewer"] = {"kind": "human", "id": "MOCK-reviewer"}
        self.review = nt.seal(review, "review_hash")
        with self.assertRaisesRegex(ValueError, "next_event"):
            self.prepare()

    def test_stop_without_delivered_reply_cannot_become_hindsight(self):
        first = next(i for i, e in enumerate(self.episode["ledger"]) if e["kind"] == "learner_intent")
        end = deepcopy(self.episode["ledger"][-1])
        self.episode["ledger"] = self.episode["ledger"][:first + 1] + [end]
        self.episode["ledger"][first]["payload"]["intent"] = {"kind": "stop"}
        self.episode["runtime"]["requests"] = self.episode["runtime"]["requests"][:1]
        fixtures.reseal_episode(self.episode)
        self.assertFalse(any(f["boundary"] == "retrospective"
                             for f in nt.feature_inputs(nt.validate_episode(self.episode))))
        source = deepcopy(self.capture["source"])
        with patch.object(fixtures, "MODEL", MODEL), patch.object(fixtures, "TOKENIZER", TOKENIZER):
            capture = fixtures.fixture_capture(self.episode)
            self.capture = nt.seal({**capture, "source": source}, "capture_hash")
            review = fixtures.fixture_review(self.episode, self.capture, "delivered")
        self.review = nt.seal({**review, "reviewer": {"kind": "human", "id": "MOCK-reviewer"}}, "review_hash")
        self.config = config_for(self.capture)
        with self.assertRaisesRegex(ValueError, "unique_delivered_next_event"):
            self.prepare()

    def test_review_must_bind_to_exact_feature(self):
        self.review["evidence_hash"] = "e" * 64
        self.review = nt.seal(self.review, "review_hash")
        with self.assertRaisesRegex(ValueError, "review_temporal_boundary"):
            self.prepare()

    def test_multiple_actor_actions_cannot_borrow_same_next_event(self):
        self.episode, self.capture, self.review = inputs(multiple_actions=True)
        self.config = config_for(self.capture)
        nt.validate_episode(self.episode)  # Valid runtime; causal attribution is ambiguous.
        with self.assertRaisesRegex(ValueError, "ambiguous_multi_action_feedback_boundary"):
            self.prepare()

    def test_ui_feedback_uses_actual_receipt_and_never_invents_assessment(self):
        self.episode, self.capture, self.review = inputs(ui=True)
        self.config = config_for(self.capture)
        prepared = self.prepare()
        latest = prepared["feature"]["latest_allowed_event_id"]
        event = next(e for e in self.episode["ledger"] if e["event_id"] == latest)
        self.assertEqual(event["kind"], "action_receipt")
        self.assertIn("LEARNER_FUTURE", nt.native_json(prepared["feedback"]))
        self.assertIsNone(prepared["feedback"]["outcome"])

    def test_context_bound_includes_sdk_extra_sample_token(self):
        with patch.object(nh, "CONTEXT_TOKENS", 8):
            with self.assertRaisesRegex(ValueError, "hindsight_context_overflow"):
                self.prepare()
        with patch.object(nh, "CONTEXT_TOKENS", 9):
            self.prepare()

    def test_config_checkpoint_tokenizer_method_and_capture_pins(self):
        for field, key, value in (("model", "revision", "tinker://run/weights/latest"),
                                  ("model", "id", "Qwen/Qwen3.5-9B"),
                                  ("tokenizer", "revision", "main")):
            config = deepcopy(self.config)
            config[field][key] = value
            with self.subTest(field=field, key=key), self.assertRaises(ValueError):
                nh.validate_config(nt.seal(config, "config_hash"))
        for method in ("sft", "ppo"):
            config = nt.seal({**self.config, "method": method}, "config_hash")
            with self.assertRaisesRegex(ValueError, "existing_sdpo_config"):
                nh.validate_config(config)
        self.config = nt.seal({**self.config, "capture_hashes": ["a" * 64]}, "config_hash")
        with self.assertRaisesRegex(ValueError, "missing_accepted_capture"):
            self.pack()

    def test_rejected_feedback_never_promoted_to_sdpo_or_sft(self):
        self.episode, self.capture, self.review = inputs(accepted=False)
        prepared = self.prepare()
        self.assertEqual(prepared["review_decision"], "rejected")
        captures, reviews = self.envelopes()
        bundle = nt.build_exports([self.episode], captures, reviews)
        self.assertEqual(bundle["sft"], [])
        self.assertEqual(bundle["hindsight"], [])
        with patch.object(nh, "QwenFeedbackRenderer", side_effect=AssertionError("must not load")):
            with self.assertRaisesRegex(ValueError, "missing_accepted_capture"):
                nh.prepare_signals([self.episode], captures, reviews, manifest_for(bundle), self.config)

    def test_full_existing_prepare_update_accepts_signals_and_owns_scoring(self):
        original = deepcopy((self.episode, self.capture, self.review, self.config))
        result, manifest = self.pack()
        plan = nu.prepare_update(result["exports"], manifest, self.config, result["signals"])
        self.assertEqual(plan, result["update_plan"])
        self.assertIn("freeze_teacher", plan["phases"])
        self.assertIn("teacher_score_0", plan["phases"])
        self.assertIn("optimizer", plan["phases"])
        self.assertEqual(plan["rows"][0]["signal"]["teacher_prefix"]["completion_token_ids"], [20, 21, 22])
        self.assertEqual(original, (self.episode, self.capture, self.review, self.config))
        nu.sealed(result["prefix_proofs"], "proofs_hash")
        nu.sealed(result["prefix_proofs"]["proofs"][0], "proof_hash")

    def test_updater_rejects_resealed_target_swap(self):
        result, manifest = self.pack()
        signals = result["signals"]
        prefix = signals["signals"][0]["teacher_prefix"]
        prefix["completion_token_ids"][-1] = 999
        signals["signals"][0]["teacher_prefix"] = nt.seal(prefix, "prefix_hash")
        with self.assertRaisesRegex(ValueError, "teacher_target_alignment"):
            nu.prepare_update(result["exports"], manifest, self.config, nt.seal(signals, "signals_hash"))

    def test_multi_branch_signals_keep_full_export_hash_and_selection_order(self):
        other_episode, other_capture, other_review = inputs(branch="b")
        episodes = [self.episode, other_episode]
        captures = {"schema_version": 1, "captures": [self.capture, other_capture]}
        reviews = {"schema_version": 1, "reviews": [self.review, other_review]}
        config = nt.seal({**self.config,
            "capture_hashes": [other_capture["capture_hash"], self.capture["capture_hash"]]}, "config_hash")
        bundle = nt.build_exports(episodes, captures, reviews)
        result = nh.prepare_signals(episodes, captures, reviews, manifest_for(bundle), config, renderer=self.renderer)
        self.assertEqual(result["signals"]["export_hash"], bundle["export_hash"])
        self.assertEqual([s["capture_hash"] for s in result["signals"]["signals"]], config["capture_hashes"])
        self.assertEqual([p["feature"]["branch_id"] for p in result["prefix_proofs"]["proofs"]], ["b", "a"])

    def test_holdout_and_protected_family_guards_are_delegated(self):
        captures, reviews = self.envelopes()
        bundle = nt.build_exports([self.episode], captures, reviews)
        for field, value, code in (("split", "test", "nontraining_family"), ("protected", True, "protected_family")):
            manifest = manifest_for(bundle)
            manifest["families"][0][field] = value
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, code):
                nh.prepare_signals([self.episode], captures, reviews, nt.seal(manifest, "split_hash"),
                                   self.config, renderer=self.renderer)
        manifest = manifest_for(bundle)
        manifest["export_hash"] = "a" * 64
        with self.assertRaisesRegex(ValueError, "split_export_pin"):
            nh.prepare_signals([self.episode], captures, reviews, nt.seal(manifest, "split_hash"),
                               self.config, renderer=self.renderer)

    def test_fidelity_failure_remains_explicit_feedback_with_unknown_learning(self):
        self.review["feedback"] = {"learner_role_fidelity": "failed", "status": "requires_audit"}
        self.review = nt.seal(self.review, "review_hash")
        result, _ = self.pack()
        packet = result["prefix_proofs"]["proofs"][0]["feedback"]
        self.assertEqual(packet["review_feedback"], self.review["feedback"])
        self.assertIsNone(packet["outcome"])
        self.assertEqual(packet["outcome_status"], "unknown")

    def test_projection_excludes_action_transcript_and_review_prose_keeps_actual_learner(self):
        actor = next(e for e in self.episode["ledger"] if e["kind"] == "actor_message")
        self.review["feedback"] = {
            "learner_role_fidelity": "failed", "status": "requires_audit",
            "checks": {"correctness": {"verdict": "pass", "reasoning":
                "DELIVERED_ACTION GOLD_PRIVATE_FUTURE LATER_TUTOR_MUST_NOT_LEAK",
                "citations": [{"event_id": actor["event_id"], "event_hash": actor["hash"],
                               "quote": "DELIVERED_ACTION"}]}},
            "unrestricted_notes": "STATE_PRIVATE TOOL_PRIVATE_RESULT"}
        self.review = nt.seal(self.review, "review_hash")
        prepared = self.prepare()
        projection = prepared["feedback_projection"]
        rendered_feedback = self.renderer.calls[1][0][-1]["content"]
        for forbidden in ("DELIVERED_ACTION", "VISIBLE_ARTIFACT", "GOLD_PRIVATE_FUTURE",
                          "LATER_TUTOR_MUST_NOT_LEAK", "STATE_PRIVATE", "TOOL_PRIVATE_RESULT"):
            self.assertNotIn(forbidden, rendered_feedback)
        self.assertIn("DELIVERED_ACTION", nt.native_json(prepared["feedback"]))
        self.assertIn("GOLD_PRIVATE_FUTURE", nt.native_json(prepared["review"]))
        self.assertIn("LEARNER_FUTURE", rendered_feedback)
        self.assertEqual(projection["review"]["learner_role_fidelity"], "failed")
        self.assertEqual(projection["review"]["status"], "requires_audit")
        self.assertIsNone(projection["outcome"])
        span = projection["review"]["checks"][0]["citations"][0]
        self.assertEqual(span["span_sha256"], hashlib.sha256(b"DELIVERED_ACTION").hexdigest())
        self.assertEqual((span["start"], span["end"]), (0, len("DELIVERED_ACTION")))
        self.assertNotIn("quote", span)

    def test_legitimate_short_answer_repeated_by_learner_is_not_banned(self):
        original = fixtures.fixture_episode
        with patch.object(fixtures, "fixture_episode", side_effect=lambda **kw:
                          original(reply="LEARNER_FUTURE", **kw)):
            self.episode, self.capture, self.review = inputs()
        self.config = config_for(self.capture)
        prepared = self.prepare()
        projection = prepared["feedback_projection"]
        self.assertEqual(projection["next_learner_event"]["intent"],
                         {"kind": "message", "text": "LEARNER_FUTURE"})
        self.assertIn("LEARNER_FUTURE", self.renderer.calls[1][0][-1]["content"])
        self.assertNotIn("input_events", projection)
        self.assertNotIn("delivered_observation", projection)

    def test_projected_ui_intent_preserves_submission_without_artifact_transcript(self):
        self.episode, self.capture, self.review = inputs(ui=True)
        self.config = config_for(self.capture)
        prepared = self.prepare()
        projection = prepared["feedback_projection"]
        actual = next(e for e in self.episode["ledger"] if e["kind"] == "learner_intent")
        self.assertEqual(projection["next_learner_event"]["intent"], actual["payload"]["intent"])
        self.assertEqual(projection["learner_delivery_evidence"]["event_id"],
                         prepared["feature"]["latest_allowed_event_id"])
        for excluded in ("VISIBLE_ARTIFACT", "DELIVERED_ACTION", "LATER_TUTOR_MUST_NOT_LEAK"):
            self.assertNotIn(excluded, self.renderer.calls[1][0][-1]["content"])
        self.assertIsNone(projection["outcome"])

    def test_citations_cannot_reach_private_history_future_or_wrong_hash(self):
        initial_review = deepcopy(self.review)
        private = next(e for e in self.episode["ledger"] if e["kind"] == "state_snapshot")
        future = [e for e in self.episode["ledger"] if e["kind"] == "actor_message"][-1]
        actor = next(e for e in self.episode["ledger"] if e["kind"] == "actor_message")
        cases = [(private, private["hash"], "STATE_PRIVATE"),
                 (future, future["hash"], "LATER_TUTOR_MUST_NOT_LEAK"),
                 (actor, "0" * 64, "DELIVERED_ACTION")]
        for event, digest, quote in cases:
            self.review = deepcopy(initial_review)
            self.review["feedback"] = {"checks": {"correctness": {"verdict": "pass", "citations": [
                {"event_id": event["event_id"], "event_hash": digest, "quote": quote}]}}}
            self.review = nt.seal(self.review, "review_hash")
            with self.subTest(kind=event["kind"], digest=digest), self.assertRaisesRegex(ValueError, "citation_event_boundary"):
                self.prepare()
        self.assertEqual(self.renderer.calls, [])

    def test_citation_is_a_unique_exact_visible_span_not_a_private_tool_field(self):
        actor = next(e for e in self.episode["ledger"] if e["kind"] == "actor_message")
        for quote, extra in (("E", {}), ("NOT_RECORDED", {}),
                             ("fixtures/task.txt", {}),
                             ("DELIVERED_ACTION", {"field_path": ["private"], "start": 0, "end": 16})):
            citation = {"event_id": actor["event_id"], "event_hash": actor["hash"], "quote": quote, **extra}
            self.review["feedback"] = {"checks": {"correctness": {"verdict": "pass", "citations": [citation]}}}
            self.review = nt.seal(self.review, "review_hash")
            with self.subTest(quote=quote), self.assertRaisesRegex(ValueError, "citation_span_missing_or_ambiguous"):
                self.prepare()
        citation.update(quote="E", field_path=["payload", "message", "content", 0, "text"], start=1, end=2)
        self.review["feedback"]["checks"]["correctness"]["citations"] = [citation]
        self.review = nt.seal(self.review, "review_hash")
        span = self.prepare()["feedback_projection"]["review"]["checks"][0]["citations"][0]
        self.assertEqual((span["start"], span["end"]), (1, 2))

    def test_projection_limits_and_review_codes_fail_before_rendering(self):
        actor = next(e for e in self.episode["ledger"] if e["kind"] == "actor_message")
        citation = {"event_id": actor["event_id"], "event_hash": actor["hash"], "quote": "DELIVERED_ACTION"}
        cases = [({"checks": {"c" + str(i): {"verdict": "pass"} for i in range(25)}}, "checks_bound"),
                 ({"checks": {"correctness": {"verdict": "pass", "citations": [citation] * 17}}}, "citation_total_bound"),
                 ({"checks": {"correctness": {"verdict": "pass", "citations": [{**citation, "quote": "x" * 161}]}}}, "citation_span_bound"),
                 ({"checks": {"correctness": {"verdict": "unrestricted private answer"}}}, "check_code"),
                 ({"status": "GOLD_PRIVATE_FUTURE"}, "review_tag"),
                 ({"learner_role_fidelity": "failed", "scope": {"learner_role_fidelity": "passed"}}, "review_tag")]
        for feedback, error in cases:
            self.review = nt.seal({**self.review, "feedback": feedback}, "review_hash")
            with self.subTest(error=error), self.assertRaisesRegex(ValueError, error):
                self.prepare()
        self.assertEqual(self.renderer.calls, [])

    def test_total_cited_characters_bounded_even_with_valid_individual_spans(self):
        original = fixtures.fixture_episode
        text = "uniquely cited action " + "x" * 80
        with patch.object(fixtures, "fixture_episode", side_effect=lambda **kw: original(reply=text, **kw)):
            self.episode, self.capture, self.review = inputs()
        self.config = config_for(self.capture)
        actor = next(e for e in self.episode["ledger"] if e["kind"] == "actor_message")
        citation = {"event_id": actor["event_id"], "event_hash": actor["hash"], "quote": text}
        self.review = nt.seal({**self.review, "feedback": {"checks": {"correctness": {
            "verdict": "pass", "citations": [citation] * 11}}}}, "review_hash")
        with self.assertRaisesRegex(ValueError, "citation_total_bound"):
            self.prepare()

    def test_large_actual_learner_intent_fails_instead_of_truncating_or_repairing(self):
        original = fixtures.fixture_episode
        text = "é" * 8300  # Within native character limit, over projection UTF-8 byte limit.
        def replace(value):
            if type(value) is dict:
                return {key: replace(item) for key, item in value.items()}
            if type(value) is list:
                return [replace(item) for item in value]
            return text if value == "LEARNER_FUTURE" else value
        def fixture(**kwargs):
            episode = replace(original(**kwargs))
            fixtures.reseal_episode(episode)
            return episode
        with patch.object(fixtures, "fixture_episode", side_effect=fixture):
            self.episode, self.capture, self.review = inputs()
        self.config = config_for(self.capture)
        before = deepcopy((self.episode, self.capture, self.review))
        with self.assertRaisesRegex(ValueError, "projected_learner_intent_overflow"):
            self.prepare()
        self.assertEqual(self.renderer.calls, [])
        self.assertEqual(before, (self.episode, self.capture, self.review))

    def test_projection_contract_hash_and_rendered_prefix_survive_existing_updater(self):
        result, manifest = self.pack()
        proof = result["prefix_proofs"]["proofs"][0]
        projected = proof["feedback_projection"]
        nu.sealed(projected, "projection_hash")
        self.assertEqual(projected["kind"], nh.PROJECTION_VERSION)
        self.assertEqual(projected["contract_hash"], nt.native_hash(proof["feedback_projection_contract"]))
        self.assertEqual(projected["source_feedback_hash"], proof["feedback"]["feedback_hash"])
        self.assertEqual(projected["latest_allowed_event_id"], proof["review"]["latest_allowed_event_id"])
        prefix = proof["teacher_prefix"]
        self.assertEqual(prefix["rendered_messages_hash"], nt.native_hash(proof["teacher_rendered_messages"]))
        self.assertEqual(proof["teacher_rendered_messages"][-1]["content"], nh.FEEDBACK_INTRO + nt.native_json(projected))
        plan = nu.prepare_update(result["exports"], manifest, self.config, result["signals"])
        self.assertEqual(plan["rows"][0]["signal"]["teacher_prefix"], prefix)
        self.assertEqual(plan["rows"][0]["signal"]["feedback"], proof["feedback"])
        self.assertEqual(prefix["feedback_hash"], proof["feedback"]["feedback_hash"])
        self.assertEqual(prefix["teacher_feedback_projection"], projected)

    def test_rejected_diagnostic_projection_retains_failed_decision(self):
        self.episode, self.capture, self.review = inputs(accepted=False)
        prepared = self.prepare()
        self.assertFalse(prepared["feedback_projection"]["review"]["accepted"])
        self.assertEqual(prepared["review_decision"], "rejected")

    def test_preparation_cannot_reserve_create_service_score_or_use_credentials(self):
        with patch.object(nu.BudgetLedger, "reserve", side_effect=AssertionError("paid")), \
             patch.object(nu, "execute_update", side_effect=AssertionError("paid")), \
             patch.object(nh, "QwenFeedbackRenderer", return_value=self.renderer), \
             patch.dict("os.environ", {"TINKER_API_KEY": "SECRET_SENTINEL"}):
            captures, reviews = self.envelopes()
            bundle = nt.build_exports([self.episode], captures, reviews)
            result = nh.prepare_signals([self.episode], captures, reviews, manifest_for(bundle), self.config)
        self.assertNotIn("SECRET_SENTINEL", nt.native_json(result))
        self.assertFalse(hasattr(nh, "TinkerTeacherScorer"))
        self.assertFalse(hasattr(nh, "execute_hindsight"))

    def test_private_exclusive_journal_and_complete_manifest(self):
        result, _ = self.pack()
        base = nh.ROOT / ".keating/native-learning"
        base.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="hindsight-test-", dir=base) as temp:
            output = Path(temp) / "prepared"
            nh.write_prepared(output, result)
            self.assertEqual(output.stat().st_mode & 0o777, 0o700)
            manifest = nt.load_json(output / "prepared.json")
            self.assertFalse(manifest["provider_dispatched"])
            self.assertEqual(manifest["status"], "prepared_only")
            for filename, digest in manifest["files"].items():
                path = output / filename
                before = path.read_bytes()
                self.assertEqual(hashlib.sha256(before).hexdigest(), digest)
                self.assertEqual(path.stat().st_mode & 0o777, 0o600)
                with self.assertRaises(FileExistsError):
                    nh.write_once(path, {})
                self.assertEqual(before, path.read_bytes())
            with self.assertRaises(FileExistsError):
                nh.write_prepared(output, result)
            outside = Path(temp).parent.parent.parent.parent / "not-private.json"
            with self.assertRaises(ValueError):
                nh.ignored_path(outside)
            link = Path(temp) / "symlink"
            link.symlink_to(output, target_is_directory=True)
            with self.assertRaises(ValueError):
                nh.ignored_path(link / "new.json")

    def test_cli_uses_existing_config_and_only_writes_preparation(self):
        result, manifest = self.pack()
        base = nh.ROOT / ".keating/native-learning"
        base.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(prefix="hindsight-cli-", dir=base) as temp:
            captures, reviews = self.envelopes()
            values = dict(episode=self.episode, captures=captures, reviews=reviews, splits=manifest, config=self.config)
            args = ["signals"]
            for name, value in values.items():
                path = Path(temp) / (name + ".json")
                nh.write_once(path, value)
                args.extend(["--" + name, str(path)])
            output = Path(temp) / "output"
            args.extend(["--output", str(output)])
            text = io.StringIO()
            with patch.object(nh, "QwenFeedbackRenderer", return_value=Renderer()), redirect_stdout(text):
                nh.main(args)
            self.assertIn('"provider_dispatched": false', text.getvalue())
            self.assertEqual(nt.load_json(output / "signals.json"), result["signals"])


if __name__ == "__main__":
    unittest.main()
