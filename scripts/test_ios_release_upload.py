import hashlib
import importlib.util
import json
from pathlib import Path
import plistlib
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import zipfile


spec = importlib.util.spec_from_file_location("upload", Path(__file__).with_name("ios-release-upload.py"))
upload = importlib.util.module_from_spec(spec)
spec.loader.exec_module(upload)

CONFIG = {
    "version": "0.1.16",
    "runtimeVersion": "0.1.16",
    "updates": {"url": "https://u.expo.dev/example"},
    "owner": "yupoer",
    "slug": "hither",
}
SOURCE = "a" * 40
SUBMISSION_ID = "c29d9901-9262-40a7-9703-b481d306188f"
SUBMISSION_URL = f"https://expo.dev/accounts/yupoer/projects/hither/submissions/{SUBMISSION_ID}"
SCHEDULED = f"✔ Scheduled iOS submission\n\nSubmission details: {SUBMISSION_URL}\n"


class UploadTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.repo = Path(temp.name)
        self.output = self.repo / "release"
        self.output.mkdir()
        self.ipa = self.output / "test.ipa"
        self.make_ipa()

    def make_ipa(self, *, widget_build="87", channel="production"):
        with zipfile.ZipFile(self.ipa, "w") as archive:
            for bundle, identifier, executable, build in (
                ("Payload/Hither.app", upload.APP_ID, "Hither", "87"),
                ("Payload/Hither.app/PlugIns/Widget.appex", upload.WIDGET_ID, "Widget", widget_build),
            ):
                archive.writestr(f"{bundle}/{executable}", b"executable")
                archive.writestr(f"{bundle}/Info.plist", plistlib.dumps({
                    "CFBundleIdentifier": identifier, "CFBundleExecutable": executable,
                    "CFBundleShortVersionString": CONFIG["version"], "CFBundleVersion": build,
                }))
            archive.writestr("Payload/Hither.app/Expo.plist", plistlib.dumps({
                "EXUpdatesEnabled": True, "EXUpdatesRuntimeVersion": CONFIG["runtimeVersion"],
                "EXUpdatesURL": CONFIG["updates"]["url"], "EXUpdatesRequestHeaders": {"expo-channel-name": channel},
            }))
        self.digest = hashlib.sha256(self.ipa.read_bytes()).hexdigest()
        self.identity = {"sourceSha": SOURCE, "ipaSha256": self.digest, "appVersion": CONFIG["version"],
                         "buildNumber": "87"}
        self.verification = {**self.identity, "ipa": str(self.ipa)}

    def verify_fixture(self):
        uuids = [{"architecture": "arm64", "uuid": "00EC8EDA-B242-364F-B804-158C5DBF7373"}]

        def command_check(tool, *arguments):
            if tool.endswith("ditto"):
                with zipfile.ZipFile(arguments[-2]) as archive:
                    archive.extractall(arguments[-1])
            else:
                self.assertEqual(tool, "/usr/bin/codesign")
                self.assertEqual(arguments[:3], ("--verify", "--deep", "--strict"))

        helpers = {"sha256": lambda path: hashlib.sha256(path.read_bytes()).hexdigest(),
                   "dwarf_uuids": lambda executable: uuids if executable.is_file() else []}
        with patch.object(upload, "command_check", side_effect=command_check), patch.object(
                upload.runpy, "run_path", return_value=helpers):
            return upload.verify_ipa(self.ipa, SOURCE, self.digest, CONFIG)

    def test_verifies_both_bundle_uuids_and_production_identity(self):
        metadata = self.verify_fixture()
        self.assertEqual((metadata["ipaSha256"], metadata["appVersion"], metadata["buildNumber"],
                          metadata["channel"]), (self.digest, "0.1.16", "87", "production"))
        self.assertEqual([binary["bundleIdentifier"] for binary in metadata["binaries"]],
                         [upload.APP_ID, upload.WIDGET_ID])
        self.assertTrue(all(binary["uuids"] for binary in metadata["binaries"]))

    def test_rejects_wrong_hash_and_archive_traversal_before_native_verification(self):
        with patch.object(upload, "command_check") as native:
            with self.assertRaisesRegex(ValueError, "SHA-256"):
                upload.verify_ipa(self.ipa, SOURCE, "0" * 64, CONFIG)
            with zipfile.ZipFile(self.ipa, "a") as archive:
                archive.writestr("../escape", b"unsafe")
            digest = hashlib.sha256(self.ipa.read_bytes()).hexdigest()
            with self.assertRaisesRegex(ValueError, "unsafe archive entry"):
                upload.verify_ipa(self.ipa, SOURCE, digest, CONFIG)
            native.assert_not_called()

    def test_rejects_wrong_widget_build_or_embedded_channel(self):
        for widget, channel, error in (("88", "production", "versions/build"), ("87", "preview", "production channel")):
            with self.subTest(widget=widget, channel=channel):
                self.make_ipa(widget_build=widget, channel=channel)
                with self.assertRaisesRegex(ValueError, error):
                    self.verify_fixture()

    def test_dispatch_waits_for_exact_path_and_reuse_reads_receipt(self):
        def run(command, **kwargs):
            self.assertEqual(kwargs["cwd"], self.repo / "apps/mobile")
            self.assertEqual(command[1:], ["--yes", "eas-cli@21.0.2", "submit", "--platform", "ios",
                                           "--profile", "production", "--path", str(self.ipa), "--non-interactive", "--wait"])
            intent = self.output / "submission-intent.json"
            self.assertEqual(json.loads(intent.read_text()), self.identity)
            kwargs["stdout"].write(f"{SCHEDULED}\n{upload.UPLOAD_SUCCESS}\n".encode())
            return subprocess.CompletedProcess(command, 0)

        with patch.object(upload, "git", side_effect=[SOURCE.encode(), b""]), patch.object(
                upload, "require_master_ci") as require_ci, patch.object(
                upload.shutil, "which", return_value="/fake/npx"), patch.object(
                upload.subprocess, "run", side_effect=run) as dispatch:
            first = upload.submit_ipa(self.repo, self.output, self.verification, CONFIG)
            second = upload.submit_ipa(self.repo, self.output, self.verification, CONFIG)
            require_ci.assert_called_once_with(SOURCE)
            dispatch.assert_called_once()

        self.assertEqual(first, second)
        self.assertEqual(first["easStatus"], "uploaded")
        self.assertEqual(first["submissionId"], SUBMISSION_ID)
        self.assertEqual(first["appleProcessing"], "unknown")

    def test_interrupted_dispatch_reconciles_log_without_retry(self):
        upload.write_receipt(self.output / "submission-intent.json", self.identity)
        log = self.output / "eas-submit.log"
        with patch.object(upload.subprocess, "run") as dispatch:
            self.assertEqual(upload.submit_ipa(self.repo, self.output, self.verification, CONFIG)["easStatus"], "unknown")
            log.write_text(SCHEDULED)
            self.assertEqual(upload.submit_ipa(self.repo, self.output, self.verification, CONFIG)["easStatus"], "scheduled")
            log.write_text(f"{SCHEDULED}\n{upload.UPLOAD_SUCCESS}\n")
            self.assertEqual(upload.submit_ipa(self.repo, self.output, self.verification, CONFIG)["easStatus"], "uploaded")
            dispatch.assert_not_called()

    def test_release_directory_keeps_original_verification_for_different_ipa(self):
        path = self.output / "ipa-receipt.json"
        upload.ensure_artifact_receipt(path, self.verification)
        wrong_ipa = {**self.verification, "ipaSha256": "b" * 64}
        with self.assertRaisesRegex(ValueError, "different verified IPA"):
            upload.ensure_artifact_receipt(path, wrong_ipa)
        self.assertEqual(json.loads(path.read_text()), self.verification)

    def test_explicit_prior_receipt_must_identify_same_ipa(self):
        receipt = upload.parse_submission(f"{SCHEDULED}\n{upload.UPLOAD_SUCCESS}\n", self.identity,
                                          upload.submission_pattern(CONFIG))
        path = self.output / "prior.json"
        upload.write_receipt(path, receipt)
        with patch.object(upload.subprocess, "run") as dispatch:
            observed = upload.submit_ipa(self.repo, self.output, self.verification, CONFIG, path)
            self.assertEqual(observed, receipt)
            wrong_ipa = {**self.verification, "ipaSha256": "b" * 64}
            with self.assertRaisesRegex(ValueError, "does not identify"):
                upload.submit_ipa(self.repo, self.output, wrong_ipa, CONFIG, path)
            dispatch.assert_not_called()


if __name__ == "__main__":
    unittest.main()
