import hashlib
import importlib.util
import json
from pathlib import Path
import plistlib
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location("symbols", Path(__file__).with_name("retain-ios-debug-symbols.py"))
symbols = importlib.util.module_from_spec(spec)
spec.loader.exec_module(symbols)


class DebugSymbolsTests(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name)
        self.archive = self.root / "signed.xcarchive"
        self.app = self.root / "Payload/Hither.app"
        self.widget = self.app / "PlugIns/HitherActivityWidget.appex"
        self.ipa = self.root / "signed.ipa"
        self.ipa.write_bytes(b"signed-ipa-fixture")
        self.output = self.root / "symbols"
        self.identity = {"sourceSha": "a" * 40, "runId": "123", "runAttempt": 1}
        self.uuids = {}
        for bundle, identifier, uuid in (
            (self.app, "app.hither.mobile", "11111111-1111-4111-8111-111111111111"),
            (self.widget, "app.hither.mobile.widget", "22222222-2222-4222-8222-222222222222"),
        ):
            bundle.mkdir(parents=True, exist_ok=True)
            executable = bundle.stem
            (bundle / executable).write_bytes(b"Mach-O-fixture")
            (bundle / "Info.plist").write_bytes(plistlib.dumps({
                "CFBundleIdentifier": identifier, "CFBundleExecutable": executable,
                "CFBundleShortVersionString": "0.1.14", "CFBundleVersion": "80",
            }))
            dsym = self.archive / "dSYMs" / (bundle.name + ".dSYM")
            dwarf = dsym / "Contents/Resources/DWARF" / executable
            dwarf.parent.mkdir(parents=True)
            dwarf.write_bytes(("DWARF-" + executable).encode())
            (dsym / "Contents/Info.plist").write_bytes(plistlib.dumps({"CFBundlePackageType": "dSYM"}))
            self.uuids[str(bundle / executable)] = uuid
            self.uuids[str(dwarf)] = uuid
        (self.app / "Expo.plist").write_bytes(plistlib.dumps({
            "EXUpdatesRuntimeVersion": "0.1.14",
            "EXUpdatesRequestHeaders": {"expo-channel-name": "production"},
        }))
        (self.archive / "credentials-private-sentinel").write_text("must not retain")
        (self.archive / "dSYMs/not-a-symbol.txt").write_text("must not retain")

    def tool_output(self, command, *, text):
        self.assertEqual(command[:3], ["xcrun", "dwarfdump", "--uuid"])
        self.assertTrue(text)
        return f"UUID: {self.uuids[command[3]]} (arm64) {command[3]}\n"

    def test_retains_only_uuid_matched_app_widget_symbols_and_manifest(self):
        with patch.object(symbols.subprocess, "check_output", side_effect=self.tool_output):
            symbols.retain_symbols(self.archive, self.app, self.widget, self.ipa, self.output, self.identity)
        self.assertEqual({path.name for path in self.output.iterdir()}, {
            "Hither.app.dSYM", "HitherActivityWidget.appex.dSYM", "manifest.json",
        })
        manifest = json.loads((self.output / "manifest.json").read_text())
        self.assertEqual(set(manifest), {
            "sourceSha", "runId", "runAttempt", "appVersion", "build", "runtimeVersion", "channel", "ipaSha256", "binaries",
        })
        self.assertEqual({key: manifest[key] for key in self.identity}, self.identity)
        self.assertEqual((manifest["appVersion"], manifest["build"], manifest["runtimeVersion"], manifest["channel"]),
                         ("0.1.14", "80", "0.1.14", "production"))
        self.assertEqual(manifest["ipaSha256"], hashlib.sha256(self.ipa.read_bytes()).hexdigest())
        for row, bundle in zip(manifest["binaries"], (self.app, self.widget)):
            self.assertEqual(set(row), {"bundleIdentifier", "executable", "dSYM", "uuids", "dwarfSha256"})
            self.assertEqual(row["bundleIdentifier"], plistlib.loads((bundle / "Info.plist").read_bytes())["CFBundleIdentifier"])
            self.assertEqual(row["uuids"], [{"architecture": "arm64", "uuid": self.uuids[str(bundle / bundle.stem)]}])
            retained = self.output / row["dSYM"]
            dwarf = retained / "Contents/Resources/DWARF" / row["executable"]
            self.assertEqual(row["dwarfSha256"], hashlib.sha256(dwarf.read_bytes()).hexdigest())
            self.assertEqual({path.relative_to(retained).as_posix() for path in retained.rglob("*") if path.is_file()}, {
                "Contents/Info.plist", f"Contents/Resources/DWARF/{row['executable']}",
            })
        self.assertNotIn(str(self.root), json.dumps(manifest))

    def test_uuid_mismatch_rejects_retention_before_creating_output(self):
        dwarf = self.archive / "dSYMs/HitherActivityWidget.appex.dSYM/Contents/Resources/DWARF/HitherActivityWidget"
        self.uuids[str(dwarf)] = "33333333-3333-4333-8333-333333333333"
        with patch.object(symbols.subprocess, "check_output", side_effect=self.tool_output):
            with self.assertRaisesRegex(ValueError, "UUID-matched dSYM for HitherActivityWidget; found 0"):
                symbols.retain_symbols(self.archive, self.app, self.widget, self.ipa, self.output, self.identity)
        self.assertFalse(self.output.exists())


if __name__ == "__main__":
    unittest.main()
