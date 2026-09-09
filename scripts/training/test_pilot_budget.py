import json
from pathlib import Path
import tempfile
import unittest

from pilot_budget import PilotBudget


class BudgetTests(unittest.TestCase):
    def test_failures_remain_reserved_and_restart_cannot_raise_cap(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "budget.json"
            with self.assertRaises(RuntimeError):
                with PilotBudget(path, 1).reserve("failed", fixed_usd=.75):
                    raise RuntimeError("upstream failure")
            with self.assertRaises(ValueError):
                with PilotBudget(path, 1).reserve("exceeds", fixed_usd=.26):
                    self.fail("must not dispatch")
            with self.assertRaises(ValueError):
                with PilotBudget(path, 100).reserve("raise cap"):
                    self.fail("must not silently raise cap")
            self.assertEqual(json.loads(path.read_text())["reserved_usd"], .75)

    def test_invalid_inputs_do_not_dispatch(self):
        with tempfile.TemporaryDirectory() as directory:
            budget = PilotBudget(Path(directory) / "budget.json")
            for kwargs in [{"prefill": -1}, {"sample": 1.2}, {"fixed_usd": float("nan")}]:
                with self.assertRaises(ValueError):
                    with budget.reserve("bad", **kwargs):
                        self.fail("must not dispatch")


if __name__ == "__main__":
    unittest.main()
