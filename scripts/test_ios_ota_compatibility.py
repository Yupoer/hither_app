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

    def test_pure_ui_change_can_use_matching_binary(self):
        self.write("apps/mobile/src/screens/MapScreen/Screen.tsx",
                   "export const label = '';\n")
        self.commit("show only icon")
        code, result = self.gate()
        self.assertEqual(code, 0)
        self.assertTrue(result["eligible"])
        self.assertEqual(result["reason"], "compatible")
        self.assertEqual(result["runtimeVersion"], "0.1.13")

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
