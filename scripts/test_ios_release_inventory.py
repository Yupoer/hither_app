#!/usr/bin/env python3
"""Check the public receipt derived from EAS release inventory responses."""

import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


SCRIPT = Path(__file__).with_name("inspect-ios-release-inventory.py")
SPEC = importlib.util.spec_from_file_location("release_inventory", SCRIPT)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)

BUILD_ID = "123e4567-e89b-12d3-a456-426614174000"
GROUP_ID = "123e4567-e89b-12d3-a456-426614174001"
UPDATE_ID = "123e4567-e89b-12d3-a456-426614174002"
BRANCH_ID = "123e4567-e89b-12d3-a456-426614174003"
SHA = "a" * 40


def responses():
    builds = [{
        "id": BUILD_ID,
        "platform": "IOS",
        "status": "FINISHED",
        "distribution": "STORE",
        "buildProfile": "production",
        "isForIosSimulator": False,
        "gitCommitHash": SHA,
        "runtimeVersion": "1.2.3",
        "appVersion": "1.2.3",
        "appBuildVersion": "42",
        "channel": "production",
        "completedAt": "2026-10-27T12:00:00.000Z",
        "artifacts": {"buildUrl": "https://private.example/secret-ipa"},
        "logFiles": ["https://private.example/secret-log"],
    }]
    channel = {"currentPage": {
        "name": "production",
        "isPaused": False,
        "branchMapping": json.dumps({"version": 0, "data": [
            {"branchId": BRANCH_ID, "branchMappingLogic": "true"}]}),
        "updateBranches": [{"id": BRANCH_ID, "name": "production"}],
        "extraSecret": "secret-channel",
    }}
    updates = {"name": "production", "currentPage": [{
        "group": GROUP_ID,
        "runtimeVersion": "1.2.3",
        "platforms": "IOS",
        "branch": "production",
        "message": "secret-update-message",
    }]}
    view = [{
        "id": UPDATE_ID,
        "group": GROUP_ID,
        "branch": "production",
        "platform": "IOS",
        "runtimeVersion": "1.2.3",
        "gitCommitHash": SHA,
        "manifestPermalink": "https://private.example/secret-manifest",
    }]
    return builds, channel, updates, view


class ReleaseInventoryTest(unittest.TestCase):
    def test_finished_build_and_update_are_candidates_not_installation_proof(self):
        result = MODULE.inventory(*responses())
        self.assertEqual(result["easBuilds"][0]["buildId"], BUILD_ID)
        self.assertEqual(result["easBuilds"][0]["sourceSha"], SHA)
        self.assertTrue(result["easBuilds"][0]["metadataComplete"])
        self.assertEqual(result["easBuilds"][0]["appleInstallability"], "unknown")
        self.assertEqual(result["productionChannel"], {
            "active": True, "mapping": "unconditional_production", "branch": "production"})
        self.assertEqual(result["latestIosUpdate"]["sourceSha"], SHA)
        self.assertEqual(result["installedBinary"], "unknown")
        self.assertEqual(result["appleProcessing"], "unknown")
        receipt = json.dumps(result)
        self.assertNotIn("private.example", receipt)
        self.assertNotIn("secret-", receipt)
        self.assertNotIn("buildUrl", receipt)
        self.assertNotIn("manifestPermalink", receipt)

    def test_conditional_mapping_is_not_reported_as_active_production_branch(self):
        builds, channel, updates, view = responses()
        mapping = json.loads(channel["currentPage"]["branchMapping"])
        mapping["data"][0]["branchMappingLogic"] = "runtimeVersion >= 2"
        channel["currentPage"]["branchMapping"] = json.dumps(mapping)
        result = MODULE.inventory(builds, channel, updates, view)
        self.assertEqual(result["productionChannel"]["mapping"], "conditional_or_unknown")
        self.assertIsNone(result["productionChannel"]["branch"])

    def test_no_eas_records_leave_installed_binary_unknown(self):
        _, channel, _, _ = responses()
        result = MODULE.inventory([], channel, {"name": "production", "currentPage": []}, None)
        self.assertEqual(result["easBuilds"], [])
        self.assertIsNone(result["latestIosUpdate"])
        self.assertEqual(result["installedBinary"], "unknown")

    def test_latest_group_without_view_has_unknown_source(self):
        builds, channel, updates, _ = responses()
        result = MODULE.inventory(builds, channel, updates, None)
        self.assertIsNone(result["latestIosUpdate"]["sourceSha"])

    def test_mixed_platform_group_keeps_verified_ios_update(self):
        builds, channel, updates, view = responses()
        updates["currentPage"][0]["platforms"] = "ANDROID, IOS"
        view.append({**view[0], "id": "123e4567-e89b-12d3-a456-426614174004",
                     "platform": "ANDROID"})
        result = MODULE.inventory(builds, channel, updates, view)
        self.assertEqual(result["latestIosUpdate"]["iosUpdateId"], UPDATE_ID)
        self.assertEqual(result["latestIosUpdate"]["sourceSha"], SHA)

    def test_mixed_platform_group_requires_matching_ios_view(self):
        builds, channel, updates, view = responses()
        updates["currentPage"][0]["platforms"] = "ANDROID, IOS"
        with self.assertRaises(ValueError):
            MODULE.inventory(builds, channel, updates, None)
        view[0]["platform"] = "ANDROID"
        with self.assertRaises(ValueError):
            MODULE.inventory(builds, channel, updates, view)
        updates["currentPage"][0]["platforms"] = "ANDROID"
        view[0]["platform"] = "IOS"
        with self.assertRaises(ValueError):
            MODULE.inventory(builds, channel, updates, view)
        updates["currentPage"][0]["platforms"] = "ANDROID, IOS"
        updates["currentPage"][0]["branch"] = "preview"
        with self.assertRaises(ValueError):
            MODULE.inventory(builds, channel, updates, view)

    def test_url_shaped_metadata_is_removed(self):
        builds, channel, updates, view = responses()
        builds[0]["runtimeVersion"] = "https://private.example/secret-runtime"
        builds[0]["appVersion"] = "https://private.example/secret-version"
        result = MODULE.inventory(builds, channel, updates, view)
        self.assertIsNone(result["easBuilds"][0]["runtimeVersion"])
        self.assertIsNone(result["easBuilds"][0]["appVersion"])
        self.assertFalse(result["easBuilds"][0]["metadataComplete"])
        self.assertNotIn("private.example", json.dumps(result))

    def test_unknown_simulator_flag_does_not_imply_device_build(self):
        builds, channel, updates, view = responses()
        builds[0]["isForIosSimulator"] = None
        result = MODULE.inventory(builds, channel, updates, view)
        self.assertIsNone(result["easBuilds"][0]["simulator"])
        self.assertFalse(result["easBuilds"][0]["metadataComplete"])

    def test_reject_mismatched_filtered_records_and_runtime(self):
        builds, channel, updates, view = responses()
        builds[0]["platform"] = "ANDROID"
        with self.assertRaises(ValueError):
            MODULE.inventory(builds, channel, updates, view)
        builds[0]["platform"] = "IOS"
        view[0]["runtimeVersion"] = "other"
        with self.assertRaises(ValueError):
            MODULE.inventory(builds, channel, updates, view)

    def test_cli_writes_only_sanitized_receipt(self):
        with tempfile.TemporaryDirectory() as directory:
            paths = [Path(directory) / name for name in ("builds", "channel", "updates", "view")]
            for path, data in zip(paths, responses()):
                path.write_text(json.dumps(data), encoding="utf-8")
            receipt = Path(directory) / "receipt.json"
            command = [sys.executable, str(SCRIPT), "--builds", str(paths[0]),
                       "--channel", str(paths[1]), "--updates", str(paths[2]),
                       "--view", str(paths[3]), "--receipt", str(receipt)]
            completed = subprocess.run(command, check=False, capture_output=True, text=True)
            self.assertEqual(completed.returncode, 0, completed.stderr)
            content = receipt.read_text(encoding="utf-8")
            self.assertNotIn("private.example", content)
            self.assertEqual(json.loads(content)["easBuilds"][0]["buildNumber"], "42")

    def test_rejected_update_still_reports_safe_independent_inventory(self):
        with tempfile.TemporaryDirectory() as directory:
            paths = [Path(directory) / name for name in ("builds", "channel", "updates", "view")]
            builds, channel, updates, view = responses()
            updates["currentPage"][0]["platforms"] = "ANDROID"
            updates["currentPage"][0]["message"] = "private-message"
            for path, data in zip(paths, (builds, channel, updates, view)):
                path.write_text(json.dumps(data), encoding="utf-8")
            receipt = Path(directory) / "receipt.json"
            command = [sys.executable, str(SCRIPT), "--builds", str(paths[0]),
                       "--channel", str(paths[1]), "--updates", str(paths[2]),
                       "--view", str(paths[3]), "--receipt", str(receipt)]
            completed = subprocess.run(command, check=False, capture_output=True, text=True)
            self.assertEqual(completed.returncode, 1)
            data = json.loads(receipt.read_text(encoding="utf-8"))
            self.assertEqual(data["inventoryStatus"], "blocked")
            self.assertEqual(data["easBuilds"][0]["sourceSha"], SHA)
            self.assertEqual(data["productionChannel"]["branch"], "production")
            self.assertIsNone(data["latestIosUpdate"])
            self.assertEqual(data["diagnostic"]["groupPlatforms"], {
                "kind": "recognized_string", "iosCount": 0, "androidCount": 1,
                "canonical": True})
            self.assertEqual(data["diagnostic"]["viewMatchingIosCount"], 1)
            self.assertNotIn("private.example", receipt.read_text(encoding="utf-8") + completed.stderr)
            self.assertNotIn("private-message", receipt.read_text(encoding="utf-8") + completed.stderr)

    def test_rejected_unknown_platform_never_echoes_raw_value(self):
        with tempfile.TemporaryDirectory() as directory:
            paths = [Path(directory) / name for name in ("builds", "channel", "updates", "view")]
            builds, channel, updates, view = responses()
            updates["currentPage"][0]["platforms"] = "https://private.example/secret-platform"
            for path, data in zip(paths, (builds, channel, updates, view)):
                path.write_text(json.dumps(data), encoding="utf-8")
            receipt = Path(directory) / "receipt.json"
            completed = subprocess.run(
                [sys.executable, str(SCRIPT), "--builds", str(paths[0]),
                 "--channel", str(paths[1]), "--updates", str(paths[2]),
                 "--view", str(paths[3]), "--receipt", str(receipt)],
                check=False, capture_output=True, text=True)
            self.assertEqual(completed.returncode, 1)
            data = json.loads(receipt.read_text(encoding="utf-8"))
            self.assertEqual(data["diagnostic"]["groupPlatforms"]["kind"], "other_string")
            self.assertNotIn("private.example", receipt.read_text(encoding="utf-8") + completed.stderr)

    def test_invalid_channel_mapping_still_keeps_safe_build_facts(self):
        with tempfile.TemporaryDirectory() as directory:
            paths = [Path(directory) / name for name in ("builds", "channel", "updates", "view")]
            builds, channel, updates, view = responses()
            channel["currentPage"]["branchMapping"] = "[]"
            updates["currentPage"][0]["platforms"] = "ANDROID"
            for path, data in zip(paths, (builds, channel, updates, view)):
                path.write_text(json.dumps(data), encoding="utf-8")
            receipt = Path(directory) / "receipt.json"
            completed = subprocess.run(
                [sys.executable, str(SCRIPT), "--builds", str(paths[0]),
                 "--channel", str(paths[1]), "--updates", str(paths[2]),
                 "--view", str(paths[3]), "--receipt", str(receipt)],
                check=False, capture_output=True, text=True)
            self.assertEqual(completed.returncode, 1)
            data = json.loads(receipt.read_text(encoding="utf-8"))
            self.assertEqual(data["easBuilds"][0]["sourceSha"], SHA)
            self.assertFalse(data["diagnostic"]["channelValid"])
            self.assertIsNone(data["productionChannel"])


if __name__ == "__main__":
    unittest.main()
