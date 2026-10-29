import hashlib
import importlib.util
import json
from datetime import datetime, timezone
from pathlib import Path
import plistlib
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace


SCRIPT = Path(__file__).resolve().with_name("run-ios-release-launch.py")
SPEC = importlib.util.spec_from_file_location("ios_release_launch", SCRIPT)
GATE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(GATE)
VERIFY_SCRIPT = GATE.MOBILE / "scripts/verify-ios-release-launch.py"
VERIFY_SPEC = importlib.util.spec_from_file_location("verify_ios_release_launch", VERIFY_SCRIPT)
VERIFY = importlib.util.module_from_spec(VERIFY_SPEC)
VERIFY_SPEC.loader.exec_module(VERIFY)


class ReleaseLaunchGateTests(unittest.TestCase):
    def test_failure_probe_distinguishes_replacement_app_from_stale_host_pid(self):
        app = "/sim/Containers/Hither.app"
        def command(*args, check=True, timeout=None):
            if args[2] == "get_app_container":
                return SimpleNamespace(returncode=0, stdout=app + "\n")
            if args[0] == "pgrep":
                return SimpleNamespace(returncode=0, stdout="123\n456\n")
            raise AssertionError(args)

        with patch.object(VERIFY, "run", side_effect=command), \
                patch.object(VERIFY, "host_executable_path", side_effect={
                    123: "/other/Hither.app/Hither", 456: app + "/Hither"}.get):
            self.assertEqual(VERIFY.probe_app_process_state(
                "simulator", "app.hither.mobile", "Hither", 123), "replacement_pid")
            self.assertEqual(VERIFY.probe_app_process_state(
                "simulator", "app.hither.mobile", "Hither", 456), "original_pid")

        with patch.object(VERIFY, "run", side_effect=command), \
                patch.object(VERIFY, "host_executable_path", return_value=None):
            self.assertEqual(VERIFY.probe_app_process_state(
                "simulator", "app.hither.mobile", "Hither", 123), "unavailable")

    def test_failure_probe_reports_exact_simulator_and_missing_tools(self):
        devices = {"devices": {"iOS 27": [
            {"udid": "other", "state": "Booted"},
            {"udid": "target", "state": "Shutdown"}]}}
        with patch.object(VERIFY, "run", return_value=SimpleNamespace(
                returncode=0, stdout=json.dumps(devices))):
            self.assertEqual(VERIFY.probe_simulator_state("target"), "shutdown")
            self.assertEqual(VERIFY.probe_simulator_state("missing"), "unavailable")
        with patch.object(VERIFY, "run", side_effect=OSError):
            self.assertEqual(VERIFY.probe_simulator_state("target"), "unavailable")
            self.assertEqual(VERIFY.probe_app_process_state(
                "target", "app.hither.mobile", "Hither", 123), "unavailable")
        with patch.object(VERIFY, "run", side_effect=subprocess.TimeoutExpired("simctl", 10)):
            self.assertEqual(VERIFY.probe_simulator_state("target"), "unavailable")
            self.assertEqual(VERIFY.probe_app_process_state(
                "target", "app.hither.mobile", "Hither", 123), "unavailable")

    def test_failure_probe_is_advisory_and_sanitized(self):
        payload = {"failureStage": "startup_breadcrumb", "failureType": "ProcessLookupError",
                   "attempt": 1, "processAlive": False, "appProcessState": "replacement_pid",
                   "simulatorState": "booted", "path": "/private/app/Hither",
                   "hostPid": 456, "log": "private user data", "systemLogProbe": "available",
                   "systemTerminationSignals": ["watchdog"],
                   "pidCorrelatedSystemSignals": ["jetsam"],
                   "systemLogWindowSeconds": 7, "runtimeLogProbe": "available"}
        self.assertEqual(GATE.safe_launch_diagnostic(payload), {
            "failureStage": "startup_breadcrumb", "failureType": "ProcessLookupError",
            "attempt": 1, "processAlive": False, "appProcessState": "replacement_pid",
            "simulatorState": "booted", "systemLogProbe": "available",
            "systemTerminationSignals": ["watchdog"],
            "pidCorrelatedSystemSignals": ["jetsam"],
            "systemLogWindowSeconds": 7, "runtimeLogProbe": "available"})
        self.assertEqual(GATE.safe_launch_diagnostic({
            "appProcessState": "/private/app/Hither", "simulatorState": "secret",
            "systemTerminationSignals": ["private user data"],
            "pidCorrelatedSystemSignals": ["private user data"],
            "systemLogWindowSeconds": 100000}), {})

        started, ended = 1000.1, 1005.9
        def record(message, at=1002, **fields):
            return json.dumps({"timestamp": datetime.fromtimestamp(at, timezone.utc).isoformat(),
                               "eventMessage": message, "processID": 123, **fields})
        rows = [record("[application<app.hither.mobile>:123] Received termination request: watchdog private user data"),
                record("[application<app.hither.mobile>:456] Received termination request: jetsam"),
                json.dumps({"finished": "2026-10-28T14:23:00Z"})]
        with patch.object(VERIFY.subprocess, "run", return_value=SimpleNamespace(
                returncode=0, stdout="\n".join(rows))) as query:
            observed = VERIFY.probe_system_termination(
                "simulator", "app.hither.mobile", started, ended, 123)
            self.assertEqual(observed, {
                    "systemLogProbe": "available", "systemTerminationSignals": ["jetsam", "watchdog"],
                    "pidCorrelatedSystemSignals": ["watchdog"], "systemLogWindowSeconds": 7})
            self.assertNotIn("private user data", json.dumps(observed))
            command = query.call_args.args[0]
            self.assertIn("--start", command)
            self.assertIn("--end", command)
            self.assertEqual(command[command.index("--style") + 1], "ndjson")
            self.assertNotIn("--last", query.call_args.args[0])
            self.assertEqual(query.call_args.kwargs["timeout"], 15)
        with patch.object(VERIFY.subprocess, "run", side_effect=OSError):
            self.assertEqual(VERIFY.probe_system_termination(
                "simulator", "app.hither.mobile", started, ended, 123),
                {"systemLogProbe": "unavailable"})
        invalid_utf8 = UnicodeDecodeError("utf-8", b"\xff", 0, 1, "invalid")
        with patch.object(VERIFY.subprocess, "run", side_effect=invalid_utf8):
            self.assertEqual(VERIFY.probe_system_termination(
                "simulator", "app.hither.mobile", started, ended, 123),
                {"systemLogProbe": "unavailable"})
        self.assertEqual(VERIFY.probe_system_termination(
            "simulator", "app.hither.mobile", None, ended, 123),
            {"systemLogProbe": "unavailable"})

        no_match = {"systemLogProbe": "available", "systemTerminationSignals": [],
                    "pidCorrelatedSystemSignals": [], "systemLogWindowSeconds": 7}
        for name, rows in {
            "other PID": [record("[application<app.hither.mobile>:456] Received termination request: watchdog")],
            "PID prefix": [record("[application<app.hither.mobile>:1234] Received termination request: watchdog")],
            "prefix bundle": [record("[application<app.hither.mobile.extra>:123] Received termination request: watchdog")],
            "suffix bundle": [record("[application<other.app.hither.mobile>:123] Received termination request: watchdog")],
            "logging daemon PID": [record("app.hither.mobile watchdog")],
            "split records": [record("app.hither.mobile watchdog"), record("[application<app.hither.mobile>:123]")],
            "outside window": [record("[application<app.hither.mobile>:123] Received termination request: watchdog", at=999)],
            "after grace window": [record("[application<app.hither.mobile>:123] Received termination request: watchdog", at=1007.5)],
            "redacted PID": [record("[application<app.hither.mobile>:<private>] Received termination request: watchdog")],
            "other termination subject": [record("Received termination request from [application<app.hither.mobile>:123] on <RBSProcess application<other.app>:456> with context watchdog")],
            "prefix overridden by target": [record("[application<app.hither.mobile>:123] Received termination request on <RBSProcess application<other.app>:456> watchdog")],
            "multiple target references": [record("Received termination request on <RBSProcess application<app.hither.mobile>:123> wrapping application<other.app>:456 watchdog")],
            "xpc target requester": [record("Received termination request on <RBSProcess xpcservice<com.example.helper>:456> requested by application<app.hither.mobile>:123 with context watchdog")],
            "xpc process exited": [record("Process exited: <FBProcess: xpcservice<com.example.helper>:456> requested by application<app.hither.mobile>:123 watchdog")],
            "other exited process": [record("Process exited: <FBApplicationProcess: application<other.app>:456> -> requested by application<app.hither.mobile>:123 watchdog")],
            "requester on behalf": [record("Received termination request on behalf of application<app.hither.mobile>:123> for other.app watchdog")],
            "requester prefix": [record("[application<app.hither.mobile>:123] requested exit for other.app; other.app Received termination request: watchdog")],
            "unrelated labeled PID": [record("termination reason for other.app PID: 123 requested by app.hither.mobile")],
        }.items():
            with self.subTest(name=name), patch.object(VERIFY.subprocess, "run",
                                                    return_value=SimpleNamespace(
                                                        returncode=0, stdout="\n".join(rows))):
                result = VERIFY.probe_system_termination(
                    "simulator", "app.hither.mobile", started, ended, 123)
                self.assertEqual(result["pidCorrelatedSystemSignals"], [])
                self.assertNotIn("private user data", json.dumps(result))
                if name in {"outside window", "after grace window", "prefix bundle", "suffix bundle"}:
                    self.assertEqual(result, no_match)
        with patch.object(VERIFY.subprocess, "run", return_value=SimpleNamespace(
                returncode=0, stdout="\n".join([
                    record("Process exited: <FBApplicationProcess: application<app.hither.mobile>:123> -> watchdog", at=1006.4),
                    json.dumps({"finished": "complete"})]))):
            result = VERIFY.probe_system_termination(
                "simulator", "app.hither.mobile", started, ended, 123)
            self.assertEqual(result["pidCorrelatedSystemSignals"], ["process_exit", "watchdog"])
        with patch.object(VERIFY.subprocess, "run", return_value=SimpleNamespace(
                returncode=0, stdout=record(
                    "Received termination request from [osservice<com.apple.SpringBoard>:33] on <RBSProcess application<app.hither.mobile>:123> with context watchdog"))):
            result = VERIFY.probe_system_termination(
                "simulator", "app.hither.mobile", started, ended, 123)
            self.assertEqual(result["pidCorrelatedSystemSignals"], ["watchdog"])
        for rows in (["{malformed"],
                     [record("app.hither.mobile watchdog PID: 123"), "{malformed"],
                     [json.dumps({"eventMessage": "app.hither.mobile watchdog PID: 123"})],
                     [json.dumps({"timestamp": "not-a-time",
                                  "eventMessage": "app.hither.mobile watchdog PID: 123"})]):
            with patch.object(VERIFY.subprocess, "run", return_value=SimpleNamespace(
                    returncode=0, stdout="\n".join(rows))):
                self.assertEqual(VERIFY.probe_system_termination(
                    "simulator", "app.hither.mobile", started, ended, 123),
                    {"systemLogProbe": "unavailable"})

    def test_failure_before_launch_pid_still_reports_unavailable_probes(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            app = root / "Hither.app"
            app.mkdir()
            (app / "Info.plist").write_bytes(plistlib.dumps({
                "CFBundleIdentifier": "app.hither.mobile", "CFBundleVersion": "77",
                "CFBundleSupportedPlatforms": ["iPhoneSimulator"],
                "CFBundleExecutable": "Hither"}))
            output = root / "result"
            argv = ["verify-ios-release-launch.py", "--app", str(app),
                    "--simulator", "test-simulator", "--build", "77", "--output", str(output)]

            def command(*args, check=True, timeout=None):
                if args[2] == "install":
                    raise VERIFY.CommandFailure(args, SimpleNamespace(
                        returncode=1, stdout="private user data", stderr=""))
                if args[2] == "spawn":
                    raise subprocess.TimeoutExpired(args, 15)
                return SimpleNamespace(returncode=0, stdout="", stderr="")

            with patch.object(VERIFY, "run", side_effect=command), \
                    patch.object(VERIFY, "probe_simulator_state", return_value="shutdown"), \
                    patch("sys.argv", argv), self.assertRaises(VERIFY.CommandFailure):
                VERIFY.main()
            result = json.loads((output / "launch-result.json").read_text(encoding="utf-8"))
            self.assertEqual(GATE.safe_launch_diagnostic(result), {
                "failureStage": "install", "failureType": "CommandFailure",
                "simctlExitCode": 1, "appProcessState": "unavailable",
                "simulatorState": "shutdown", "systemLogProbe": "unavailable",
                "runtimeLogProbe": "unavailable"})
            self.assertNotIn("private user data", json.dumps(result))

    def test_failed_cold_launch_records_stage_without_runtime_log_contents(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            app = root / "Hither.app"
            app.mkdir()
            (app / "Info.plist").write_bytes(plistlib.dumps({
                "CFBundleIdentifier": "app.hither.mobile", "CFBundleVersion": "77",
                "CFBundleSupportedPlatforms": ["iPhoneSimulator"],
                "CFBundleExecutable": "Hither"}))
            output = root / "result"

            def command(*args, check=True, timeout=None):
                if args[2] == "launch":
                    return SimpleNamespace(returncode=0, stdout="app.hither.mobile: 123\n", stderr="")
                if args[2] == "get_app_container":
                    return SimpleNamespace(returncode=0, stdout=str(root / "data"), stderr="")
                return SimpleNamespace(returncode=0, stdout="private user data and token", stderr="")

            argv = ["verify-ios-release-launch.py", "--app", str(app),
                    "--simulator", "test-simulator", "--build", "77", "--output", str(output)]
            cases = (
                ([ProcessLookupError(), ProcessLookupError()], "launch", False, False, False, "unavailable"),
                ([None, ProcessLookupError(), ProcessLookupError()],
                 "startup_breadcrumb", True, False, False, "unavailable"),
                ([None, ProcessLookupError(), ProcessLookupError()],
                 "startup_breadcrumb", True, False, False, "replacement_pid"),
                ([None, ProcessLookupError(), ProcessLookupError()],
                 "startup_breadcrumb", True, False, True, "unavailable"),
                ([None, PermissionError(), PermissionError()],
                 "startup_breadcrumb", True, None, False, "unavailable"),
            )
            for checks, stage, initially_alive, finally_alive, probe_error, app_state in cases:
                with self.subTest(stage=stage, probe_error=probe_error), \
                        patch.object(VERIFY, "run", side_effect=command), \
                        patch.object(VERIFY.os, "kill", side_effect=checks), \
                        patch.object(VERIFY, "probe_app_process_state", return_value=app_state), \
                        patch.object(VERIFY, "find_crash_report", return_value=None,
                                     side_effect=OSError if probe_error else None), \
                        patch.object(VERIFY, "probe_system_termination",
                                     return_value={"systemLogProbe": "unavailable"}), \
                        patch.object(VERIFY.time, "sleep"), patch("sys.argv", argv):
                    error = type(checks[1] if initially_alive else checks[0])
                    with self.assertRaises(error):
                        VERIFY.main()

                result = (output / "launch-result.json").read_text(encoding="utf-8")
                self.assertNotIn("private user data and token", result)
                expected = {"failureStage": stage, "failureType": error.__name__,
                            "attempt": 1, "hostPidAliveAtLaunch": initially_alive,
                            "runtimeLogSignals": [], "appProcessState": app_state,
                            "simulatorState": "unavailable", "systemLogProbe": "unavailable",
                            "runtimeLogProbe": "available"}
                if finally_alive is not None:
                    expected["processAlive"] = finally_alive
                    if probe_error:
                        expected["crashReportProbe"] = "unavailable"
                    else:
                        expected["crashReportFound"] = False
                self.assertEqual(GATE.safe_launch_diagnostic(json.loads(result)), expected)

    def test_only_matching_recent_apple_crash_report_contributes_safe_fields(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            reports = root / "Library/Logs/DiagnosticReports"
            reports.mkdir(parents=True)
            report = {"pid": 123, "procName": "Hither",
                      "bundleInfo": {"CFBundleIdentifier": "app.hither.mobile"},
                      "exception": {"type": "EXC_CRASH", "signal": "SIGKILL (Code Signature Invalid)"},
                      "termination": {"namespace": "CODESIGNING", "code": 1,
                                      "indicator": "private user information"},
                      "faultingThread": 0,
                      "threads": [{"frames": [{"imageIndex": 0, "symbol": "private user information"},
                                              {"imageIndex": 1}]}],
                      "lastExceptionBacktrace": [{"imageIndex": 1}, {"imageIndex": 0}],
                      "usedImages": [{"path": "/private/runner/Hither.app/Hither"},
                                     {"name": "libswiftCore.dylib"}]}
            path = reports / "Hither-test.ips"
            path.write_text(json.dumps({"bug_type": "309"}) + "\n" + json.dumps(report),
                            encoding="utf-8")
            with patch.object(VERIFY.Path, "home", return_value=root):
                summary = VERIFY.find_crash_report(123, "Hither", "app.hither.mobile",
                                                   "test-simulator", path.stat().st_mtime)
                self.assertIsNone(VERIFY.find_crash_report(124, "Hither", "app.hither.mobile",
                                                        "test-simulator", path.stat().st_mtime))
            self.assertEqual(GATE.safe_launch_diagnostic(summary), {
                "crashReportFound": True, "exceptionType": "EXC_CRASH",
                "exceptionSignal": "SIGKILL", "terminationNamespace": "CODESIGNING",
                "terminationCode": 1, "faultingModule": "Hither",
                "faultingModules": ["Hither", "libswiftCore.dylib"],
                "lastExceptionModules": ["libswiftCore.dylib", "Hither"]})
            self.assertNotIn("private user information", json.dumps(summary))
            self.assertEqual(VERIFY.runtime_log_signals(
                "private user information; Library not loaded; uncaught exception"),
                ["dyld_failure", "uncaught_exception"])

    def test_runner_writes_sanitized_diagnostic_on_preflight_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            result = subprocess.run(("python3", str(SCRIPT), "--source-sha", "invalid",
                                     "--receipt", str(Path(directory) / "receipt.json")),
                                    env={"RUNNER_TEMP": directory}, capture_output=True, text=True)
            self.assertEqual(result.returncode, 1)
            diagnostic = json.loads((Path(directory) / "hither-release-launch-diagnostic.json")
                                    .read_text(encoding="utf-8"))
            self.assertEqual(diagnostic, {"stage": "arguments", "failureType": "ValueError"})
            self.assertNotIn("invalid", json.dumps(diagnostic))

    def test_failure_diagnostic_rejects_unexpected_values(self):
        self.assertEqual(GATE.safe_launch_diagnostic({
            "failureStage": "launch", "failureType": "CommandFailure", "attempt": 2,
            "processAlive": True, "simctlExitCode": 2, "error": "secret"}), {
                "failureStage": "launch", "failureType": "CommandFailure", "attempt": 2,
                "processAlive": True, "simctlExitCode": 2})
        self.assertEqual(GATE.safe_launch_diagnostic({
            "failureStage": ["secret"], "failureType": "secret", "attempt": True,
            "processAlive": "secret", "simctlExitCode": "secret",
            "faultingModule": "../../private", "runtimeLogSignals": ["secret"]}), {})

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
