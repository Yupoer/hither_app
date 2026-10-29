"""Exercise strict per-attempt evidence through the real writer CLI."""

import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).with_name("write-ios-cd-outcome.py")
KEYS = {"sourceSha", "runId", "runAttempt", "mode", "phase", "status"}
SOURCE = "a" * 40


class CdOutcomeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.journal = self.root / "journal.jsonl"
        self.identity = {"SOURCE_SHA": SOURCE, "GITHUB_RUN_ID": "12345",
                         "GITHUB_RUN_ATTEMPT": "1", "RELEASE_MODE": "ota"}

    def run_writer(self, *args, identity=None):
        return subprocess.run([sys.executable, str(SCRIPT), "--journal", str(self.journal), *args],
                              env={**os.environ, **self.identity, **(identity or {})},
                              capture_output=True, text=True)

    def events(self):
        events = [json.loads(line) for line in self.journal.read_text().splitlines()]
        self.assertTrue(all(set(event) == KEYS for event in events))
        return events

    def test_unknown_intent_is_immutable_and_final_outcome_is_separate(self):
        intent = self.root / "intent.json"
        result = self.run_writer("--phase", "ota_publication", "--status", "unknown",
                                 "--intent", str(intent))
        self.assertEqual(result.returncode, 0, result.stderr)
        original = intent.read_bytes()
        self.assertEqual(json.loads(original), self.events()[-1])
        result = self.run_writer("--phase", "ota_publication", "--status", "passed")
        self.assertEqual(result.returncode, 0, result.stderr)
        outcome = self.root / "outcome.json"
        result = self.run_writer("--finalize", "--job-status", "failure", "--outcome", str(outcome))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(intent.read_bytes(), original)
        self.assertEqual(json.loads(outcome.read_text())["phase"], "setup")
        self.assertEqual(self.events()[-1]["status"], "failed")
        result = self.run_writer("--phase", "ota_publication", "--status", "unknown",
                                 "--intent", str(intent))
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(intent.read_bytes(), original)

    def test_failed_or_cancelled_write_stays_unknown(self):
        for job_status in ("failure", "cancelled"):
            with self.subTest(job_status=job_status):
                self.journal.unlink(missing_ok=True)
                self.assertEqual(self.run_writer("--phase", "eas_upload", "--status", "unknown").returncode, 0)
                result = self.run_writer("--finalize", "--job-status", job_status,
                                         "--outcome", str(self.root / "outcome.json"))
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(self.events()[-1]["status"], "unknown")

    def test_readback_failure_preserves_accepted_publication(self):
        for phase, status in (("ota_publication", "passed"), ("ota_readback", "unknown")):
            self.assertEqual(self.run_writer("--phase", phase, "--status", status).returncode, 0)
        result = self.run_writer("--finalize", "--job-status", "failure",
                                 "--outcome", str(self.root / "outcome.json"))
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual([(event["phase"], event["status"]) for event in self.events()],
                         [("ota_publication", "passed"), ("ota_readback", "unknown"), ("ota_readback", "failed")])

    def test_job_failure_after_a_read_only_start_is_failed(self):
        self.assertEqual(self.run_writer("--phase", "inventory", "--status", "unknown").returncode, 0)
        self.assertEqual(self.run_writer("--finalize", "--job-status", "failure",
                                        "--outcome", str(self.root / "outcome.json")).returncode, 0)
        self.assertEqual(self.events()[-1]["status"], "failed")

    def test_strict_identity_and_finite_fields_reject_private_input(self):
        bad = "https://private.invalid/token-private-sentinel"
        for key in self.identity:
            for value in (bad, "", "0"):
                with self.subTest(key=key, value=value):
                    result = self.run_writer("--phase", "setup", "--status", "unknown", identity={key: value})
                    self.assertNotEqual(result.returncode, 0)
                    self.assertFalse(self.journal.exists())
        for phase, status in ((bad, "unknown"), ("setup", bad)):
            result = self.run_writer("--phase", phase, "--status", status)
            self.assertNotEqual(result.returncode, 0)
            self.assertFalse(self.journal.exists())
        self.assertEqual(self.run_writer("--phase", "setup", "--status", "unknown").returncode, 0)
        self.assertNotIn(bad, self.journal.read_text())

    def test_existing_journal_rejects_extra_fields_changed_identity_and_partial_json(self):
        self.assertEqual(self.run_writer("--phase", "setup", "--status", "unknown").returncode, 0)
        original = self.journal.read_bytes()
        for identity in ({"GITHUB_RUN_ATTEMPT": "2"}, {"GITHUB_RUN_ID": "67890"},
                         {"SOURCE_SHA": "b" * 40}, {"RELEASE_MODE": "submit"}):
            result = self.run_writer("--phase", "setup", "--status", "passed", identity=identity)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(self.journal.read_bytes(), original)
        for malformed in (original.decode().rstrip()[:-1],
                          json.dumps({**json.loads(original), "private": "private-sentinel"}) + "\n",
                          json.dumps({**json.loads(original), "runAttempt": True}) + "\n"):
            self.journal.write_text(malformed)
            result = self.run_writer("--phase", "setup", "--status", "passed")
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(self.journal.read_text(), malformed)

    def test_two_new_dispatches_at_same_source_have_distinct_identities(self):
        self.assertEqual(self.run_writer("--phase", "dispatch", "--status", "passed").returncode, 0)
        first = self.events()[0]
        self.journal = self.root / "second.jsonl"
        self.assertEqual(self.run_writer("--phase", "dispatch", "--status", "passed",
                                        identity={"GITHUB_RUN_ID": "67890"}).returncode, 0)
        self.assertEqual(first["sourceSha"], self.events()[0]["sourceSha"])
        self.assertNotEqual(first["runId"], self.events()[0]["runId"])


if __name__ == "__main__":
    unittest.main()
