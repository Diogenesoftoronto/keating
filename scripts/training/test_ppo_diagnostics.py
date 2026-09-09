import math
import unittest

from ppo_diagnostics import completion_alignment


class CompletionDiagnosticTests(unittest.TestCase):
    def test_prompt_can_dominate_report_while_completion_alignment_is_exact(self):
        result = completion_alignment(101, 2, [-0.5, -1], [-5] * 100 + [-0.5, -1])
        correct = result["completion_only"]
        self.assertEqual(correct["mean_probability_ratio"], 1)
        self.assertEqual(correct["max_abs_logprob_difference"], 0)
        self.assertGreater(result["unmasked_zero_prompt_reference"]["sample_minus_evaluated_logprob_mean"], 4.9)
        self.assertLess(result["unmasked_zero_prompt_reference"]["mean_probability_ratio"], 0.03)
        self.assertEqual(result["prompt_target_tokens_excluded"], 100)

    def test_first_completion_target_is_prompt_length_minus_one(self):
        result = completion_alignment(2, 2, [-1, -2], [-99, -1, -2], [-1, -2])
        self.assertEqual(result["completion_only"]["max_abs_logprob_difference"], 0)
        self.assertEqual(result["current_sampler_vs_trainer"]["max_abs_logprob_difference"], 0)

    def test_sampler_trainer_difference_separates_from_policy_change(self):
        result = completion_alignment(1, 2, [-1, -1], [-2, -2], [-1.5, -1.5])
        self.assertEqual(result["completion_only"]["mean_abs_logprob_difference"], 1)
        self.assertEqual(result["rollout_vs_current_sampler"]["mean_abs_logprob_difference"], 0.5)
        self.assertEqual(result["current_sampler_vs_trainer"]["mean_abs_logprob_difference"], 0.5)
        self.assertAlmostEqual(result["completion_only"]["mean_probability_ratio"], math.exp(-1))

    def test_invalid_alignment_fails_closed(self):
        for args in [(0, 1, [-1], [-1]), (2, 1, [-1], [-1]),
                     (1, 1, [math.nan], [-1]), (1, 1, [-1], [0.5]),
                     (1, 1, [-1], [-1], [-1, -2])]:
            with self.subTest(args=args), self.assertRaises(ValueError):
                completion_alignment(*args)


if __name__ == "__main__":
    unittest.main()
