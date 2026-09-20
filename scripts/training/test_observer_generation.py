# /// script
# requires-python = ">=3.12,<3.14"
# dependencies = ["torch==2.8.0+cpu"]
# [tool.uv.sources]
# torch = { index = "pytorch-cpu" }
# [[tool.uv.index]]
# name = "pytorch-cpu"
# url = "https://download.pytorch.org/whl/cpu"
# explicit = true
# ///
"""CPU toy mechanics only: these assertions are NOT checkpoint behavior evidence."""
from dataclasses import replace
import json
import random
import unittest

import torch

import observer_generation as generation


class ToyBlock(torch.nn.Module):
    def __init__(self, tuple_output=False):
        super().__init__()
        self.tuple_output = tuple_output
        self.sentinel = object()

    def forward(self, hidden):
        return (hidden, self.sentinel, None) if self.tuple_output else hidden


class ToyCausal(torch.nn.Module):
    """Authored Markov logits: the previously emitted token changes the next state."""
    def __init__(self, tuple_output=False, failure=None):
        super().__init__()
        self.embedding = torch.nn.Embedding(8, 3)
        self.block = ToyBlock(tuple_output)
        self.failure = failure
        self.calls = []
        with torch.no_grad():
            self.embedding.weight.zero_()
            self.embedding.weight[1, 0] = 3
            self.embedding.weight[2, 0] = -3
            self.embedding.weight[3, 1] = 3
            self.embedding.weight[4:6, 2] = 3

    def forward(self, *, input_ids, attention_mask, position_ids, use_cache):
        assert use_cache is False
        assert not self.training and not self.block.training and not torch.is_grad_enabled()
        # Even adapters that consume global RNGs must leave the caller's state intact.
        noise = (torch.rand(()).item(), random.random())
        if self.failure == "before":
            raise RuntimeError("before block")
        raw = self.embedding(input_ids)
        output = raw if self.failure == "skip" else self.block(raw)
        if self.failure == "twice":
            output = self.block(raw)
        if isinstance(output, tuple):
            assert output[1] is self.block.sentinel and output[2] is None
            hidden = output[0]
        else:
            hidden = output
        self.calls.append({"ids": input_ids.clone(), "mask": attention_mask.clone(),
                           "positions": position_ids.clone(), "before": raw.clone(),
                           "after": hidden.clone(), "noise": noise})
        if self.failure == "after":
            raise RuntimeError("after block")
        logits = torch.full((*input_ids.shape, 8), -10.0)
        logits[..., 0] = 1
        logits[..., 1] = hidden[..., 0]
        logits[..., 2] = -hidden[..., 0]
        logits[..., 3] = hidden[..., 1]
        logits[..., 4] = hidden[..., 2]
        if self.failure == "nan":
            logits[..., 0] = float("nan")
        if self.failure == "shape":
            logits = logits[:, :-1, :]
        return {"last_hidden_state": hidden} if self.failure == "hidden_only" else {"logits": logits}


def batch(ids=((0,),), mask=None):
    ids = torch.tensor(ids, dtype=torch.long)
    return {"input_ids": ids, "attention_mask": torch.ones_like(ids) if mask is None else torch.tensor(mask)}


def config(**changes):
    return replace(generation.GenerationConfig(max_new_tokens=3, max_context_tokens=12,
                   max_forward_passes=100, max_forward_tokens=10000, pad_token_id=7, seed=13), **changes)


class GenerationMechanicsTests(unittest.TestCase):
    def controls(self, model, data=None, **kwargs):
        return generation.generate_controls(model, model.block, batch() if data is None else data,
                    config=config(), selected_direction=torch.tensor([9., 0., 0.]),
                    unrelated_direction=torch.tensor([0., 8., 0.]),
                    unrelated_review="toy-reviewed-control/mechanics-only", epsilon=2., scale=1.,
                    random_seed=23, **kwargs)

    def test_interventions_change_actually_emitted_tokens_tensor_and_tuple(self):
        for tuple_output in (False, True):
            with self.subTest(tuple_output=tuple_output):
                model = ToyCausal(tuple_output)
                result = self.controls(model)
                runs = result["conditions"]
                self.assertEqual(set(runs), {"baseline", "selected_positive", "selected_negative", "random", "unrelated"})
                for name, tokens in (("baseline", [0, 0, 0]), ("selected_positive", [1, 1, 1]),
                                     ("selected_negative", [2, 2, 2]), ("unrelated", [3, 3, 3])):
                    self.assertEqual(runs[name]["rows"][0]["generated_ids"], tokens)
                    self.assertEqual(runs[name]["rows"][0]["sequence_ids"], [0, *tokens])
                # The second selected-positive forward contains its actual first emitted ID.
                self.assertEqual(model.calls[4]["ids"].tolist(), [[0, 1]])
                self.assertEqual(model.calls[5]["ids"].tolist(), [[0, 1, 1]])
                self.assertFalse(result["behavior_evaluated"])
                json.dumps(result, allow_nan=False)

    def test_zero_epsilon_is_exact_baseline_identity(self):
        for tuple_output in (False, True):
            model = ToyCausal(tuple_output)
            base = generation.generate(model, model.block, batch(), config=config())
            base_calls = list(model.calls)
            model.calls.clear()
            zero = generation.generate(model, model.block, batch(), config=config(),
                                       direction=torch.tensor([1., 0., 0.]), epsilon=0, scale=100)
            self.assertEqual(base["rows"], zero["rows"])
            self.assertEqual(base["steps"], zero["steps"])
            for before, after in zip(base_calls, model.calls):
                self.assertTrue(torch.equal(before["after"], after["after"]))
                self.assertEqual(before["noise"], after["noise"])
            all_zero = generation.generate_controls(model, model.block, batch(), config=config(),
                selected_direction=torch.tensor([1., 0., 0.]), unrelated_direction=torch.tensor([0., 1., 0.]),
                unrelated_review="toy", epsilon=0, scale=1, random_seed=23)
            for run in all_zero["conditions"].values():
                self.assertEqual(base["rows"], run["rows"])

    def test_norm_matching_signs_and_seeded_random_control(self):
        model = ToyCausal()
        first, second = self.controls(model), self.controls(model)
        self.assertEqual(first, second)
        runs = first["conditions"]
        for name in ("selected_positive", "selected_negative", "random", "unrelated"):
            self.assertAlmostEqual(torch.tensor(runs[name]["direction"]).norm().item(), 1, places=6)
        torch.testing.assert_close(torch.tensor(runs["selected_negative"]["direction"]),
                                   -torch.tensor(runs["selected_positive"]["direction"]))
        for index, call in enumerate(model.calls[:15]):
            delta = call["after"] - call["before"]
            self.assertTrue(torch.equal(delta[:, :-1], torch.zeros_like(delta[:, :-1])))
            self.assertAlmostEqual(delta[:, -1].norm().item(), 0 if index < 3 else 2, places=5)
        changed = generation.generate_controls(model, model.block, batch(), config=config(),
            selected_direction=torch.tensor([1., 0., 0.]), unrelated_direction=torch.tensor([0., 1., 0.]),
            unrelated_review="toy", epsilon=2, scale=1, random_seed=24)
        self.assertNotEqual(runs["random"]["direction"], changed["conditions"]["random"]["direction"])

    def test_mixed_padding_and_batch_equal_individual_generation(self):
        # Includes left, right, and both-sided padding. Padding ID is deliberately
        # a token whose embedding would emit EOS if incorrectly used as the frontier.
        data = batch(((5, 0, 5), (0, 1, 5), (5, 5, 2)), ((0, 1, 0), (1, 1, 0), (0, 0, 1)))
        originals = {key: value.clone() for key, value in data.items()}
        model = ToyCausal(True)
        result = generation.generate(model, model.block, data, config=config(),
                                     direction=torch.tensor([1., 0., 0.]), epsilon=2, scale=1)
        for index, prompt in enumerate(((0,), (0, 1), (2,))):
            single_model = ToyCausal(True)
            single = generation.generate(single_model, single_model.block, batch((prompt,)), config=config(),
                                         direction=torch.tensor([1., 0., 0.]), epsilon=2, scale=1)
            self.assertEqual(result["rows"][index], single["rows"][0])
        first = model.calls[0]
        self.assertEqual(first["ids"].tolist(), [[7, 0], [0, 1], [7, 2]])
        self.assertEqual(first["positions"].tolist(), [[0, 0], [0, 1], [0, 0]])
        self.assertEqual(result["input_ids"], data["input_ids"].tolist())
        self.assertEqual(result["attention_mask"], data["attention_mask"].tolist())
        self.assertEqual(result["steps"][0]["intervention_positions"], [1, 1, 1])
        for key in data:
            self.assertTrue(torch.equal(data[key], originals[key]))
        for call in model.calls:
            delta = call["after"] - call["before"]
            self.assertTrue(torch.equal(delta[:, :-1], torch.zeros_like(delta[:, :-1])))
            torch.testing.assert_close(delta[:, -1], torch.tensor([[2., 0., 0.]]).expand(3, -1))

    def test_eos_stops_rows_independently_and_never_intervenes_on_finished_rows(self):
        model = ToyCausal()
        result = generation.generate(model, model.block, batch(((5,), (0,))),
                    config=config(eos_token_id=4), direction=torch.tensor([0., 1., 0.]), epsilon=2, scale=1)
        self.assertEqual(result["rows"][0]["generated_ids"], [4])
        self.assertEqual(result["rows"][0]["stop_reason"], "eos")
        self.assertEqual(result["rows"][1]["generated_ids"], [3, 3, 3])
        self.assertEqual(result["usage"], {"forward_passes": 3, "forward_tokens": 12})
        self.assertEqual(result["steps"][1]["intervention_positions"], [None, 1])
        self.assertEqual(result["steps"][1]["emitted_ids"], [None, 3])
        for call in model.calls[1:]:
            self.assertTrue(torch.equal(call["before"][0], call["after"][0]))
        stopped = ToyCausal()
        result = generation.generate(stopped, stopped.block, batch(((5,), (5,))), config=config(eos_token_id=4))
        self.assertEqual(len(stopped.calls), 1)
        self.assertEqual(result["usage"]["forward_passes"], 1)

    def test_explicit_truncation_retains_original_and_exact_used_ids(self):
        data = batch(((7, 0, 1, 2, 3), (0, 2, 7, 7, 7)), ((0, 1, 1, 1, 1), (1, 1, 0, 0, 0)))
        bounded = config(max_context_tokens=5)
        model = ToyCausal()
        with self.assertRaisesRegex(ValueError, "truncation"):
            generation.generate(model, model.block, data, config=bounded)
        self.assertEqual(model.calls, [])
        result = generation.generate(model, model.block, data, config=replace(bounded, overflow="truncate_left"))
        self.assertEqual(result["input_ids"], data["input_ids"].tolist())
        self.assertEqual(result["rows"][0]["prompt_ids"], [0, 1, 2, 3])
        self.assertEqual(result["rows"][0]["used_prompt_ids"], [2, 3])
        self.assertEqual(result["rows"][0]["dropped_prompt_ids"], [0, 1])
        self.assertEqual(result["rows"][1]["dropped_prompt_ids"], [])
        self.assertTrue(all(len(row["sequence_ids"]) == 5 for row in result["rows"]))

    def test_preflight_reserves_full_five_condition_padded_prefix_cost(self):
        data = batch(((0, 1), (7, 0)), ((1, 1), (0, 1)))
        # 5 conditions * 2 rows * (2 + 3 + 4) positions = 90, 15 forwards.
        bounded = config(max_forward_passes=15, max_forward_tokens=90)
        self.assertEqual(generation.generation_preflight(data, bounded, conditions=5)["upper_bound"],
                         {"forward_passes": 15, "forward_tokens": 90})
        for too_small in (replace(bounded, max_forward_passes=14), replace(bounded, max_forward_tokens=89)):
            model = ToyCausal()
            with self.assertRaisesRegex(ValueError, "aggregate forward budget"):
                generation.generate_controls(model, model.block, data, config=too_small,
                    selected_direction=torch.tensor([1., 0., 0.]), unrelated_direction=torch.tensor([0., 1., 0.]),
                    unrelated_review="toy", epsilon=2, scale=1, random_seed=1)
            self.assertEqual(model.calls, [])
        model = ToyCausal()
        result = generation.generate_controls(model, model.block, data, config=bounded,
                    selected_direction=torch.tensor([1., 0., 0.]), unrelated_direction=torch.tensor([0., 1., 0.]),
                    unrelated_review="toy", epsilon=2, scale=1, random_seed=1)
        self.assertEqual(result["usage"], result["upper_bound"])

    def test_rng_flags_and_existing_hooks_survive_success_and_failure(self):
        for failure in (None, "before", "after", "skip", "twice", "nan", "shape", "hidden_only"):
            with self.subTest(failure=failure):
                model = ToyCausal(True, failure)
                model.train()
                model.embedding.eval()  # Deliberately heterogeneous flags.
                seen = []
                existing = model.block.register_forward_hook(lambda *_args: seen.append(True))
                flags = [module.training for module in model.modules()]
                hooks = dict(model.block._forward_hooks)
                cpu_rng = torch.random.get_rng_state().clone()
                python_rng = random.getstate()
                try:
                    if failure is None:
                        self.controls(model)
                    else:
                        with self.assertRaises((ValueError, RuntimeError)):
                            generation.generate(model, model.block, batch(), config=config(),
                                                direction=torch.tensor([1., 0., 0.]), epsilon=2, scale=1)
                    self.assertEqual(flags, [module.training for module in model.modules()])
                    self.assertEqual(hooks, dict(model.block._forward_hooks))
                    self.assertTrue(torch.equal(cpu_rng, torch.random.get_rng_state()))
                    self.assertEqual(python_rng, random.getstate())
                finally:
                    existing.remove()

    def test_hook_failure_and_eval_failure_cleanup(self):
        for kind in ("width", "eval", "overflow", "second_step"):
            model = ToyCausal()
            flags = [module.training for module in model.modules()]
            cpu_rng, python_rng = torch.random.get_rng_state().clone(), random.getstate()
            if kind == "eval":
                def failing_eval():
                    model.training = False
                    torch.rand(())
                    random.random()
                    raise RuntimeError("eval failure")
                model.eval = failing_eval
            def adapter(owner, **inputs):
                if len(owner.calls) == 1:
                    raise RuntimeError("second step failure")
                return owner(**inputs)["logits"]
            with self.assertRaises((ValueError, RuntimeError)):
                generation.generate(model, model.block, batch(), config=config(),
                    direction=torch.ones(4) if kind == "width" else torch.tensor([1., 0., 0.]),
                    epsilon=1e39 if kind == "overflow" else 2, scale=1,
                    forward=adapter if kind == "second_step" else None)
            self.assertEqual(flags, [module.training for module in model.modules()])
            self.assertFalse(model.block._forward_hooks)
            self.assertTrue(torch.equal(cpu_rng, torch.random.get_rng_state()))
            self.assertEqual(python_rng, random.getstate())

    def test_callable_adapter_and_tensor_logits(self):
        model = ToyCausal(True)
        keys = []
        def adapter(owner, **inputs):
            keys.append(set(inputs))
            return owner(**inputs)["logits"]
        result = generation.generate(model, model.block, batch(), config=config(), forward=adapter,
                                     direction=torch.tensor([1., 0., 0.]), epsilon=2, scale=1)
        self.assertEqual(result["rows"][0]["generated_ids"], [1, 1, 1])
        self.assertTrue(all(key == {"input_ids", "attention_mask", "position_ids", "use_cache"} for key in keys))
        class TensorLogits(ToyCausal):
            def forward(self, **inputs):
                return super().forward(**inputs)["logits"]
        tensor_model = TensorLogits()
        generation.generate(tensor_model, tensor_model.block, batch(), config=config())

    def test_frontier_logits_equal_full_logits_with_padding_and_eos(self):
        data = batch(((7, 5), (0, 7)), ((0, 1), (1, 0)))
        for tuple_output in (False, True):
            full_model, frontier_model = ToyCausal(tuple_output), ToyCausal(tuple_output)
            def frontier(owner, **inputs):
                return owner(**inputs)["logits"][:, -1, :]
            options = dict(config=config(eos_token_id=4), direction=torch.tensor([0., 1., 0.]), epsilon=2, scale=1)
            full = generation.generate(full_model, full_model.block, data, **options)
            reduced = generation.generate(frontier_model, frontier_model.block, data, forward=frontier, **options)
            self.assertEqual(full, reduced)
            self.assertEqual(reduced["rows"][0]["generated_ids"], [4])
            self.assertEqual(reduced["rows"][1]["generated_ids"], [3, 3, 3])

    def test_rejects_malformed_frontier_logits_without_broadcasting(self):
        for shape in ((8,), (1, 8), (2, 0), (2, 2, 8), (2, 1, 1, 8)):
            model = ToyCausal()
            def malformed(owner, **inputs):
                owner(**inputs)
                return torch.zeros(shape)
            with self.subTest(shape=shape), self.assertRaisesRegex(ValueError, "causal logits"):
                generation.generate(model, model.block, batch(((0,), (0,))), config=config(), forward=malformed)
            self.assertFalse(model.block._forward_hooks)

    def test_batch_rejections_include_labels_future_text_and_cache(self):
        invalid = [batch((), ()), batch(((0, 0),), ((0, 0),)), batch(((0, 0, 0),), ((1, 0, 1),)),
                   batch(((0,),), ((2,),)), batch(((0,),), ((1.0,),)), batch(((-1,),))]
        for key in ("labels", "future_text", "text", "past_key_values", "use_cache", "position_ids"):
            invalid.append({**batch(), key: "not admissible"})
        invalid.extend(({"input_ids": torch.tensor([[0.0]]), "attention_mask": torch.ones(1, 1)},
                        {"input_ids": torch.tensor([[0]]), "attention_mask": torch.ones(1, 2, dtype=torch.long)},
                        {"input_ids": torch.tensor([0]), "attention_mask": torch.tensor([1])}))
        model = ToyCausal()
        for data in invalid:
            with self.subTest(data=data), self.assertRaises(ValueError):
                generation.generate(model, model.block, data, config=config())
        self.assertEqual(model.calls, [])

    def test_direction_control_and_configuration_rejections(self):
        model = ToyCausal()
        for direction in (torch.zeros(3), torch.tensor([float("nan"), 0, 0]), torch.ones(2, 3), torch.ones(3, dtype=torch.long)):
            with self.assertRaises(ValueError):
                generation.generate(model, model.block, batch(), config=config(), direction=direction, epsilon=1)
        for overrides in ({"direction": None, "epsilon": 1}, {"epsilon": float("inf")}, {"scale": 0},
                          {"epsilon": True}, {"scale": float("nan")}, {"forward": "module:path"}):
            with self.assertRaises(ValueError):
                generation.generate(model, model.block, batch(), config=config(), **overrides)
        for change in ({"max_new_tokens": 0}, {"max_context_tokens": 3}, {"seed": -1}, {"seed": True},
                       {"pad_token_id": -1}, {"eos_token_id": 1.5}, {"overflow": "silent"}, {"max_forward_tokens": 0}):
            with self.assertRaises(ValueError):
                config(**change)
        for overrides in ({"unrelated_review": ""}, {"unrelated_direction": torch.tensor([2., 0., 0.])},
                          {"unrelated_direction": torch.tensor([-2., 0., 0.])}, {"unrelated_direction": torch.ones(4)},
                          {"epsilon": -1}, {"random_seed": True}):
            args = dict(config=config(), selected_direction=torch.tensor([1., 0., 0.]),
                        unrelated_direction=torch.tensor([0., 1., 0.]), unrelated_review="toy",
                        epsilon=1, scale=1, random_seed=1)
            args.update(overrides)
            with self.assertRaises(ValueError):
                generation.generate_controls(model, model.block, batch(), **args)
        with self.assertRaisesRegex(ValueError, "belong"):
            generation.generate(model, ToyBlock(), batch(), config=config())
        self.assertEqual(model.calls, [])

    def test_output_vocabulary_rejections(self):
        for changes in ({"pad_token_id": 8}, {"eos_token_id": 8}):
            model = ToyCausal()
            with self.assertRaisesRegex(ValueError, "vocabulary"):
                generation.generate(model, model.block, batch(), config=config(**changes))
            self.assertFalse(model.block._forward_hooks)


if __name__ == "__main__":
    unittest.main()
