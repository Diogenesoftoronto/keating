import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("prepare_seed", Path(__file__).with_name("prepare_seed.py"))
seed = importlib.util.module_from_spec(spec)
spec.loader.exec_module(seed)


class SeedTests(unittest.TestCase):
    def fixture(self, root):
        sessions, feedback, families = [], [], []
        for i in range(3):
            sid = f"session-{i}"
            sessions.append({"data": {"id": sid, "messages": [
                {"role": "user", "content": f"Explain example {i}", "timestamp": 10},
                {"role": "assistant", "content": [{"type": "thinking", "thinking": "hidden"},
                 {"type": "text", "text": "<analysis>hidden too</analysis>Old answer"}], "timestamp": 20}]}})
            feedback.append({"id": f"f{i}", "source": "explicit", "signal": "thumbs-down",
                             "sessionId": sid, "messageId": "assistant-99-20", "createdAt": 30,
                             "evidence": f"Please verify example {i}."})
            families.append({"familyHash": seed.sha("keating-case-study-subject-family-v1\0" + sid),
                             "sessionHashes": [seed.sha(sid)], "included": True})
        portable = root / "portable.json"
        portable.write_text(json.dumps({"sessions": sessions, "storage": {"feedback": feedback}}))
        training = root / "training.zip"
        training.write_bytes(b"provenance-only-archive")
        ledger = root / "ledger.json"
        ledger.write_text(json.dumps({"metadata": {"portableSha256": seed.sha(portable.read_bytes())}, "families": families}))
        audit = root / "audit.json"
        audit.write_text(json.dumps({"inputs": [{"role": role, "sha256": seed.sha(p.read_bytes())}
                                               for role, p in [("portable", portable), ("training", training)]]}))
        return portable, training, ledger, audit

    def test_disjoint_reproducible_split_and_no_hidden_targets(self):
        with tempfile.TemporaryDirectory() as directory:
            paths = self.fixture(Path(directory))
            rows, manifest = seed.prepare(*paths)
            self.assertEqual(manifest["split_counts"], {"train": 2, "validation": 1})
            self.assertEqual((rows, manifest), seed.prepare(*paths))
            train = {r["family_id"] for r in rows if r["split"] == "train"}
            validation = {r["family_id"] for r in rows if r["split"] == "validation"}
            self.assertFalse(train & validation)
            self.assertTrue(all(r["historical_response"] == "Old answer" for r in rows))
            self.assertTrue(all(r["provenance"]["message_index"] == 1 for r in rows))
            self.assertNotIn("Old answer", str([r["prompt"] for r in rows]))

    def test_source_drift_fails_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            paths = self.fixture(Path(directory))
            paths[0].write_text(paths[0].read_text() + " ")
            with self.assertRaisesRegex(ValueError, "SHA-256"):
                seed.prepare(*paths)

    def test_ambiguous_target_excluded(self):
        with tempfile.TemporaryDirectory() as directory:
            paths = self.fixture(Path(directory))
            data = json.loads(paths[0].read_text())
            data["sessions"][0]["data"]["messages"].append(data["sessions"][0]["data"]["messages"][-1])
            paths[0].write_text(json.dumps(data))
            digest = seed.sha(paths[0].read_bytes())
            ledger = json.loads(paths[2].read_text()); ledger["metadata"]["portableSha256"] = digest
            paths[2].write_text(json.dumps(ledger))
            audit = json.loads(paths[3].read_text()); audit["inputs"][0]["sha256"] = digest
            paths[3].write_text(json.dumps(audit))
            rows, manifest = seed.prepare(*paths)
            self.assertEqual(len(rows), 2)
            self.assertEqual(manifest["excluded"]["ambiguous_or_missing_target"], 1)

    def test_hidden_and_secret_screening(self):
        self.assertEqual(seed.visible("shown<think>one<analysis>two</analysis>three</think>end"), "shownend")
        self.assertEqual(seed.visible("shown<thinking>unfinished"), "shown")
        self.assertTrue(seed.SECRET.search("api_key = sk-abcdefghijklmnopqrstuvwxyz"))
        self.assertIsNone(seed.SECRET.search("Explain how API keys work."))

    def test_copied_history_must_stay_in_one_family(self):
        with tempfile.TemporaryDirectory() as directory:
            paths = self.fixture(Path(directory))
            ledger = json.loads(paths[2].read_text())
            ledger["lineage"] = {"exactHistoryJoins": [{"sessionHash": seed.sha("session-0"),
                                                       "matchedSessionHash": seed.sha("session-1")} ]}
            paths[2].write_text(json.dumps(ledger))
            with self.assertRaisesRegex(ValueError, "Copied history"):
                seed.prepare(*paths)


if __name__ == "__main__":
    unittest.main()
