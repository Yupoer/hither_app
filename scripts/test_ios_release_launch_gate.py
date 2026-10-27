import hashlib
import importlib.util
from pathlib import Path
import plistlib
import tempfile
import unittest


SCRIPT = Path(__file__).resolve().with_name("run-ios-release-launch.py")
SPEC = importlib.util.spec_from_file_location("ios_release_launch", SCRIPT)
GATE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(GATE)


class ReleaseLaunchGateTests(unittest.TestCase):
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
