#!/usr/bin/env python3
"""Exercise the OTA release gate against real Git history."""

import json
from pathlib import Path
import plistlib
import subprocess
import sys
import tempfile
import unittest


GATE = Path(__file__).with_name("check-ios-ota-compatibility.py")


class IosOtaCompatibilityTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.repo = Path(self.temp.name)
        self.git("init", "-q")
        self.git("config", "user.name", "Release Gate Test")
        self.git("config", "user.email", "release-gate@example.invalid")
        self.write("apps/mobile/app.json", json.dumps({"expo": {
            "version": "0.1.13", "runtimeVersion": "0.1.13",
            "updates": {"url": "https://u.expo.dev/test"},
        }}))
        self.write("apps/mobile/eas.json", json.dumps({"build": {
            "production": {"channel": "production"},
        }}))
        self.write("apps/mobile/ios/Hither/Supporting/Expo.plist", plistlib.dumps({
            "EXUpdatesEnabled": True,
            "EXUpdatesRuntimeVersion": "0.1.13",
            "EXUpdatesURL": "https://u.expo.dev/test",
        }))
        self.write("apps/mobile/src/screens/MapScreen/Screen.tsx", "export const label = '開始';\n")
        self.write("apps/mobile/modules/hither-location/ios/Location.swift", "let profile = 1\n")
        self.commit("binary source")
        self.binary_source = self.git("rev-parse", "HEAD").strip()
        self.write("docs/binary.md", f"Verified installed binary source {self.binary_source}, "
                   "version/runtime 0.1.13, build 77, production, IN_BETA_TESTING\n")
        self.write("release/ios-production-binary.json", json.dumps({
            "platform": "ios", "channel": "production", "sourceSha": self.binary_source,
            "runtimeVersion": "0.1.13", "appVersion": "0.1.13", "buildNumber": "77",
            "appleState": "IN_BETA_TESTING", "evidence": "docs/binary.md",
        }))
        self.commit("record installed binary")

    def git(self, *args):
        return subprocess.run(["git", *args], cwd=self.repo, check=True,
                              capture_output=True, text=True).stdout

    def write(self, name, data):
        path = self.repo / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data if isinstance(data, bytes) else data.encode())

    def commit(self, message):
        self.git("add", ".")
        self.git("commit", "-qm", message)

    def gate(self, manifest="release/ios-production-binary.json"):
        source = self.git("rev-parse", "HEAD").strip()
        run = subprocess.run([sys.executable, str(GATE), "--source-sha", source,
                              "--manifest", manifest], cwd=self.repo,
                             capture_output=True, text=True)
        self.assertFalse(run.stderr, run.stderr)
        return run.returncode, json.loads(run.stdout)

    def record_reviewed_compatibility(self):
        native = "apps/mobile/modules/hither-location/ios/Location.swift"
        wrapper = "apps/mobile/src/native/locationHealth.ts"
        self.write(native, "let profile = 2\n")
        self.write(wrapper, "export const health = 'waiting';\n")
        self.commit("review compatible native inputs")
        record = {
            "schemaVersion": 2, "kind": "reviewed_compatibility",
            "platform": "ios", "channel": "production", "binarySourceSha": None,
            "comparisonBaselineSha": self.binary_source,
            "runtimeVersion": "0.1.13", "appVersion": "0.1.13", "buildNumber": "77",
            "appleState": "IN_BETA_TESTING", "evidence": "docs/binary.md",
            "reviewedMobilePaths": {
                native: {
                    "baselineBlobSha": self.git("rev-parse", f"{self.binary_source}:{native}").strip(),
                    "reviewedBlobSha": self.git("rev-parse", f"HEAD:{native}").strip(),
                },
                wrapper: {
                    "baselineBlobSha": None,
                    "reviewedBlobSha": self.git("rev-parse", f"HEAD:{wrapper}").strip(),
                },
            },
        }
        self.write("docs/binary.md", f"reviewed_compatibility baseline {self.binary_source}, "
                   "binary source unknown, version/runtime 0.1.13, build 77, "
                   "production, IN_BETA_TESTING\n")
        self.write("release/ios-production-binary.json", json.dumps(record))
        self.commit("record reviewed compatibility without binary provenance")
        return record

    def test_pure_ui_change_can_use_matching_binary(self):
        self.write("apps/mobile/src/screens/MapScreen/Screen.tsx",
                   "export const label = '';\n")
        self.commit("show only icon")
        code, result = self.gate()
        self.assertEqual(code, 0)
        self.assertTrue(result["eligible"])
        self.assertEqual(result["reason"], "compatible")
        self.assertEqual(result["runtimeVersion"], "0.1.13")

    def test_non_object_binary_records_return_structured_rejection(self):
        for value in ([], None, "private-untrusted-value", 42, True):
            with self.subTest(value=value):
                self.write("release/wrong-root.json", json.dumps(value))
                code, result = self.gate("release/wrong-root.json")
                self.assertNotEqual(code, 0)
                self.assertFalse(result["eligible"])
                self.assertEqual(result["reason"], "invalid_binary_record")

    def test_runtime_change_requires_new_binary(self):
        self.write("apps/mobile/app.json", json.dumps({"expo": {
            "version": "0.1.14", "runtimeVersion": "0.1.14",
            "updates": {"url": "https://u.expo.dev/test"},
        }}))
        self.commit("bump runtime")
        code, result = self.gate()
        self.assertNotEqual(code, 0)
        self.assertEqual(result["reason"], "binary_runtime_or_channel_mismatch")

    def test_native_module_and_package_changes_require_new_binary(self):
        self.write("apps/mobile/modules/hither-location/ios/Location.swift", "// native\n")
        self.write("apps/mobile/package-lock.json", "{}\n")
        self.write("apps/mobile/src/screens/MapScreen/Screen.tsx", "export const label = '';\n")
        self.commit("change native inputs and UI")
        code, result = self.gate()
        self.assertNotEqual(code, 0)
        self.assertEqual(result["reason"], "mobile_native_or_config_changed")
        self.assertEqual(result["nonOtaMobilePaths"], [
            "apps/mobile/modules/hither-location/ios/Location.swift",
            "apps/mobile/package-lock.json",
        ])

    def test_native_wrapper_and_asset_changes_require_new_binary(self):
        self.write("apps/mobile/src/native/location.ts", "export const newNativeApi = true;\n")
        self.write("apps/mobile/assets/icon.png", b"icon")
        self.commit("change native wrapper and icon")
        code, result = self.gate()
        self.assertNotEqual(code, 0)
        self.assertEqual(result["reason"], "mobile_native_or_config_changed")
        self.assertIn("apps/mobile/src/native/location.ts", result["nonOtaMobilePaths"])
        self.assertIn("apps/mobile/assets/icon.png", result["nonOtaMobilePaths"])

    def test_reviewed_compatibility_admits_exact_existing_and_added_blobs(self):
        record = self.record_reviewed_compatibility()
        code, result = self.gate()
        self.assertEqual(code, 0)
        self.assertTrue(result["eligible"])
        self.assertIsNone(result["binarySourceSha"])
        self.assertEqual(result["comparisonBaselineSha"], self.binary_source)
        self.assertEqual(result["nonOtaMobilePaths"], sorted(record["reviewedMobilePaths"]))

    def test_reviewed_compatibility_rejects_later_input_drift(self):
        self.record_reviewed_compatibility()
        self.write("apps/mobile/modules/hither-location/ios/Location.swift", "let newCapability = 3\n")
        self.commit("add unreviewed capability")
        code, result = self.gate()
        self.assertNotEqual(code, 0)
        self.assertEqual(result["reason"], "reviewed_compatibility_blob_mismatch")

    def test_reviewed_compatibility_checks_baseline_blob_and_path_set(self):
        record = self.record_reviewed_compatibility()
        path = "apps/mobile/modules/hither-location/ios/Location.swift"
        baseline_blob = record["reviewedMobilePaths"][path]["baselineBlobSha"]
        record["reviewedMobilePaths"][path]["baselineBlobSha"] = "f" * 40
        self.write("release/ios-production-binary.json", json.dumps(record))
        code, result = self.gate()
        self.assertNotEqual(code, 0)
        self.assertEqual(result["reason"], "reviewed_compatibility_blob_mismatch")
        record["reviewedMobilePaths"][path]["baselineBlobSha"] = baseline_blob
        self.write("release/ios-production-binary.json", json.dumps(record))
        self.write("apps/mobile/assets/icon.png", b"unreviewed icon")
        self.commit("add unreviewed native input")
        code, result = self.gate()
        self.assertNotEqual(code, 0)
        self.assertEqual(result["reason"], "mobile_native_or_config_changed")

    def test_reviewed_compatibility_rejects_ambiguous_or_invalid_records(self):
        record = self.record_reviewed_compatibility()
        path = "apps/mobile/modules/hither-location/ios/Location.swift"
        variants = (
            {**record, "sourceSha": self.binary_source},
            {**record, "binarySourceSha": self.binary_source},
            {**record, "kind": "unreviewed"},
            {**record, "reviewedMobilePaths": {path: {"reviewedBlobSha": "f" * 40}}},
        )
        for variant in variants:
            with self.subTest(record=variant):
                self.write("release/ios-production-binary.json", json.dumps(variant))
                code, result = self.gate()
                self.assertNotEqual(code, 0)
                self.assertEqual(result["reason"], "invalid_binary_record")

    def test_missing_record_and_unrelated_source_do_not_publish(self):
        code, result = self.gate("release/missing.json")
        self.assertNotEqual(code, 0)
        self.assertEqual(result["reason"], "missing_or_invalid_binary_record")
        manifest = self.repo / "release/ios-production-binary.json"
        record = json.loads(manifest.read_text())
        record["sourceSha"] = "f" * 40
        manifest.write_text(json.dumps(record))
        code, result = self.gate()
        self.assertNotEqual(code, 0)
        self.assertEqual(result["reason"], "binary_evidence_mismatch")
        self.write("docs/binary.md", f"Verified installed binary source {'f' * 40}, "
                   "version/runtime 0.1.13, build 77, production, IN_BETA_TESTING\n")
        code, result = self.gate()
        self.assertNotEqual(code, 0)
        self.assertEqual(result["reason"], "binary_source_not_ancestor")


if __name__ == "__main__":
    unittest.main()
