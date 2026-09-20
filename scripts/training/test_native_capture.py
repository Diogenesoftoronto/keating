"""Authored native-sampler doubles; no provider calls or invented live evidence."""
import json
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest

from benchmark_tinker_bridge import Bridge, NativeSampler
from native_capture import append_capture, captured_sample
from test_benchmark_tinker_bridge import FakePrompt, FakeSampler, payload


class Params:
    def __init__(self, **settings): self.settings = settings
    def model_dump(self, mode): return dict(self.settings)


class NativeCaptureTests(unittest.TestCase):
    def test_original_arrays_are_emitted_before_any_parser(self):
        order = []
        sequence = SimpleNamespace(tokens=[101, 707, 303], logprobs=[-.2, -.8, -.4], stop_reason="stop")
        def sample(prompt, **kwargs):
            order.append("sample")
            self.assertEqual(kwargs["num_samples"], 1)
            return SimpleNamespace(result=lambda timeout: SimpleNamespace(sequences=[sequence]))
        records = []
        def emit(record):
            order.append(record["phase"])
            records.append(record)
        result = captured_sample(SimpleNamespace(sample=sample), FakePrompt(),
                                 Params(temperature=1., top_p=1., top_k=-1, max_tokens=10), emit)
        self.assertIs(result, sequence)
        self.assertEqual(order, ["prepared", "sample", "sampled"])
        self.assertEqual(records[0]["prompt_token_ids"], [1, 2, 3, 4, 5, 6, 7])
        self.assertEqual(records[1]["completion_token_ids"], [101, 707, 303])
        self.assertEqual(records[1]["provider_logprobs"], [-.2, -.8, -.4])
        self.assertIsNone(records[1]["token_roles"])
        sequence.tokens[0] = 999
        self.assertEqual(records[1]["completion_token_ids"][0], 101)

    def test_capture_storage_failure_prevents_sampling(self):
        def fail(_): raise OSError("authored journal failure")
        def sample(*args, **kwargs): self.fail("sampled without durable prepared record")
        with self.assertRaises(OSError):
            captured_sample(SimpleNamespace(sample=sample), FakePrompt(), Params(), fail)

    def test_parser_failure_preserves_native_ids_and_missing_probabilities(self):
        sampler = NativeSampler.__new__(NativeSampler)
        sampler.tinker = SimpleNamespace(SamplingParams=Params)
        def fail_parse(_): raise ValueError("authored parser failure")
        sampler.renderer = SimpleNamespace(get_stop_sequences=lambda: [999], parse_response=fail_parse)
        sequence = SimpleNamespace(tokens=[11, 12, 999], logprobs=None, stop_reason="stop")
        sampler.client = SimpleNamespace(sample=lambda *a, **k: SimpleNamespace(
            result=lambda timeout: SimpleNamespace(sequences=[sequence])))
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "raw.jsonl"
            with self.assertRaisesRegex(ValueError, "parser failure"):
                sampler.sample_with_capture(FakePrompt(), {"max_tokens": 10}, lambda row: append_capture(path, row))
            rows = [json.loads(line) for line in path.read_text().splitlines()]
            self.assertEqual([r["phase"] for r in rows], ["prepared", "sampled"])
            self.assertEqual(rows[1]["completion_token_ids"], [11, 12, 999])
            self.assertIsNone(rows[1]["provider_logprobs"])
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_bridge_response_identity_links_three_capture_phases(self):
        class CapturingFake(FakeSampler):
            def sample_with_capture(self, prompt, settings, emit):
                emit({"phase": "prepared", "prompt_token_ids": prompt.to_ints(), "sampling_params": settings})
                emit({"phase": "sampled", "completion_token_ids": [8, 9, 10], "provider_logprobs": None})
                return super().sample(prompt, settings)
        with tempfile.TemporaryDirectory() as directory:
            result = Bridge(b"private-authored-key", directory, sampler_factory=CapturingFake).complete(payload())
            rows = [json.loads(line) for line in (Path(directory) / "raw-captures.jsonl").read_text().splitlines()]
            self.assertEqual([r["phase"] for r in rows], ["prepared", "sampled", "parsed"])
            self.assertTrue(all(r["response_id"] == result["id"] and r["training_eligible"] is False for r in rows))
            self.assertEqual(rows[0]["original_request"], payload())
            self.assertEqual(rows[2]["message"], result["choices"][0]["message"])
            self.assertNotIn("private-authored-key", json.dumps(rows))
            self.assertNotIn("Exact Keating prompt", (Path(directory) / "usage.jsonl").read_text())

    def test_journal_rejects_symlink(self):
        with tempfile.TemporaryDirectory() as directory:
            target, link = Path(directory) / "target", Path(directory) / "link"
            target.write_text("keep")
            link.symlink_to(target)
            with self.assertRaises(OSError): append_capture(link, {"phase": "prepared"})
            self.assertEqual(target.read_text(), "keep")


if __name__ == "__main__":
    unittest.main()
