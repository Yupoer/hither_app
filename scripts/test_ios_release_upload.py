import hashlib
import importlib.util
import io
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

    def test_direct_upload_requires_cancellation_of_the_same_eas_attempt(self):
        upload.write_receipt(self.output / "submission-intent.json", self.identity)
        (self.output / "eas-submit.log").write_text(SCHEDULED)
        with patch.object(upload.subprocess, "run") as run:
            with self.assertRaisesRegex(ValueError, "Confirm cancellation"):
                upload.submit_direct(self.repo, self.output, self.verification, CONFIG)
        run.assert_not_called()

    def test_direct_upload_uses_exact_ipa_and_resumes_from_receipt(self):
        upload.write_receipt(self.output / "submission-intent.json", self.identity)
        (self.output / "eas-submit.log").write_text(SCHEDULED + "The submission has been canceled\n")
        with tempfile.NamedTemporaryFile() as key, patch.dict(upload.os.environ, {
                "ASC_KEY_ID": "TEST123", "ASC_ISSUER_ID": SUBMISSION_ID, "ASC_KEY_PATH": key.name,
        }), patch.object(upload, "require_submit_source") as source, patch.object(
            upload.subprocess, "run", return_value=subprocess.CompletedProcess([], 0),
        ) as run:
            receipt = upload.submit_direct(self.repo, self.output, self.verification, CONFIG)
            self.assertEqual(upload.submit_direct(self.repo, self.output, self.verification, CONFIG), receipt)
        source.assert_called_once_with(self.repo, self.verification)
        run.assert_called_once()
        self.assertEqual(run.call_args.args[0][:4], ["/usr/bin/xcrun", "altool", "--upload-package", str(self.ipa)])
        self.assertEqual(receipt["status"], "uploaded")
        self.assertEqual(receipt["ipaSha256"], self.digest)

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

    def test_changed_ipa_cannot_reach_submission(self):
        self.ipa.write_bytes(b'replaced after verification')
        with patch.object(upload, "git", side_effect=[SOURCE.encode(), b""]), \
                patch.object(upload, "require_master_ci"), \
                patch.object(upload.shutil, "which", return_value="/fake/npx"), \
                patch.object(upload.subprocess, "run") as dispatch:
            with self.assertRaisesRegex(ValueError, "IPA changed before submission"):
                upload.submit_ipa(self.repo, self.output, self.verification, CONFIG)
            dispatch.assert_not_called()
        self.assertFalse((self.output / "submission-intent.json").exists())

    def test_release_directory_keeps_original_verification_for_different_ipa(self):
        path = self.output / "ipa-receipt.json"
        upload.ensure_artifact_receipt(path, self.verification)
        wrong_ipa = {**self.verification, "ipaSha256": "b" * 64}
        with self.assertRaisesRegex(ValueError, "different verified IPA"):
            upload.ensure_artifact_receipt(path, wrong_ipa)
        self.assertEqual(json.loads(path.read_text()), self.verification)

    def test_explicit_prior_receipt_must_identify_same_ipa(self):
        pattern = upload.submission_pattern(CONFIG)
        receipt = upload.parse_submission(f"{SCHEDULED}\n{upload.UPLOAD_SUCCESS}\n", self.identity, pattern)
        path = self.output / "prior.json"
        upload.write_receipt(path, receipt)
        self.assertEqual(upload.load_receipt(path, self.identity, pattern), receipt)
        wrong_ipa = {**self.identity, "ipaSha256": "b" * 64}
        with self.assertRaisesRegex(ValueError, "does not identify"):
            upload.load_receipt(path, wrong_ipa, pattern)

    def cli_arguments(self):
        return ["--source-sha", SOURCE, "--ipa", str(self.ipa), "--sha256", self.digest,
                "--release-dir", str(self.output)]

    def test_existing_ipa_cli_never_submits(self):
        with patch.object(upload, "git", return_value=str(self.repo).encode()), \
                patch.object(upload, "release_directory", return_value=self.output), \
                patch.object(upload, "read_source", return_value=CONFIG), \
                patch.object(upload, "verify_ipa", return_value=self.verification) as verify, \
                patch.object(upload, "submit_ipa") as eas, patch.object(upload, "submit_direct") as apple, \
                patch("sys.stdout", new_callable=io.StringIO) as output, patch("sys.stderr", new_callable=io.StringIO):
            for flags in ([], ["--transport", "apple"], ["--provenance-receipt", str(self.output / "local-build.json")]):
                with self.subTest(flags=flags), self.assertRaises(SystemExit) as exit_error:
                    upload.main([*self.cli_arguments(), *flags])
                self.assertEqual(exit_error.exception.code, 2)
            verify.assert_not_called()
            self.assertEqual(upload.main([*self.cli_arguments(), "--verify-only"]), 0)
            verify.assert_called_once_with(self.ipa, SOURCE, self.digest, CONFIG)
            self.assertEqual(json.loads(output.getvalue()), self.verification)
            eas.assert_not_called()
            apple.assert_not_called()

    def test_existing_ipa_cli_recovers_saved_attempt_without_dispatch(self):
        upload.write_receipt(self.output / "submission-intent.json", self.identity)
        (self.output / "eas-submit.log").write_text(SCHEDULED)
        with patch.object(upload, "git", return_value=str(self.repo).encode()), \
                patch.object(upload, "release_directory", return_value=self.output), \
                patch.object(upload, "read_source", return_value=CONFIG), \
                patch.object(upload, "verify_ipa", return_value=self.verification), \
                patch.object(upload, "submit_ipa") as eas, patch.object(upload, "submit_direct") as apple, \
                patch("sys.stdout", new_callable=io.StringIO) as output, patch("sys.stderr", new_callable=io.StringIO):
            self.assertEqual(upload.main([*self.cli_arguments(), "--submission-status"]), 1)
            receipt = json.loads(output.getvalue())
        self.assertEqual(receipt["easStatus"], "scheduled")
        self.assertEqual(receipt["submissionId"], SUBMISSION_ID)
        eas.assert_not_called()
        apple.assert_not_called()


if __name__ == "__main__":
    unittest.main()
