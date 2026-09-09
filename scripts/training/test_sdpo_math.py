import math
import unittest

from sdpo_math import datum_vectors, prepare_advantages


class AdvantageTests(unittest.TestCase):
    def test_sign_is_teacher_minus_student_without_centering(self):
        advantages, average, metrics = prepare_advantages([-1, -4, -2], [-3, -2, -2])
        self.assertEqual(advantages, [2, -2, 0])
        self.assertAlmostEqual(average, 4 / 3)
        self.assertEqual(metrics["clipped_tokens"], 0)
        # Uniform positive feedback must remain positive, not disappear via centering.
        self.assertEqual(prepare_advantages([-1, -1], [-3, -3])[0], [2, 2])

    def test_outliers_bounded_by_updated_running_mean(self):
        values, average, metrics = prepare_advantages([-1, -101], [-101, -1], 1)
        self.assertAlmostEqual(average, 10.9)
        self.assertEqual(metrics["clipped_tokens"], 2)
        self.assertAlmostEqual(values[0], 3 * average)
        self.assertAlmostEqual(values[1], -3 * average)
        self.assertTrue(all(abs(v) <= metrics["clip_threshold"] for v in values))

    def test_zero_batch_and_first_batch(self):
        self.assertEqual(prepare_advantages([-1], [-1])[:2], ([0], 0))
        self.assertEqual(prepare_advantages([-1], [-1], 2)[:2], ([0], 1.8))

    def test_invalid_batches_rejected(self):
        for teacher, current, mean in [([], [], None), ([-1], [-1, -2], None),
                                      ([math.nan], [-1], None), ([-1], [math.inf], None),
                                      ([1], [-1], None), ([-1], [-1], -1),
                                      ([-1], [-1], math.nan), ([True], [-1], None)]:
            with self.subTest(teacher=teacher, current=current, mean=mean):
                with self.assertRaises(ValueError):
                    prepare_advantages(teacher, current, mean)


class DatumTests(unittest.TestCase):
    def test_causal_alignment_and_no_prompt_gradient(self):
        vectors = datum_vectors([10, 20, 30], [40, 50], [-0.2, -0.4], [2, -3])
        self.assertEqual(vectors["input_tokens"], [10, 20, 30, 40])
        self.assertEqual(vectors["target_tokens"], [20, 30, 40, 50])
        self.assertEqual(vectors["weights"], [0, 0, 1, 1])
        self.assertEqual(vectors["advantages"], [0, 0, 2, -3])
        self.assertEqual(vectors["logprobs"], [0, 0, -0.2, -0.4])
        self.assertEqual({len(value) for value in vectors.values()}, {4})

    def test_single_prompt_and_completion_token(self):
        vectors = datum_vectors([10], [20], [-1], [0.5])
        self.assertEqual(vectors["input_tokens"], [10])
        self.assertEqual(vectors["target_tokens"], [20])
        self.assertEqual(vectors["weights"], [1])

    def test_invalid_alignment_and_numbers_rejected(self):
        for prompt, completion, logprobs, advantages in [
            ([], [1], [-1], [1]), ([1], [], [], []), ([1], [2, 3], [-1], [1]),
            ([1], [2], [-1], [1, 2]), ([1], [2], [0.1], [1]),
            ([True], [2], [-1], [1]), ([1], [-2], [-1], [1]),
            ([1], [2], [-1], [math.inf]),
        ]:
            with self.subTest(prompt=prompt, completion=completion):
                with self.assertRaises(ValueError):
                    datum_vectors(prompt, completion, logprobs, advantages)


if __name__ == "__main__":
    unittest.main()
