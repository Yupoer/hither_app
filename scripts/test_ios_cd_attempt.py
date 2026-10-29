"""Run the checked-in CD shell boundaries against local EAS and transport fakes."""

import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import textwrap
import unittest


REPO = Path(__file__).resolve().parents[1]
WORKFLOW = (REPO / ".github/workflows/cd-ios-testflight.yml").read_text()
STEPS = {}
for block in re.split(r"(?=^      - (?:name:|uses:))", WORKFLOW, flags=re.MULTILINE):
    name = re.search(r"^      - name: (.+)$", block, flags=re.MULTILINE)
    if name:
        STEPS[name[1]] = block


FAKE_EAS = r'''
import json, os, sys
from pathlib import Path
args = sys.argv[1:]
root = Path(os.environ['HITHER_FAKE_ROOT'])
fault = os.environ.get('HITHER_FAKE_FAULT', '')
branch = '00000000-0000-4000-8000-000000000001'
update = {'id': '00000000-0000-4000-8000-000000001001',
          'group': '00000000-0000-4000-8000-000000002001',
          'branch': 'production', 'runtimeVersion': '0.1.13', 'platform': 'IOS',
          'gitCommitHash': os.environ['SOURCE_SHA'],
          'message': 'hither release ' + os.environ['SOURCE_SHA'], 'isRollBackToEmbedded': False}
phase = ('ota_publication' if 'env:exec' in args else 'signed_build' if 'build' in args
         else 'eas_upload' if 'submit' in args else None)
if phase:
    with (root / 'accepted.jsonl').open('a') as stream:
        stream.write(json.dumps({'phase': phase, 'args': args}) + '\n')
    if fault == 'accept_then_error':
        sys.exit(17)
    if fault == 'malformed_response':
        print('not-json-private-sentinel')
    elif phase == 'ota_publication':
        print(json.dumps([update]))
    elif phase == 'signed_build':
        Path(args[args.index('--output') + 1]).write_bytes(b'controlled-fake-ipa')
elif 'whoami' in args:
    if fault == 'auth_error':
        sys.exit(19)
elif 'channel:view' in args:
    groups = [[{**update, 'branch': {'id': branch, 'name': 'production'}}]] if (root / 'accepted.jsonl').exists() else []
    if fault == 'blocked_inventory':
        branches, mapping = [], {'version': 0, 'data': []}
    else:
        branches = [{'id': branch, 'name': 'production', 'updateGroups': groups}]
        mapping = {'version': 0, 'data': [{'branchId': branch, 'branchMappingLogic': 'true'}]}
    print(json.dumps({'currentPage': {'name': 'production', 'isPaused': False,
                                     'branchMapping': json.dumps(mapping), 'updateBranches': branches}}))
elif 'update:view' in args:
    if fault == 'readback_error':
        sys.exit(18)
    print(json.dumps([update]))
elif 'build:list' in args:
    print('[]')
elif 'update:list' in args:
    print(json.dumps({'name': 'production', 'currentPage': []}))
else:
    sys.exit(90)
'''


class CdAttemptTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        commands = self.root / "bin"
        commands.mkdir()
        for name, body in (("npx", f"#!{sys.executable}\n" + FAKE_EAS),
                           ("git", '#!/bin/sh\nprintf "%s\\trefs/heads/master\\n" "$SOURCE_SHA"\n'),
                           ("node", '#!/bin/sh\nprintf "0.1.13\\n"\n')):
            path = commands / name
            path.write_text(body)
            path.chmod(0o755)
        self.env = {**os.environ, "PATH": str(commands) + os.pathsep + os.environ["PATH"],
                    "SOURCE_SHA": "a" * 40, "GITHUB_RUN_ID": "12345", "GITHUB_RUN_ATTEMPT": "1",
                    "GITHUB_REF": "refs/heads/master", "RELEASE_MODE": "ota",
                    "EXPO_TOKEN": "offline-fixture", "RUNNER_TEMP": str(self.root),
                    "GITHUB_STEP_SUMMARY": str(self.root / "summary.md"),
                    "HITHER_FAKE_ROOT": str(self.root), "INTENT_RETAINED": "success", "JOB_STATUS": "failure"}

    def run_step(self, name, cwd=None):
        block = STEPS[name]
        lines = block.split("        run: |\n", 1)[1].splitlines()
        script = []
        for line in lines:
            if line.strip() and not line.startswith("          "):
                break
            script.append(line)
        command = textwrap.dedent("\n".join(script))
        if cwd is None:
            cwd = REPO if "        working-directory: .\n" in block else REPO / "apps/mobile"
        return subprocess.run(["bash", "--noprofile", "--norc", "-eo", "pipefail", "-c", command],
                              cwd=cwd, env=self.env, capture_output=True, text=True)

    def accepted(self):
        path = self.root / "accepted.jsonl"
        return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []

    def events(self):
        path = self.root / "hither-ios-cd-journal.jsonl"
        self.assertTrue(path.exists(), "failed attempt must retain a journal")
        events = [json.loads(line) for line in path.read_text().splitlines()]
        self.assertTrue(all(set(event) == {"sourceSha", "runId", "runAttempt", "mode", "phase", "status"}
                            for event in events))
        return events

    def prepare(self, phase, transport=True):
        names = {"ota_publication": "Prepare production iOS OTA intent", "signed_build": "Prepare signed build intent",
                 "eas_upload": "Prepare TestFlight upload intent"}
        name = names[phase]
        if name in STEPS:
            result = self.run_step(name)
            self.assertEqual(result.returncode, 0, result.stderr)
            intent = self.root / f"hither-ios-cd-intent-{phase}.json"
            self.assertEqual(json.loads(intent.read_text())["status"], "unknown")
            if transport:
                retained = self.root / "retained"
                retained.mkdir(exist_ok=True)
                shutil.copyfile(intent, retained / intent.name)
        self.env["INTENT_RETAINED"] = "success" if transport else "failure"

    def finalize(self, inventory=False, cwd=None):
        name = "Finalize inventory attempt outcome" if inventory else "Finalize iOS attempt outcome"
        if name in STEPS:
            result = self.run_step(name, cwd=cwd)
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_accepted_ota_command_error_keeps_durable_unknown_intent(self):
        self.prepare("ota_publication")
        self.env["HITHER_FAKE_FAULT"] = "accept_then_error"
        result = self.run_step("Publish and verify production iOS OTA")
        self.assertEqual(result.returncode, 17, result.stderr)
        self.finalize()
        self.assertEqual(len(self.accepted()), 1)
        self.assertEqual((self.events()[-1]["phase"], self.events()[-1]["status"]), ("ota_publication", "unknown"))
        self.assertTrue((self.root / "retained/hither-ios-cd-intent-ota_publication.json").exists())
        self.assertFalse((self.root / "hither-ota-receipt.json").exists())

    def test_malformed_response_and_failed_readback_do_not_erase_publication_uncertainty(self):
        for fault in ("malformed_response", "readback_error"):
            with self.subTest(fault=fault):
                self.setUp()
                self.prepare("ota_publication")
                self.env["HITHER_FAKE_FAULT"] = fault
                result = self.run_step("Publish and verify production iOS OTA")
                self.assertNotEqual(result.returncode, 0)
                self.finalize()
                expected = "unknown" if fault == "malformed_response" else "passed"
                publication = [event for event in self.events() if event["phase"] == "ota_publication"][-1]
                self.assertEqual(publication["status"], expected)
                self.assertFalse((self.root / "hither-ota-receipt.json").exists())
                self.assertEqual(len(self.accepted()), 1)

    def test_all_mutations_require_successful_intent_transport(self):
        for phase, mode, name in (("ota_publication", "ota", "Publish and verify production iOS OTA"),
                                  ("signed_build", "build-only", "Build signed production IPA on this runner"),
                                  ("eas_upload", "submit", "Upload this IPA to TestFlight")):
            with self.subTest(phase=phase):
                self.setUp()
                self.env["RELEASE_MODE"] = mode
                self.prepare(phase, transport=False)
                self.assertNotEqual(self.run_step(name).returncode, 0)
                self.assertEqual(self.accepted(), [])

    def test_write_mode_reruns_fail_before_provider_mutation(self):
        for mode in ("ota", "build-only", "submit"):
            for attempt in ("2", "", "not-a-number"):
                with self.subTest(mode=mode, attempt=attempt):
                    self.env.update(RELEASE_MODE=mode, GITHUB_RUN_ATTEMPT=attempt)
                    result = self.run_step("Validate trusted dispatch")
                    self.assertNotEqual(result.returncode, 0)
                    self.assertEqual(self.accepted(), [])
        self.env["GITHUB_RUN_ATTEMPT"] = "2"
        for mode in ("preflight", "validate-release"):
            self.env["RELEASE_MODE"] = mode
            self.assertEqual(self.run_step("Validate trusted dispatch").returncode, 0)

    def test_submit_wait_success_is_upload_complete_with_apple_unknown(self):
        self.env["RELEASE_MODE"] = "submit"
        self.prepare("eas_upload")
        self.assertEqual(self.run_step("Upload this IPA to TestFlight").returncode, 0)
        self.env["JOB_STATUS"] = "success"
        self.finalize()
        events = {(event["phase"], event["status"]) for event in self.events()}
        self.assertIn(("eas_upload", "passed"), events)
        self.assertIn(("apple_processing", "unknown"), events)
        receipt = json.loads((self.root / "hither-ios-upload-receipt.json").read_text())
        self.assertEqual(receipt["easUpload"], "reported_complete")
        self.assertEqual(receipt["appleProcessing"], "unknown")
        self.assertEqual(self.accepted()[0]["args"][self.accepted()[0]["args"].index("--path") + 1],
                         str(self.root / "Hither-production.ipa"))

    def test_submit_and_build_accept_then_error_stay_unknown(self):
        for phase, mode, name in (("eas_upload", "submit", "Upload this IPA to TestFlight"),
                                  ("signed_build", "build-only", "Build signed production IPA on this runner")):
            with self.subTest(phase=phase):
                self.setUp()
                self.env.update(RELEASE_MODE=mode, HITHER_FAKE_FAULT="accept_then_error")
                self.prepare(phase)
                self.assertEqual(self.run_step(name).returncode, 17)
                self.finalize()
                self.assertEqual((self.events()[-1]["phase"], self.events()[-1]["status"]), (phase, "unknown"))
                self.assertFalse((self.root / "hither-ios-upload-receipt.json").exists())

    def test_inventory_block_and_early_auth_failure_preserve_failures(self):
        self.env.update(RELEASE_MODE="inspect-release", HITHER_FAKE_FAULT="blocked_inventory")
        result = self.run_step("Read EAS production iOS metadata")
        self.assertNotEqual(result.returncode, 0)
        self.finalize(inventory=True)
        receipt = self.root / "hither-ios-inventory.json"
        self.assertEqual(json.loads(receipt.read_text())["inventoryStatus"], "blocked")
        self.assertIn("if: always()", STEPS["Upload sanitized inventory receipt"])
        self.assertEqual(self.events()[-1]["status"], "failed")
        receipt.unlink()
        self.env["HITHER_FAKE_FAULT"] = "auth_error"
        self.assertEqual(self.run_step("Read EAS production iOS metadata").returncode, 19)
        self.finalize(inventory=True)
        self.assertFalse(receipt.exists())
        self.assertEqual(self.events()[-1]["phase"], "inventory")

    def test_checkout_failure_fallback_serializes_only_safe_identity(self):
        self.env.update(SOURCE_SHA="https://private.invalid/token", RELEASE_MODE="private-sentinel")
        self.finalize(cwd=self.root)
        event = self.events()[-1]
        self.assertIsNone(event["sourceSha"])
        self.assertIsNone(event["mode"])
        self.assertEqual((event["phase"], event["status"]), ("dispatch", "failed"))
        self.assertNotIn("private", json.dumps(event))


if __name__ == "__main__":
    unittest.main()
