import unittest

from estimate_cost import estimate
from pilot_budget import PilotBudget


class CostTests(unittest.TestCase):
    def test_discount_applies_once_and_cache_only_reduces_prefill(self):
        report = estimate({"model": PilotBudget.MODEL, "reserved_usd": 99,
                           "cap_usd": 100, "events": [{
                               "prefill_tokens": 1_000_000,
                               "sample_tokens": 1_000_000,
                               "train_tokens": 1_000_000}]})
        cold, warm = report["cache_scenarios"][0], report["cache_scenarios"][-1]
        self.assertAlmostEqual(cold["token_total_usd"], 3.75)
        self.assertAlmostEqual(warm["token_total_usd"], 3.286)
        self.assertEqual(cold["train_usd"], warm["train_usd"])
        self.assertEqual(cold["sample_usd"], warm["sample_usd"])
        self.assertIsNone(report["actual_billed_usd"])
        self.assertIsNone(report["measured_cache_hit_fraction"])
        self.assertEqual(report["safety_reservation_usd"], 99)

    def test_rejects_wrong_model(self):
        with self.assertRaises(ValueError):
            estimate({"model": "another-model"})
