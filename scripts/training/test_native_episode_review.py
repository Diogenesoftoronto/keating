# /// script
# requires-python = ">=3.12,<3.14"
# dependencies = []
# ///
"""Authored contract fixtures only: no real model responses or quality labels."""
from copy import deepcopy
from pathlib import Path
import tempfile
import unittest
import json
import hashlib

import native_training as nt
import native_episode_review as review
from test_native_training import fixture_episode, fixture_capture, reseal_episode, STAMP


class EpisodeReviewTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory(prefix="authored-episode-review-")
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.original = {"qid": 1, "question": "AUTHORED: Two dogs, three cats, twice as many fish as dogs and cats. Total pets?",
            "student_incorrect_solution": "AUTHORED wrong attempt: ten pets.",
            "ground_truth": "AUTHORED reference: five non-fish pets, ten fish, fifteen total.",
            "conversation": "SOURCE_FUTURE_MUST_NOT_LEAK", "self-correctness": "Yes", "fixture_only": True}
        body = (json.dumps(self.original) + "\n").encode()
        self.source_path = self.root / "train.jsonl"
        self.source_path.write_bytes(body)
        source = {"dataset": "mathdial", "revision": "a" * 40, "record_id": "train.jsonl#row=0",
                  "sha256": review.canonical_hash(self.original), "fixture_only": True}
        opening = "Task supplied in the source:\n" + self.original["question"] + "\n\nConversation available before your next tutoring response:\nLearner: " + self.original["student_incorrect_solution"]
        self.scenario = {"id": "authored", "family": "authored-family", "source": source,
            "actor": {"opening_message": opening}, "evaluation_only": {"original": self.original,
                "asset": {"path": "train.jsonl", "sha256": hashlib.sha256(body).hexdigest()},
                "cut": {"field": "student_incorrect_solution", "policy": "before-original-conversation"},
                "admission": {"purpose": "development", "protected": False}}}
        self.source_review = {"decision": "approved", "approved": True, "reviewer_source_kind": "model_review",
            "source_sha256": source["sha256"], "content_sha256": review.canonical_hash(self.scenario),
            "fixture_only": True}
        self.episode = fixture_episode(reply="AUTHORED tutor question: what does the doubled number count?")
        # Keep fixtures explicitly offline, while binding exact source/opening.
        def replace(value):
            if isinstance(value, dict):
                return {k: replace(v) for k, v in value.items()}
            if isinstance(value, list):
                return [replace(v) for v in value]
            return opening if value == "INITIAL_LEARNER" else value
        self.episode = replace(self.episode)
        self.episode["source"] = source
        self.episode["ledger"][0]["payload"].update(source=source, scenario_hash=nt.native_hash(self.scenario))
        last_observation = None
        for event in self.episode["ledger"]:
            if event["kind"] == "delivered_observation":
                event["payload"].update(documents=[], availableActions=[])
                event["payload"] = nt.seal(event["payload"], "observationHash")
                last_observation = event["payload"]["observationHash"]
            if event["kind"] == "learner_intent":
                event["payload"]["observation_hash"] = last_observation
        reseal_episode(self.episode)
        self.capture = fixture_capture(self.episode)
        self.captures = {"schema_version": 1, "captures": [self.capture]}
        self.packet = self.prepare()

    def prepare(self, captures=True):
        return review.prepare_review(self.episode, self.scenario, self.source_path, self.source_review,
            self.captures if captures else None, _allow_fixture=True)

    def form(self, packet=None):
        packet = packet or self.packet
        form = review.review_form(packet)
        form.update(reviewer={"kind": "authored_fixture", "id": "authored-independent-reviewer"},
            reviewed_at=STAMP, independence_statement="AUTHORED test judgment; no model or human review occurred.")
        for target, judgment in zip(packet["targets"], form["judgments"]):
            judgment["decision"] = "accept"
            for check in judgment["checks"].values():
                check.update(verdict="pass", reasoning="AUTHORED contract assertion only, not a measured quality verdict.",
                    citations=[{"event_id": target["target_id"], "event_hash": target["actor_event_hash"],
                                "quote": target["actor_text"]}])
        return form

    def compile(self, form, packet=None, captures=True):
        return review.compile_review(packet or self.packet, form, self.episode, self.scenario,
            self.source_path, self.source_review, self.captures if captures else None, _allow_fixture=True)

    def test_default_rejects_authored_episode(self):
        with self.assertRaisesRegex(nt.ExportError, "authored_episode_test_only"):
            review.prepare_review(self.episode, self.scenario, self.source_path, self.source_review, self.captures)

    def test_packet_excludes_simulator_future_source_future_and_state(self):
        serialized = json.dumps(self.packet)
        for forbidden in ("SOURCE_FUTURE_MUST_NOT_LEAK", "LEARNER_FUTURE", "LATER_TUTOR_MUST_NOT_LEAK", "STATE_PRIVATE", "TOOL_PRIVATE_RESULT", "self-correctness"):
            self.assertNotIn(forbidden, serialized)
        self.assertIn(self.original["ground_truth"], serialized)
        self.assertEqual(self.packet["feature"]["boundary"], "delivered")

    def test_pending_form_is_not_acceptance(self):
        form = self.form()
        form["judgments"] = review.review_form(self.packet)["judgments"]
        with self.assertRaisesRegex(nt.ExportError, "explicit_review_decision"):
            self.compile(form)

    def test_second_action_uses_prior_learner_context_but_cannot_rebind_first_review(self):
        packet = review.prepare_review(self.episode, self.scenario, self.source_path, self.source_review,
            self.captures, step_index=1, _allow_fixture=True)
        self.assertIn("LEARNER_FUTURE", json.dumps(packet["context_evidence"]))
        self.assertNotIn("SOURCE_FUTURE_MUST_NOT_LEAK", json.dumps(packet))
        self.assertNotEqual(packet["feature"]["feature_hash"], self.packet["feature"]["feature_hash"])
        self.assertIsNone(packet["targets"][0]["capture_hash"])
        with self.assertRaisesRegex(nt.ExportError, "judgment_packet_binding"):
            self.compile(self.form(), packet)

    def test_acceptance_reuses_native_sft_schema_but_fixture_is_ineligible(self):
        audit = self.compile(self.form())
        envelope = audit["training_reviews"]
        result = nt.build_exports([self.episode], self.captures, envelope)
        self.assertEqual(len(result["sft"]), 1)
        self.assertEqual(result["sft"][0]["status"], "fixture_only")
        self.assertFalse(result["sft"][0]["training_eligible"])
        self.assertEqual(audit["sft_eligible_records"], 0)
        self.assertIsNone(audit["learning_outcome"])
        self.assertEqual(envelope["reviews"][0]["capture_hash"], self.capture["capture_hash"])
        self.assertEqual(envelope["reviews"][0]["evidence_hash"], self.packet["feature"]["feature_hash"])

    def test_abstention_and_rejection_do_not_create_sft(self):
        for verdict, decision in (("unknown", "abstain"), ("fail", "reject")):
            form = self.form()
            form["judgments"][0]["checks"]["support_quality"]["verdict"] = verdict
            form["judgments"][0]["decision"] = decision
            audit = self.compile(form)
            result = nt.build_exports([self.episode], self.captures, audit["training_reviews"])
            self.assertEqual(result["sft"], [])
            self.assertEqual(len(audit["training_reviews"]["reviews"]), int(decision == "reject"))

    def test_missing_capture_keeps_reasoned_audit_without_sft_review(self):
        packet = self.prepare(captures=False)
        audit = self.compile(self.form(packet), packet, captures=False)
        self.assertEqual(audit["training_reviews"]["reviews"], [])
        self.assertEqual(audit["statuses"][0]["reason"], "missing_original_capture")

    def test_actor_and_simulator_identity_aliases_rejected(self):
        # Identity validator unit test only; this does not make the fixture real.
        packet = deepcopy(self.packet); packet["evidence_kind"] = "model_episode"
        for name in ("authored-tutor", "OTHER/AUTHORED-TUTOR", " authored-learner "):
            form = self.form()
            form["reviewer"] = {"kind": "independent_model", "id": "different-display-name",
                "model": {"provider": "test", "id": name, "revision": "authored-identity-test"}}
            with self.assertRaisesRegex(nt.ExportError, "self_review"):
                review.validate_reviewer(form, packet)

    def test_changed_capture_source_and_packet_rejected(self):
        form = self.form()
        changed = deepcopy(self.packet)
        changed["targets"][0]["actor_text"] = "forged"
        changed = nt.seal(changed, "packet_hash")
        with self.assertRaisesRegex(nt.ExportError, "stale_or_changed_review_packet"):
            self.compile(form, changed)
        self.captures["captures"][0]["completion_token_ids"][0] += 1
        with self.assertRaises(nt.ExportError):
            self.compile(form)
        self.captures["captures"][0] = self.capture
        self.source_path.write_text("changed source")
        with self.assertRaisesRegex(nt.ExportError, "source_asset_hash"):
            self.prepare()

    def test_forged_quote_or_future_citation_rejected(self):
        for field, value in (("quote", "I learned everything"), ("event_hash", "0" * 64), ("event_id", self.episode["ledger"][-1]["event_id"])):
            form = self.form()
            form["judgments"][0]["checks"]["math_correctness"]["citations"][0][field] = value
            with self.assertRaisesRegex(nt.ExportError, "citation_not_in_reviewed_evidence"):
                self.compile(form)

    def test_acceptance_requires_all_known_passes(self):
        form = self.form()
        form["judgments"][0]["checks"]["math_correctness"]["verdict"] = "unknown"
        with self.assertRaisesRegex(nt.ExportError, "decision_verdict_conflict"):
            self.compile(form)

    def test_new_artifacts_cannot_be_preapproved(self):
        packet = deepcopy(self.packet); packet["artifact_review_required"] = True
        with self.assertRaisesRegex(nt.ExportError, "separate_artifact_review_required"):
            review.validate_judgment(self.form()["judgments"][0], packet["targets"][0], packet)

    def test_unrequested_quality_score_field_rejected(self):
        form = self.form()
        form["judgments"][0]["learning_success"] = 1
        with self.assertRaisesRegex(nt.ExportError, "review_fields"):
            self.compile(form)

    def test_exclusive_output_keeps_existing_review(self):
        path = self.root / "review.json"
        review.write_new(path, {"original": True})
        with self.assertRaises(FileExistsError):
            review.write_new(path, {"original": False})
        self.assertEqual(json.loads(path.read_text()), {"original": True})


if __name__ == "__main__":
    unittest.main()
