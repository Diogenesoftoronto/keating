"""Authored evidence only: these integers/probabilities are NOT model captures."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

import native_training as nt


STAMP = "2026-09-13T12:00:00.000Z"
MODEL = {"provider": "authored", "id": "authored-tutor", "revision": "fixture-v1"}
TOKENIZER = {"id": "authored-tokenizer", "revision": "fixture-v1", "chat_template_hash": "b" * 64}


def fixture_episode(branch="a", reply="DELIVERED_ACTION", ui=False):
    """Mirror NativeEvent construction, with fake content explicitly labeled."""
    source = {"kind": "independently-authored", "not_a_dataset_record": True}
    policy = {"kind": "authored_policy", "model": "authored-learner", "revision": "v1"}
    episode = {"schema_version": 1, "id": "authored", "branch_id": branch, "family": "authored-family",
               "source": source, "outcome": "learner_stop", "measurement": "offline_integration",
               "learner_policy": policy, "ledger": [], "evaluation_only": {"secret": "GOLD_PRIVATE_FUTURE"},
               "assessment": None, "training": {"eligible": False}}
    ledger = episode["ledger"]
    def append(kind, payload):
        previous = ledger[-1] if ledger else None
        origin, visibility = nt.KINDS[kind]
        event = {"event_id": f'authored-{branch}-{len(ledger)}', "episode_id": "authored", "branch_id": branch,
                 "parent_event_id": previous["event_id"] if previous else None, "sequence": len(ledger),
                 "timestamp": STAMP, "origin": origin, "kind": kind, "visibility": visibility,
                 "payload": deepcopy(payload), "payload_hash": nt.native_hash(payload),
                 "previous_hash": previous["hash"] if previous else None}
        ledger.append(nt.seal(event))
    append("scenario_admitted", {"family": episode["family"], "source": source,
                                 "scenario_hash": "a" * 64, "learner_policy": policy})
    append("learner_initial_message", {"text": "INITIAL_LEARNER"})
    runtime = {"id": "authored", "status": "completed", "error_code": None,
               "runtime": "keating-tui-pi-rpc", "measurement": "offline_integration",
               "source_hashes": {"fixture-runtime.ts": "c" * 64},
               "source_provenance": {"unchanged_at_end": True, "changed_paths": []},
               "requests": [], "steps": [], "configuration": {"transport_kind": "tape"}}
    episode["runtime"] = runtime
    user = {"role": "user", "content": [{"type": "text", "text": "INITIAL_LEARNER"}]}
    actor = {"role": "assistant", "content": [{"type": "text", "text": reply},
             {"type": "toolCall", "id": "call-0", "name": "read", "arguments": {"path": "fixtures/task.txt"}}],
             "model": MODEL["id"], "provider": MODEL["provider"], "stopReason": "toolUse"}
    tool = {"role": "toolResult", "toolCallId": "call-0", "content": [{"type": "text", "text": "TOOL_PRIVATE_RESULT"}]}
    messages = [user, actor, tool]
    documents = [{"id": "card", "revision": 0, "heading": "Task", "body": ["VISIBLE_ARTIFACT"]}]
    controls = [{"actionId": "card:0:attempt:update-notes", "documentId": "card", "documentRevision": 0,
                 "nodeId": "attempt", "type": "update-notes"}] if ui else []
    for index in range(2):
        start = 0 if index == 0 else len(messages)
        if index:
            if not ui:
                messages.append({"role": "user", "content": [{"type": "text", "text": "LEARNER_FUTURE"}]})
            messages.append({"role": "assistant", "content": [{"type": "text", "text": "LATER_TUTOR_MUST_NOT_LEAK"}],
                             "model": MODEL["id"], "provider": MODEL["provider"], "stopReason": "stop"})
        step = {"index": index, "kind": "ui_action" if index and ui else "message", "status": "completed",
                "message_start_index": start, "messages": deepcopy(messages), "events": [],
                "state": {"sessionId": "session-0", "private": "STATE_PRIVATE"}, "files": []}
        if index and ui:
            step["action_result"] = {"status": "completed", "receipt": "authored-receipt"}
        runtime["steps"].append(step)
        append("runtime_step", step)
        # Deliberately independent of the validator's _step_evidence implementation.
        for message in messages[start:]:
            if message["role"] == "assistant":
                append("actor_message", {"step": index, "message": message})
                for block in message["content"]:
                    if block["type"] == "toolCall":
                        append("tool_call", {"step": index, "call": block})
            elif message["role"] == "toolResult":
                append("tool_result", {"step": index, "message": message})
        append("state_snapshot", {"step": index, "session_id": "session-0", "files": []})
        if index and ui:
            append("action_receipt", {"status": "completed", "result": step["action_result"]})
        observation = nt.seal({"schema_version": 1, "step": index, "visibleText": reply if index == 0 else "LATER_TUTOR_MUST_NOT_LEAK",
                               "documents": documents, "availableActions": controls}, "observationHash")
        append("delivered_observation", observation)
        intent = ({"kind": "stop"} if index else {"kind": "ui_action", "actionId": controls[0]["actionId"],
                                                  "payload": {"value": "LEARNER_FUTURE"}} if ui else
                  {"kind": "message", "text": "LEARNER_FUTURE"})
        append("learner_intent", {"observation_hash": observation["observationHash"], "intent": intent})
    for step in runtime["steps"]:
        for idx, message in enumerate(step["messages"]):
            if idx >= step["message_start_index"] and message["role"] == "assistant":
                runtime["requests"].append({"kind": "provider_request", "data": {"index": len(runtime["requests"]),
                    "model": {"provider": MODEL["provider"], "id": MODEL["id"]},
                    "context": {"systemPrompt": "An authored tutor fixture.", "messages": step["messages"][:idx],
                                "tools": [{"name": "read", "description": "Read the task."}]}}})
    append("episode_end", {"outcome": "learner_stop", "decisions": 1, "repairs": 0, "sessions": 1,
                           "runtime_error": None, "assessment": None, "assessment_status": "unavailable",
                           "runtime_source_hash": nt.native_hash(runtime["source_hashes"])})
    return episode


def reseal_episode(episode):
    """Attacker can recalculate hashes; semantic checks must still reject forgery."""
    previous = None
    for index, event in enumerate(episode["ledger"]):
        event.update(sequence=index, event_id=f'{episode["id"]}-{episode["branch_id"]}-{index}',
                     parent_event_id=previous["event_id"] if previous else None,
                     previous_hash=previous["hash"] if previous else None,
                     payload_hash=nt.native_hash(event["payload"]))
        event.update(hash=nt.native_hash({k: v for k, v in event.items() if k != "hash"}))
        previous = event
    episode["runtime"]["steps"] = [deepcopy(e["payload"]) for e in episode["ledger"] if e["kind"] == "runtime_step"]


def fixture_capture(episode):
    checked = nt.validate_episode(episode)
    step = checked.steps[0]
    actor_event = next(e for e in episode["ledger"] if e["kind"] == "actor_message")
    request = episode["runtime"]["requests"][0]
    return nt.seal({"schema_version": 1, "capture_id": "authored-capture-" + episode["branch_id"], **checked.ref(step),
        "delivery_event_hash": checked.deliveries[step["event_id"]]["hash"], "runtime_hash": nt.native_hash(episode["runtime"]),
        "message_index": 1, "message_hash": nt.native_hash(step["payload"]["messages"][1]),
        "actor_event_id": actor_event["event_id"], "actor_event_hash": actor_event["hash"],
        "request_index": 0, "request_hash": nt.native_hash(request), "context_hash": nt.native_hash(request["data"]["context"]),
        "actor": MODEL, "tokenizer": TOKENIZER,
        "source": {"kind": "authored_fixture", "recorded_at_generation": True, "recorder_revision": "fixture-v1",
                   "request_id": "fixture-request-0", "response_id": "fixture-response-0", "captured_at": STAMP},
        "prompt_token_ids": [10, 11, 12], "completion_token_ids": [20, 21, 22],
        "completion_token_roles": ["assistant_text", "assistant_tool_call", "assistant_tool_call"],
        "sampler": {"distribution": "actual_sampler", "all_generation_transforms_recorded": True,
                    "settings": {"temperature": 1.0, "top_p": 1.0, "top_k": None, "steering": None}},
        "behavior_logprobs": [-0.4, -0.8, -1.0]}, "capture_hash")


def fixture_review(episode, capture, boundary="retrospective"):
    checked = nt.validate_episode(episode)
    feature = next(f for f in nt.feature_inputs(checked) if f["event_id"] == capture["event_id"] and f["boundary"] == boundary)
    return nt.seal({"schema_version": 1, "review_id": "authored-review-" + episode["branch_id"], "kind": "segment",
                   "capture_hash": capture["capture_hash"], **checked.ref(checked.steps[0]),
                   "independent": True, "reviewer": {"kind": "authored_fixture", "id": "authored-reviewer"},
                   "reviewed_at": STAMP, "rubric_revision": "authored-rubric-v1", "boundary": boundary,
                   "evidence_hash": feature["feature_hash"], "latest_allowed_event_id": feature["latest_allowed_event_id"],
                   "accepted": True, "feedback": {"label": "authored scaffold contrast", "checked_outcome": None}}, "review_hash")


def fixture_teacher(episode, capture, review):
    feature = next(f for f in nt.feature_inputs(nt.validate_episode(episode)) if f["event_id"] == capture["event_id"] and f["boundary"] == "retrospective")
    packet = nt.feedback_packet(feature, review)
    model = {**MODEL, "revision": "frozen-fixture-snapshot"}
    prompt = [30, 31, 32, 33, 34]
    return nt.seal({"schema_version": 1, "capture_hash": capture["capture_hash"], "model": model, "tokenizer": TOKENIZER,
                   "prompt_token_ids": prompt, "completion_token_ids": capture["completion_token_ids"],
                   "completion_logprobs": [-0.2, -0.9, -0.5], "feedback_hash": packet["feedback_hash"],
                   "original_request_hash": capture["request_hash"],
                   "conditioning": "original_context_then_feedback_then_original_completion", "frozen": True,
                   "request_id": "authored-teacher-request", "response_id": "authored-teacher-response",
                   "recorder_revision": "authored-scorer-v1", "recorded_at_scoring": True, "captured_at": STAMP,
                   "scoring_request_hash": nt.native_hash(nt.teacher_request(capture, packet, model, prompt))}, "teacher_hash")


def export(episodes, captures=(), reviews=(), teachers=()):
    return nt.build_exports(episodes, {"schema_version": 1, "captures": list(captures), "teacher_captures": list(teachers)},
                            {"schema_version": 1, "reviews": list(reviews)})


class RejectedPolicyEvidenceTests(unittest.TestCase):
    def test_rejected_capture_preserves_review_without_becoming_a_demonstration(self):
        episode = fixture_episode()
        capture = fixture_capture(episode)
        review = fixture_review(episode, capture)
        review["accepted"] = False
        review = nt.seal(review, "review_hash")
        result = export([episode], [capture], [review])
        self.assertEqual(result["sft"], [])
        self.assertEqual(result["hindsight"], [])
        self.assertEqual(len(result["policy_segments"]), 1)
        policy = result["policy_segments"][0]
        self.assertEqual(policy["review_decision"], "rejected")
        self.assertEqual(policy["review_hash"], review["review_hash"])
        self.assertEqual(policy["segment"]["completion_token_ids"], capture["completion_token_ids"])
        self.assertEqual(policy["status"], "fixture_only")
        self.assertFalse(policy["training_eligible"])
        self.assertEqual(export([episode], [capture])["policy_segments"], [])


class NativeTrainingTests(unittest.TestCase):
    def setUp(self):
        self.episode = fixture_episode()
        self.capture = fixture_capture(self.episode)
        self.review = fixture_review(self.episode, self.capture)

    def test_hashes_match_actual_javascript_number_and_unicode_encoding(self):
        # A fixed producer vector, independent of the fixture's hashing helper.
        value = {"z": 1.0, "02": "leading", "10": -0.0, "2": "integer-key", "unicode": "café 😀",
                 "numbers": [1e-7, 1e-6, 1e20, 1e21, -1.25, 0.00025], "lone": "\ud800"}
        expected = '{"2":"integer-key","10":0,"z":1,"02":"leading","unicode":"café 😀","numbers":[1e-7,0.000001,100000000000000000000,1e+21,-1.25,0.00025],"lone":"\\ud800"}'
        self.assertEqual(nt.native_json(value), expected)
        self.assertEqual(nt.native_hash(value), hashlib.sha256(expected.encode()).hexdigest())
        with self.assertRaises(nt.ExportError):
            nt.native_hash(float("nan"))

    def test_observer_boundaries_do_not_leak_future_or_private_evidence(self):
        result = export([self.episode])
        self.assertEqual(len(result["observer_inputs"]), 5)
        features = {f["boundary"]: f for f in result["observer_inputs"] if f["event_id"] == self.capture["event_id"]}
        prefix, delivered, retro = (json.dumps(features[k]["input_events"]) for k in ("pre_action", "delivered", "retrospective"))
        self.assertNotIn("DELIVERED_ACTION", prefix)
        self.assertIn("VISIBLE_ARTIFACT", delivered)
        self.assertNotIn("LEARNER_FUTURE", delivered)
        self.assertIn("LEARNER_FUTURE", retro)
        for text in (prefix, delivered, retro):
            for secret in ("GOLD_PRIVATE_FUTURE", "STATE_PRIVATE", "TOOL_PRIVATE_RESULT", "LATER_TUTOR_MUST_NOT_LEAK"):
                self.assertNotIn(secret, text)
        self.assertIsNone(features["retrospective"]["outcome"])
        self.assertEqual(features["retrospective"]["outcome_status"], "unknown")

    def test_successful_ui_receipt_is_required_for_retrospective_view(self):
        episode = fixture_episode(ui=True)
        features = nt.feature_inputs(nt.validate_episode(episode))
        retro = next(f for f in features if f["boundary"] == "retrospective")
        latest = next(e for e in episode["ledger"] if e["event_id"] == retro["latest_allowed_event_id"])
        self.assertEqual(latest["kind"], "action_receipt")
        step = next(e for e in episode["ledger"] if e["kind"] == "runtime_step" and e["payload"]["kind"] == "ui_action")
        step["payload"]["action_result"]["status"] = "failed"
        receipt = next(e for e in episode["ledger"] if e["kind"] == "action_receipt")
        receipt["payload"] = {"status": "failed", "result": step["payload"]["action_result"]}
        reseal_episode(episode)
        with self.assertRaisesRegex(nt.ExportError, "unsuccessful_delivery"):
            export([episode])

    def test_missing_capture_never_retokenizes_or_makes_up_probabilities(self):
        result = export([self.episode])
        self.assertEqual(result["sft"], [])
        self.assertEqual(result["hindsight"], [])
        self.assertTrue(all(r["reason"] == "missing_original_actor_capture" for r in result["availability"]))

    def test_completed_ui_submission_then_followup_timeout_retains_only_delivered_evidence(self):
        episode = fixture_episode(ui=True)
        failed = next(e for e in episode["ledger"] if e["kind"] == "runtime_step" and e["payload"]["kind"] == "ui_action")
        failed["payload"]["status"] = "failed"
        end = episode["ledger"][-1]
        receipt = next(e for e in episode["ledger"] if e["kind"] == "action_receipt")
        episode["ledger"] = episode["ledger"][:receipt["sequence"] + 1] + [end]
        episode["outcome"] = "provider_failure"
        episode["runtime"].update(status="failed", error_code="provider_timeout")
        end["payload"].update(outcome="provider_failure", runtime_error="provider_timeout")
        reseal_episode(episode)
        checked = nt.validate_episode(episode)
        features = nt.feature_inputs(checked)
        self.assertEqual(len(features), 3)
        retro = next(f for f in features if f["boundary"] == "retrospective")
        self.assertEqual(retro["latest_allowed_event_id"], receipt["event_id"])
        self.assertNotIn(failed["event_id"], checked.deliveries)
        self.assertNotIn("LATER_TUTOR_MUST_NOT_LEAK", json.dumps(retro))
        self.assertIsNone(retro["outcome"])
        self.assertEqual(retro["outcome_status"], "unknown")
        missing = deepcopy(episode)
        missing["ledger"] = [e for e in missing["ledger"] if e["kind"] != "action_receipt"]
        reseal_episode(missing)
        with self.assertRaisesRegex(nt.ExportError, "missing_action_receipt"):
            nt.validate_episode(missing)
        # No action_result means no submission evidence, not a fabricated receipt.
        next(e for e in missing["ledger"] if e["kind"] == "runtime_step" and e["payload"]["kind"] == "ui_action")["payload"].pop("action_result")
        reseal_episode(missing)
        self.assertEqual(len(nt.feature_inputs(nt.validate_episode(missing))), 2)
        forged = deepcopy(episode)
        next(e for e in forged["ledger"] if e["kind"] == "actor_message" and e["payload"]["step"] == 1)["payload"]["message"]["content"] = []
        reseal_episode(forged)
        with self.assertRaisesRegex(nt.ExportError, "runtime_detail_mismatch"):
            nt.validate_episode(forged)

    def test_captured_actor_roles_only_and_causal_masks(self):
        result = export([self.episode], [self.capture], [self.review])
        segment = result["sft"][0]["segment"]
        self.assertEqual(segment["input_tokens"], [10, 11, 12, 20, 21])
        self.assertEqual(segment["target_tokens"], [11, 12, 20, 21, 22])
        self.assertEqual(segment["loss_mask"], [0, 0, 1, 1, 1])
        self.assertEqual(result["sft"][0]["status"], "fixture_only")
        self.assertFalse(result["sft"][0]["training_eligible"])
        self.assertNotIn("TOOL_PRIVATE_RESULT", json.dumps(result["sft"]))

    def test_hindsight_requires_scored_teacher_and_matches_original_targets(self):
        teacher = fixture_teacher(self.episode, self.capture, self.review)
        result = export([self.episode], [self.capture], [self.review], [teacher])
        row = result["hindsight"][0]
        self.assertEqual(row["segment"]["completion_token_ids"], row["teacher"]["completion_token_ids"])
        self.assertEqual(row["teacher"]["loss_mask"], [0, 0, 0, 0, 1, 1, 1])
        self.assertIsNone(row["outcome"])
        self.assertFalse(row["training_eligible"])
        self.assertEqual(teacher["capture_hash"], self.capture["capture_hash"])

    def test_no_behavior_still_allows_reviewed_sft_but_not_sdpo(self):
        capture = nt.seal({**self.capture, "behavior_logprobs": None}, "capture_hash")
        review = fixture_review(self.episode, capture)
        result = export([self.episode], [capture], [review])
        self.assertEqual(len(result["sft"]), 1)
        self.assertEqual(result["hindsight"], [])
        self.assertIn("missing_behavior_logprobs", {r["reason"] for r in result["availability"]})

    def test_review_acceptance_is_not_inferred_from_delivery(self):
        result = export([self.episode], [self.capture])
        self.assertEqual(result["sft"], [])
        self.assertIn("missing_independent_acceptance", {r["reason"] for r in result["availability"]})
        review = nt.seal({**self.review, "accepted": False}, "review_hash")
        self.assertEqual(export([self.episode], [self.capture], [review])["sft"], [])

    def test_tamper_truncation_order_and_runtime_mismatch(self):
        mutants = []
        changed = deepcopy(self.episode); changed["ledger"][1]["payload"]["text"] = "tampered"; mutants.append(changed)
        changed = deepcopy(self.episode); changed["ledger"].pop(); mutants.append(changed)
        changed = deepcopy(self.episode); changed["ledger"][2], changed["ledger"][3] = changed["ledger"][3], changed["ledger"][2]; mutants.append(changed)
        changed = deepcopy(self.episode); changed["runtime"]["steps"][0]["status"] = "failed"; mutants.append(changed)
        changed = deepcopy(self.episode); changed["family"] = "other-family"; mutants.append(changed)
        changed = deepcopy(self.episode); changed["ledger"][3]["branch_id"] = "other-branch"; mutants.append(changed)
        for episode in mutants:
            with self.subTest(episode=mutants.index(episode)), self.assertRaises(nt.ExportError):
                export([episode])

    def test_rehashed_actor_tool_and_state_details_must_match_runtime(self):
        for kind in ("actor_message", "tool_call", "tool_result", "state_snapshot"):
            episode = deepcopy(self.episode)
            event = next(e for e in episode["ledger"] if e["kind"] == kind)
            event["payload"]["step"] = 99
            reseal_episode(episode)
            with self.subTest(kind=kind), self.assertRaisesRegex(nt.ExportError, "runtime_detail_mismatch"):
                export([episode])

    def test_rehashed_learner_reference_cannot_point_at_future_observation(self):
        episode = deepcopy(self.episode)
        intents = [e for e in episode["ledger"] if e["kind"] == "learner_intent"]
        intents[0]["payload"]["observation_hash"] = intents[1]["payload"]["observation_hash"]
        reseal_episode(episode)
        with self.assertRaisesRegex(nt.ExportError, "stale_learner_observation"):
            export([episode])

    def test_capture_pin_branch_provenance_roles_and_values_are_checked(self):
        changes = [{"branch_id": "b"}, {"event_hash": "0" * 64}, {"runtime_hash": "0" * 64},
                   {"actor_event_hash": "0" * 64}, {"message_index": 2}, {"request_index": 1},
                   {"context_hash": "0" * 64}, {"completion_token_roles": ["assistant_text", "tool_result", "learner"]},
                   {"completion_token_ids": []}, {"behavior_logprobs": [-0.1]}, {"behavior_logprobs": [-0.1, 0.2, -1]},
                   {"loss_mask": [1, 0, 1, 1, 1]}, {"tokenizer": {"id": "missing-revision"}},
                   {"source": {**self.capture["source"], "kind": "provider_capture"}},
                   {"sampler": {**self.capture["sampler"], "distribution": "base_logits"}}]
        for change in changes:
            with self.subTest(change=change), self.assertRaises(nt.ExportError):
                export([self.episode], [nt.seal({**self.capture, **change}, "capture_hash")])

    def test_review_temporal_and_independence_checks(self):
        for change in ({"latest_allowed_event_id": self.episode["ledger"][-1]["event_id"]},
                       {"evidence_hash": "0" * 64}, {"independent": False}, {"boundary": "pre_action"}, {"branch_id": "b"}):
            with self.subTest(change=change), self.assertRaises(nt.ExportError):
                export([self.episode], [self.capture], [nt.seal({**self.review, **change}, "review_hash")])

    def test_teacher_alignment_feedback_conditioning_and_scoring_hash(self):
        teacher = fixture_teacher(self.episode, self.capture, self.review)
        for change in ({"completion_token_ids": [20, 21, 99]}, {"completion_logprobs": [-1]},
                       {"feedback_hash": "0" * 64}, {"conditioning": "feedback_after_completion"},
                       {"frozen": False}, {"recorded_at_scoring": False}, {"scoring_request_hash": "0" * 64}):
            with self.subTest(change=change), self.assertRaises(nt.ExportError):
                export([self.episode], [self.capture], [self.review], [nt.seal({**teacher, **change}, "teacher_hash")])

    def test_preference_is_independently_ordered_same_prefix_across_branches(self):
        other = fixture_episode("b", reply="ALTERNATIVE_ACTION")
        capture = nt.seal({**fixture_capture(other), "completion_token_ids": [23, 24, 25]}, "capture_hash")
        features = [next(f for f in nt.feature_inputs(nt.validate_episode(e)) if f["event_id"] == c["event_id"] and f["boundary"] == "delivered")
                    for e, c in ((self.episode, self.capture), (other, capture))]
        review = nt.seal({"schema_version": 1, "review_id": "authored-pair", "kind": "preference",
                          "chosen_capture_hash": self.capture["capture_hash"], "rejected_capture_hash": capture["capture_hash"],
                          "independent": True, "reviewer": {"kind": "authored_fixture", "id": "authored-reviewer"},
                          "reviewed_at": STAMP, "rubric_revision": "authored-pair-v1", "boundary": "delivered",
                          "evidence_hash": nt.native_hash({"chosen": features[0]["feature_hash"], "rejected": features[1]["feature_hash"]})}, "review_hash")
        result = export([self.episode, other], [self.capture, capture], [review])
        self.assertEqual(len(result["preferences"]), 1)
        self.assertFalse(result["preferences"][0]["training_eligible"])
        identical = nt.seal({**capture, "completion_token_ids": self.capture["completion_token_ids"]}, "capture_hash")
        identical_review = nt.seal({**review, "rejected_capture_hash": identical["capture_hash"]}, "review_hash")
        with self.assertRaisesRegex(nt.ExportError, "preference_identical_completion"):
            export([self.episode, other], [self.capture, identical], [identical_review])
        altered = nt.seal({**capture, "prompt_token_ids": [10, 11, 99]}, "capture_hash")
        changed_review = nt.seal({**review, "rejected_capture_hash": altered["capture_hash"]}, "review_hash")
        with self.assertRaisesRegex(nt.ExportError, "preference_prefix_mismatch"):
            export([self.episode, other], [self.capture, altered], [changed_review])
        other["family"] = "other-family"
        other["ledger"][0]["payload"]["family"] = "other-family"
        reseal_episode(other)
        changed_capture = fixture_capture(other)
        changed_review = nt.seal({**review, "rejected_capture_hash": changed_capture["capture_hash"]}, "review_hash")
        with self.assertRaisesRegex(nt.ExportError, "preference_family_or_branch"):
            export([self.episode, other], [self.capture, changed_capture], [changed_review])

    def test_duplicate_captures_and_unused_review_references_fail(self):
        with self.assertRaisesRegex(nt.ExportError, "duplicate_capture"):
            export([self.episode], [self.capture, self.capture])
        with self.assertRaisesRegex(nt.ExportError, "review_missing_capture"):
            export([self.episode], reviews=[self.review])

    def test_cli_exports_new_file_and_rejects_overwrite_or_corrupt_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            episode_path, output = root / "episode.json", root / "exports.json"
            episode_path.write_text(json.dumps(self.episode))
            command = [sys.executable, str(Path(nt.__file__)), "export", "--episode", str(episode_path), "--output", str(output)]
            proc = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertEqual(nt.load_json(output)["sft"], [])
            self.assertEqual(output.stat().st_mode & 0o777, 0o600)
            self.assertEqual(subprocess.run(command, capture_output=True).returncode, 2)
            episode_path.write_text('{"schema_version":1,"schema_version":2}')
            self.assertEqual(subprocess.run(command, capture_output=True).returncode, 2)


if __name__ == "__main__":
    unittest.main()
