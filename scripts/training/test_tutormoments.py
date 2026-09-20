"""Causal boundaries and integrity of the external benchmark integration."""
import copy
import json
from pathlib import Path
import tempfile
import unittest

import benchmark_v3 as v3
import tutormoments as tm


def fixture():
    return {"id": "example", "dimension": "rigor", "rubric": {"gold": "rigor", "hint": "GOLD_SECRET"},
            "context": [{"turn_number": 1, "role": "student", "text": "I got 12."},
                        {"turn_number": 1, "role": "student", "text": "Let me explain."}],
            "provenance": {"cut_turn": 1}, "student": {"reference": "FUTURE_SECRET", "trait": "PERSONA_SECRET"}}


class MomentTests(unittest.TestCase):
    def test_tutor_payload_excludes_gold_and_future(self):
        r = fixture()
        payload = json.dumps(tm.tutor_request(r, "Tutor thoughtfully."))
        for secret in ("GOLD_SECRET", "FUTURE_SECRET", "PERSONA_SECRET", "rigor"):
            self.assertNotIn(secret, payload)
        self.assertIn("Let me explain.", payload)

    def test_duplicate_turn_numbers_are_valid_but_future_turns_are_not(self):
        tm.validate_records([fixture()])
        r = fixture()
        r["context"][-1]["turn_number"] = 2
        with self.assertRaises(ValueError):
            tm.validate_records([r])

    def test_duplicate_ids_and_label_mismatch_rejected(self):
        with self.assertRaises(ValueError):
            tm.validate_records([fixture(), fixture()])
        r = fixture()
        r["rubric"]["gold"] = "scaffolding"
        with self.assertRaises(ValueError):
            tm.validate_records([r])

    def test_hash_tampering_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "moments.jsonl"
            p.write_text(json.dumps(fixture()))
            with self.assertRaisesRegex(ValueError, "hash mismatch"):
                tm.load_moments(p)

    def test_adaptations_load_in_actual_harness_schema_without_reference_leakage(self):
        cases = v3.load_cases(tm.ROOT / "scripts/training/benchmarks/tutormoments-keating-v1/cases.json")
        self.assertEqual(len(cases), 12)
        families = {}
        for c in cases:
            families.setdefault(c["source"]["moment_id"], set()).add(c["family"])
            marked = copy.deepcopy(c)
            marked["reference"]["facts"].append("EVALUATOR_SECRET")
            wire = v3.request_for(marked, {"kind": "tape", "responses": []})
            self.assertNotIn("EVALUATOR_SECRET", json.dumps(wire))
            self.assertNotIn("source", wire)
            self.assertNotIn("rubric", wire)
        self.assertEqual(len(families), 6)
        self.assertTrue(all(len(x) == 1 for x in families.values()))


if __name__ == "__main__":
    unittest.main()
