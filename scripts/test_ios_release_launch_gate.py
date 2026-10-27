import hashlib
import importlib.util
from pathlib import Path
import plistlib
import subprocess
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().with_name("run-ios-release-launch.py")
SPEC = importlib.util.spec_from_file_location("ios_release_launch", SCRIPT)
GATE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(GATE)


class ReleaseLaunchGateTests(unittest.TestCase):
    def test_pod_install_may_reorder_only_privacy_api_categories(self):
        with tempfile.TemporaryDirectory() as directory:
            repo = Path(directory)
            privacy = repo / GATE.PRIVACY_PATH
            privacy.parent.mkdir(parents=True)
            source = plistlib.loads((GATE.MOBILE / "ios/Hither/PrivacyInfo.xcprivacy").read_bytes())
            privacy.write_bytes(plistlib.dumps(source))
            other = repo / "apps/mobile/ios/Podfile.lock"
            other.write_text("locked\n", encoding="utf-8")
            subprocess.run(("git", "init", "-q"), cwd=repo, check=True)
            subprocess.run(("git", "add", "."), cwd=repo, check=True)
            subprocess.run(("git", "-c", "user.name=Test", "-c", "user.email=test@example.invalid",
                            "commit", "-qm", "baseline"), cwd=repo, check=True)

            source["NSPrivacyAccessedAPITypes"].reverse()
            privacy.write_bytes(plistlib.dumps(source))
            GATE.verify_ios_source_equivalence(repo)

            source["NSPrivacyAccessedAPITypes"][3]["NSPrivacyAccessedAPITypeReasons"].reverse()
            privacy.write_bytes(plistlib.dumps(source))
            with self.assertRaises(RuntimeError):
                GATE.verify_ios_source_equivalence(repo)

            source["NSPrivacyAccessedAPITypes"][3]["NSPrivacyAccessedAPITypeReasons"].reverse()
            source["NSPrivacyAccessedAPITypes"][0]["NSPrivacyAccessedAPITypeReasons"].append("NEW.1")
            privacy.write_bytes(plistlib.dumps(source))
            with self.assertRaises(RuntimeError):
                GATE.verify_ios_source_equivalence(repo)

            source["NSPrivacyAccessedAPITypes"][0]["NSPrivacyAccessedAPITypeReasons"].pop()
            source["NSPrivacyAccessedAPITypes"].pop()
            privacy.write_bytes(plistlib.dumps(source))
            with self.assertRaises(RuntimeError):
                GATE.verify_ios_source_equivalence(repo)

            source = plistlib.loads((GATE.MOBILE / "ios/Hither/PrivacyInfo.xcprivacy").read_bytes())
            source["NSPrivacyTracking"] = 0
            privacy.write_bytes(plistlib.dumps(source))
            with self.assertRaises(RuntimeError):
                GATE.verify_ios_source_equivalence(repo)

            privacy.write_bytes(plistlib.dumps(plistlib.loads(
                (GATE.MOBILE / "ios/Hither/PrivacyInfo.xcprivacy").read_bytes())))
            other.write_text("changed\n", encoding="utf-8")
            with self.assertRaises(RuntimeError):
                GATE.verify_ios_source_equivalence(repo)

            other.write_text("locked\n", encoding="utf-8")
            privacy.chmod(0o755)
            with self.assertRaises(RuntimeError):
                GATE.verify_ios_source_equivalence(repo)

    def test_simulator_build_embeds_production_channel_without_changing_other_updates(self):
        original = plistlib.dumps({"EXUpdatesEnabled": True, "EXUpdatesRuntimeVersion": "0.1.13"})
        configured = plistlib.loads(GATE.production_simulator_plist(original))
        self.assertEqual(configured["EXUpdatesRequestHeaders"], {"expo-channel-name": "production"})
        self.assertTrue(configured["EXUpdatesEnabled"])
        self.assertEqual(configured["EXUpdatesRuntimeVersion"], "0.1.13")
        other_channel = plistlib.dumps({"EXUpdatesRequestHeaders": {"expo-channel-name": "preview"}})
        with self.assertRaises(ValueError):
            GATE.production_simulator_plist(other_channel)

    def test_requires_production_environment_and_real_legal_urls(self):
        configured = {"EAS_BUILD_PROFILE": "production",
                      "EXPO_PUBLIC_PRIVACY_URL": "https://hither.example.net/privacy",
                      "EXPO_PUBLIC_TERMS_URL": "https://hither.example.net/terms"}
        GATE.require_production_environment(configured)
        for changed in ({"EAS_BUILD_PROFILE": "preview"},
                        {"EXPO_PUBLIC_PRIVACY_URL": "http://hither.example.net/privacy"},
                        {"EXPO_PUBLIC_TERMS_URL": "https://example.com/terms"},
                        {"EXPO_PUBLIC_TERMS_URL": ""}):
            with self.subTest(changed=changed), self.assertRaises(ValueError):
                GATE.require_production_environment({**configured, **changed})

    def test_selects_available_ios_27_0_and_rejects_other_runtimes(self):
        available = {"isAvailable": True, "identifier": "com.apple.CoreSimulator.SimRuntime.iOS-27-0",
                     "version": "27.0", "buildversion": "24A123"}
        payload = {"runtimes": [dict(available, isAvailable=False),
                                dict(available, identifier="com.apple.CoreSimulator.SimRuntime.iOS-27-1",
                                     version="27.1"), available]}
        self.assertEqual(GATE.select_ios_27_runtime(payload), available)
        with self.assertRaises(ValueError):
            GATE.select_ios_27_runtime({"runtimes": payload["runtimes"][:-1]})
        with self.assertRaises(ValueError):
            GATE.select_ios_27_runtime({"runtimes": [available, available]})

    def test_receipt_needs_two_verified_cold_starts_and_screenshots(self):
        runtime = {"identifier": "com.apple.CoreSimulator.SimRuntime.iOS-27-0",
                   "buildversion": "24A123"}
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            launches = []
            for attempt in (1, 2):
                screenshot = output / f"cold-start-{attempt}.png"
                screenshot.write_bytes(GATE.PNG_MAGIC + bytes([attempt]) * 32)
                launches.append({"pid": attempt + 100, "phase": "stable", "screenshot": str(screenshot)})
            result = {"passed": True, "build": "77", "bundleId": "app.hither.mobile",
                      "launches": launches}
            receipt = GATE.receipt_from_launch("a" * 40, "0.1.13", "77", runtime,
                                               "fdb9d41f-c394-4a0b-841a-4e4cbf2c4bdb", result, output)
            self.assertEqual(len(receipt["launches"]), 2)
            self.assertEqual(receipt["launches"][0]["screenshotSha256"],
                             hashlib.sha256((output / "cold-start-1.png").read_bytes()).hexdigest())
            self.assertEqual(receipt["visualReview"], "pending")
            self.assertEqual(receipt["validationScope"], "source_equivalent_release_simulator")
            self.assertEqual(receipt["deviceAcceptance"], "not_verified")
            self.assertNotIn(str(output), str(receipt))
            for broken in (dict(result, passed=False), dict(result, launches=launches[:1]),
                           dict(result, launches=[dict(launches[0], phase="booting"), launches[1]]),
                           dict(result, build="78")):
                with self.subTest(broken=broken), self.assertRaises(ValueError):
                    GATE.receipt_from_launch("a" * 40, "0.1.13", "77", runtime,
                                             "fdb9d41f-c394-4a0b-841a-4e4cbf2c4bdb", broken, output)
            (output / "cold-start-2.png").write_bytes(b"not a screenshot")
            with self.assertRaises(ValueError):
                GATE.receipt_from_launch("a" * 40, "0.1.13", "77", runtime,
                                         "fdb9d41f-c394-4a0b-841a-4e4cbf2c4bdb", result, output)


if __name__ == "__main__":
    unittest.main()
