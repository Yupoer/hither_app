import hashlib
import importlib.util
import contextlib
import io
import json
import os
from datetime import datetime, timezone
from pathlib import Path
import plistlib
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import Mock, patch
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
    def run_replay_boundary(self, eligible=True, child_exit=0, malformed=False):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            mobile = root / 'mobile'
            (mobile / 'scripts').mkdir(parents=True)
            output = root / 'launch'
            output.mkdir()
            original = output / 'launch-result.json'
            original.write_text(json.dumps({'passed': False, 'eligible': eligible, 'build': '77',
                                             'private': 'original private sentinel'}))
            before = original.read_bytes()
            helper = mobile / 'scripts/ios_launch_debugger.py'
            helper.write_text(
                'import json, pathlib, sys\n'
                'def eligible_failure(payload, build=None):\n'
                ' return payload.get("eligible") is True and payload.get("build") == build\n'
                'def safe_result(payload):\n'
                ' return {key: payload[key] for key in ("scope", "probe", "stopReason", "signal", "frames") if key in payload}\n'
                'if __name__ == "__main__":\n'
                ' args = sys.argv[1:]\n'
                ' output = pathlib.Path(args[args.index("--output") + 1])\n'
                ' output.mkdir(exist_ok=False)\n'
                ' (output / "argv.json").write_text(json.dumps(args))\n'
                ' print("private debugger sentinel")\n'
                + (' (output / "replay-result.json").write_text("not-json")\n' if malformed else
                   ' (output / "replay-result.json").write_text(json.dumps({"scope":"diagnostic_replay", "probe":"stopped", "stopReason":"signal", "signal":5, "frames":[], "private":"private debugger sentinel"}))\n')
                + f' sys.exit({child_exit})\n')
            with patch.object(GATE, 'MOBILE', mobile), contextlib.redirect_stdout(io.StringIO()) as public:
                result = GATE.collect_failure_replay(root / 'Hither.app', 'target-simulator', '77', output)
            self.assertEqual(original.read_bytes(), before)
            self.assertNotIn('private', json.dumps(result) + public.getvalue())
            replay = output / 'diagnostic-replay'
            args = json.loads((replay / 'argv.json').read_text()) if replay.exists() else None
            local_log = (output / 'debugger-replay-run.log').read_text() if (output / 'debugger-replay-run.log').exists() else ''
            return result, args, local_log

    def test_debugger_replay_cannot_replace_original_failure_and_keeps_raw_output_local(self):
        for child_exit in (0, 17):
            with self.subTest(child_exit=child_exit):
                result, args, local_log = self.run_replay_boundary(child_exit=child_exit)
                self.assertEqual(result, {'scope': 'diagnostic_replay', 'probe': 'stopped',
                                          'stopReason': 'signal', 'signal': 5, 'frames': []})
                self.assertEqual(args[0], 'replay')
                self.assertEqual(args[args.index('--simulator') + 1], 'target-simulator')
                self.assertEqual(args[args.index('--build') + 1], '77')
                self.assertTrue(args[args.index('--original-result') + 1].endswith('/launch-result.json'))
                self.assertIn('private debugger sentinel', local_log)
                self.assertNotIn('passed', result)

    def test_ineligible_launch_failure_does_not_run_debugger_replay(self):
        result, args, local_log = self.run_replay_boundary(eligible=False)
        self.assertIsNone(result)
        self.assertIsNone(args)
        self.assertEqual(local_log, '')

    def test_malformed_debugger_summary_preserves_original_failure(self):
        result, args, _ = self.run_replay_boundary(malformed=True)
        self.assertEqual(result, {'scope': 'diagnostic_replay', 'probe': 'unavailable'})
        self.assertIsNotNone(args)

    def test_exit_observer_attributes_only_registered_executable_and_kernel_status(self):
        api = SimpleNamespace(KQ_FILTER_PROC=-5, KQ_EV_ADD=1, KQ_EV_ONESHOT=16,
                              KQ_EV_ERROR=0x4000, KQ_NOTE_EXIT=0x80000000,
                              kevent=lambda pid, **values: SimpleNamespace(ident=pid, **values))
        for status, flags, expected in (
            (37 << 8, 0x84000000, {"appExitKind": "exited", "appExitCode": 37}),
            (9, 0x86000000, {"appExitKind": "signaled", "appExitSignal": 9,
                               "appExitDetails": []}),
            (9 | 0x20000, 0x86000000, {"appExitKind": "signaled", "appExitSignal": 9,
                                         "appExitDetails": ["memory"]}),
            (37 << 8, 0x80000000, {"appExitKind": "unknown"}),
        ):
            queue = Mock()
            queue.control.side_effect = [[], [SimpleNamespace(
                ident=123, filter=-5, flags=0, fflags=flags, data=status)]]
            api.kqueue = Mock(return_value=queue)
            with self.subTest(status=status, flags=flags), \
                    patch.object(VERIFY, "select", api), patch.object(VERIFY.sys, "platform", "darwin"), \
                    patch.object(VERIFY, "host_executable_path", return_value="/sim/Hither.app/Hither"):
                observer = VERIFY.ProcessExitObserver(123, Path("/sim/Hither.app/Hither"))
                self.assertEqual(observer.poll(), {"processExitProbe": "observed", **expected})
                self.assertEqual(queue.control.call_args.args, (None, 1, 0))
                observer.close()
                observer.close()
                queue.close.assert_called_once()

    def test_exit_observer_rejects_wrong_identity_other_events_and_probe_failure(self):
        api = SimpleNamespace(KQ_FILTER_PROC=-5, KQ_EV_ADD=1, KQ_EV_ONESHOT=16,
                              KQ_EV_ERROR=0x4000, KQ_NOTE_EXIT=0x80000000,
                              kevent=lambda pid, **values: SimpleNamespace(ident=pid, **values))
        for path, events in (("/other/Hither", []), (None, []),
                             ("/sim/Hither", [SimpleNamespace(
                                 ident=456, filter=-5, flags=0, fflags=0x84000000, data=0)]),
                             ("/sim/Hither", OSError("private error"))):
            queue = Mock()
            queue.control.side_effect = [[], events]
            api.kqueue = Mock(return_value=queue)
            with self.subTest(path=path, events=events), patch.object(VERIFY, "select", api), \
                    patch.object(VERIFY.sys, "platform", "darwin"), \
                    patch.object(VERIFY, "host_executable_path", return_value=path):
                observer = VERIFY.ProcessExitObserver(123, Path("/sim/Hither"))
                self.assertEqual(observer.poll(), {"processExitProbe": "unavailable"})
                observer.close()
        with patch.object(VERIFY.sys, "platform", "linux"):
            self.assertEqual(VERIFY.ProcessExitObserver(123, Path("/sim/Hither")).poll(),
                             {"processExitProbe": "unavailable"})

    def test_safe_exit_evidence_cannot_confuse_observer_status_with_app_status(self):
        self.assertEqual(GATE.safe_launch_diagnostic({
            "processExitProbe": "observed", "appExitKind": "signaled", "appExitSignal": 9,
            "appExitDetails": ["memory"], "appExitCode": 1, "exitCode": 1,
            "stderr": "private token", "pid": 123}), {
                "processExitProbe": "observed", "appExitKind": "signaled",
                "appExitSignal": 9, "appExitDetails": ["memory"]})
        self.assertEqual(GATE.safe_launch_diagnostic({
            "processExitProbe": "unavailable", "appExitKind": "exited", "appExitCode": 1}),
            {"processExitProbe": "unavailable"})
        self.assertEqual(GATE.safe_launch_diagnostic({
            "processExitProbe": "observed", "appExitKind": "exited", "appExitCode": 37,
            "consoleProbe": "available", "consoleSignals": ["uncaught_exception"]}), {
                "processExitProbe": "observed", "appExitKind": "exited", "appExitCode": 37,
                "consoleProbe": "available", "consoleSignals": ["uncaught_exception"]})
        self.assertEqual(GATE.safe_launch_diagnostic({
            "processExitProbe": "observed", "appExitKind": ["private"], "appExitCode": True,
            "appExitSignal": 10000, "appExitDetails": ["private token"],
            "consoleProbe": "unavailable", "consoleSignals": ["fatal_error"]}),
            {"processExitProbe": "observed", "consoleProbe": "unavailable"})

    def test_console_probe_bounds_parsing_and_keeps_raw_output_local(self):
        with tempfile.TemporaryDirectory() as directory:
            stdout, stderr = (Path(directory) / name for name in ("stdout", "stderr"))
            stdout.write_bytes(b"private token; uncaught exception\n" + b"x" * 1_000_000)
            stderr.write_bytes(b"fatal error\xff")
            result = VERIFY.probe_console([stdout, stderr])
            self.assertEqual(result, {"consoleProbe": "available", "consoleTruncated": True,
                                      "consoleSignals": ["fatal_error", "uncaught_exception"]})
            self.assertNotIn("private token", json.dumps(result))
            stderr.unlink()
            self.assertEqual(VERIFY.probe_console([stdout, stderr]), {"consoleProbe": "unavailable"})

    def test_observed_normal_exit_still_fails_original_launch_without_retry(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            app = root / "Hither.app"
            app.mkdir()
            (app / "Info.plist").write_bytes(plistlib.dumps({
                "CFBundleIdentifier": "app.hither.mobile", "CFBundleVersion": "77",
                "CFBundleSupportedPlatforms": ["iPhoneSimulator"], "CFBundleExecutable": "Hither"}))
            output = root / "result"
            launches = []
            def command(*args, check=True, timeout=None):
                if args[2] == "launch":
                    launches.append(args)
                    return SimpleNamespace(returncode=0, stdout="app.hither.mobile: 123\n", stderr="")
                if args[2] == "get_app_container":
                    return SimpleNamespace(returncode=0, stdout=str(root / args[-1]), stderr="")
                return SimpleNamespace(returncode=0, stdout="", stderr="")
            observer = Mock()
            observer.poll.return_value = {"processExitProbe": "observed", "appExitKind": "exited",
                                          "appExitCode": 0, "appExitObservedDuring": "launch_observation"}
            argv = ["verify-ios-release-launch.py", "--app", str(app), "--simulator", "test-simulator",
                    "--build", "77", "--output", str(output)]
            with patch.object(VERIFY, "run", side_effect=command), patch("sys.argv", argv), \
                    patch.object(VERIFY, "ProcessExitObserver", return_value=observer), \
                    patch.object(VERIFY.os, "kill"), patch.object(VERIFY.time, "sleep"), \
                    patch.object(VERIFY, "probe_app_process_state", return_value="replacement_pid"), \
                    patch.object(VERIFY, "find_crash_report", return_value=None), \
                    patch.object(VERIFY, "probe_simulator_state", return_value="booted"), \
                    patch.object(VERIFY, "probe_system_termination", return_value={}), \
                    self.assertRaises(ProcessLookupError):
                VERIFY.main()
            result = json.loads((output / "launch-result.json").read_text())
            self.assertIs(result["passed"], False)
            self.assertEqual(result["launches"], [])
            self.assertEqual(result["failureStage"], "startup_breadcrumb")
            self.assertEqual(result["appExitCode"], 0)
            self.assertEqual(GATE.safe_launch_diagnostic(result)["appExitObservedDuring"], "launch_observation")
            self.assertEqual(len(launches), 1)
            observer.close.assert_called_once()

    @unittest.skipUnless(sys.platform == "darwin", "requires Darwin kqueue")
    def test_real_host_exit_observer_reads_exact_exit_and_signal(self):
        VERIFY.check_exit_observer()

    def test_host_self_check_uses_running_macho_instead_of_framework_launcher(self):
        binary = "/Frameworks/Python/Resources/Python.app/Contents/MacOS/Python"
        children = [Mock(pid=123), Mock(pid=456)]
        observers = [Mock(), Mock()]
        for child, observer, result in zip(children, observers, (
                {"appExitKind": "exited", "appExitCode": 37},
                {"appExitKind": "signaled", "appExitSignal": 15})):
            child.poll.return_value = 0
            observer.poll.side_effect = [{"processExitProbe": "not_observed"},
                                         {"processExitProbe": "observed", **result}]
        with patch.object(VERIFY.sys, "executable", "/Frameworks/Python/bin/python3"), \
                patch.object(VERIFY, "host_executable_path", return_value=binary), \
                patch.object(VERIFY.subprocess, "Popen", side_effect=children) as spawn, \
                patch.object(VERIFY, "ProcessExitObserver", side_effect=observers) as observe:
            VERIFY.check_exit_observer()
        self.assertEqual([call.args[0][0] for call in spawn.call_args_list], [binary, binary])
        self.assertEqual([call.args for call in observe.call_args_list],
                         [(123, Path(binary)), (456, Path(binary))])

    def test_cli_rejects_unsupported_console_or_failed_observer_before_app_build(self):
        cases = (
            ('stdout', '--stdout=<path> --stderr=<path>', '', 0, True),
            ('stderr', '', '--stdout=<path> --stderr=<path>', 0, True),
            ('split', '--stdout=<path>', '--stderr=<path>', 0, True),
            ('neither', '--console', '', 0, False),
            ('missing_stdout', '', '--stderr=<path>', 0, False),
            ('missing_stderr', '--stdout=<path>', '', 0, False),
            ('command_failed', '--stdout=<path>', '--stderr=<path>', 17, False),
        )
        for case_name, help_stdout, help_stderr, help_exit, observer_expected in cases:
            with self.subTest(case=case_name), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                script = root / "scripts/run-ios-release-launch.py"
                script.parent.mkdir()
                script.write_bytes(SCRIPT.read_bytes())
                mobile = root / "apps/mobile"
                (mobile / "ios").mkdir(parents=True)
                (mobile / "scripts").mkdir()
                (mobile / "eas.json").write_text(json.dumps({"build": {"production": {}}}))
                (mobile / "ios/Podfile.lock").write_text("COCOAPODS: 1.16.2\n")
                tools = root / "bin"
                tools.mkdir()
                trace = root / "commands.jsonl"
                for name, response in {"git": "a" * 40, "pod": "1.16.2",
                                       "xcodebuild": "Xcode 27.0\nBuild version test",
                                       "xcrun": help_stdout}.items():
                    command = tools / name
                    error_output = help_stderr + '\nprivate help sentinel' if name == 'xcrun' else ''
                    exit_code = help_exit if name == 'xcrun' else 0
                    command.write_text(f"#!{sys.executable}\nimport json,os,pathlib,sys\n"
                                       "with pathlib.Path(os.environ['HITHER_TEST_TRACE']).open('a') as stream:\n"
                                       " stream.write(json.dumps(sys.argv)+'\\n')\n"
                                       f"print({response!r})\nprint({error_output!r}, file=sys.stderr)\n"
                                       f"sys.exit({exit_code})\n")
                    command.chmod(0o755)
                helper = mobile / "scripts/verify-ios-release-launch.py"
                helper.write_text("import os,pathlib,sys\n"
                                  "pathlib.Path(os.environ['RUNNER_TEMP'],'self-check-ran').touch()\n"
                                  "print('private console sentinel')\nsys.exit(7)\n")
                result = subprocess.run((sys.executable, str(script), "--source-sha", "a" * 40,
                                         "--receipt", str(root / "receipt.json")), capture_output=True,
                                        text=True, env={**os.environ, "PATH": str(tools) + os.pathsep + os.environ["PATH"],
                                        "RUNNER_TEMP": str(root), "EAS_BUILD_PROFILE": "production",
                                        "HITHER_TEST_TRACE": str(trace),
                                        "EXPO_PUBLIC_PRIVACY_URL": "https://hither.example.net/privacy",
                                        "EXPO_PUBLIC_TERMS_URL": "https://hither.example.net/terms"})
                self.assertEqual(result.returncode, 1)
                diagnostic = json.loads((root / "hither-release-launch-diagnostic.json").read_text())
                self.assertEqual(diagnostic["stage"], "runner_preflight")
                self.assertEqual((root / "self-check-ran").exists(), observer_expected)
                if observer_expected:
                    self.assertEqual(diagnostic["commandExitCode"], 7)
                    self.assertNotIn("exitCode", diagnostic)
                    self.assertNotIn("appExitCode", diagnostic)
                elif help_exit:
                    self.assertEqual(diagnostic['commandExitCode'], help_exit)
                calls = [json.loads(line)[1:] for line in trace.read_text().splitlines()]
                self.assertIn(['simctl', 'help', 'launch'], calls)
                self.assertNotIn(["install", "--deployment"], calls)
                self.assertFalse(any("build" in call or "create" in call for call in calls))
                self.assertNotIn("private console sentinel", result.stdout + result.stderr + json.dumps(diagnostic))
                self.assertNotIn("private help sentinel", result.stdout + result.stderr + json.dumps(diagnostic))

    def test_structured_command_output_does_not_include_stderr_warnings(self):
        output = GATE.run(sys.executable, '-c',
                          'import sys; print(\'{"devices": []}\'); print("private warning", file=sys.stderr)')
        self.assertEqual(json.loads(output), {'devices': []})

    def run_profile_boundary(self, production, inherited):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            script = root / "scripts/run-ios-release-launch.py"
            script.parent.mkdir()
            script.write_bytes(SCRIPT.read_bytes())
            mobile = root / "apps/mobile"
            mobile.mkdir(parents=True)
            (mobile / "eas.json").write_text(json.dumps({"build": {"production": production}}))
            tools = root / "bin"
            tools.mkdir()
            capture = root / "child-environment.json"
            git = tools / "git"
            git.write_text(f"#!{sys.executable}\n" +
                           "import json, os, pathlib, sys\n" +
                           "names = ('EXPO_PUBLIC_DIAGNOSTIC_LEVEL', 'EXPO_PUBLIC_DIAGNOSTICS_ENABLED', 'HITHER_TEST_INHERITED')\n" +
                           "pathlib.Path(os.environ['HITHER_TEST_CAPTURE']).write_text(json.dumps({name: os.environ.get(name) for name in names}))\n" +
                           "sys.exit(1)\n")
            git.chmod(0o755)
            environment = {**os.environ, "PATH": str(tools) + os.pathsep + os.environ["PATH"],
                           "RUNNER_TEMP": str(root), "EAS_BUILD_PROFILE": "production",
                           "EXPO_PUBLIC_PRIVACY_URL": "https://hither.example.net/privacy",
                           "EXPO_PUBLIC_TERMS_URL": "https://hither.example.net/terms",
                           "HITHER_TEST_CAPTURE": str(capture),
                           "HITHER_TEST_INHERITED": "inherited-private-sentinel", **inherited}
            result = subprocess.run([sys.executable, str(script), "--source-sha", "a" * 40,
                                     "--receipt", str(root / "receipt.json")],
                                    env=environment, capture_output=True, text=True)
            child = json.loads(capture.read_text()) if capture.exists() else None
            self.assertNotEqual(result.returncode, 0)
            self.assertNotIn("private-sentinel", result.stdout + result.stderr)
            return child, result

    def test_cli_profile_environment_overrides_inherited_values_before_child_commands(self):
        profile = {"env": {"EXPO_PUBLIC_DIAGNOSTIC_LEVEL": "minimal",
                           "EXPO_PUBLIC_DIAGNOSTICS_ENABLED": "true"}}
        for inherited in ({}, {"EXPO_PUBLIC_DIAGNOSTIC_LEVEL": "minimal"},
                          {"EXPO_PUBLIC_DIAGNOSTIC_LEVEL": "conflicting-private-sentinel"}):
            with self.subTest(inherited=inherited):
                child, result = self.run_profile_boundary(profile, inherited)
                self.assertEqual(child, {**profile["env"], "HITHER_TEST_INHERITED": "inherited-private-sentinel"})
                self.assertIn("hither-ios-release-stage=runner_preflight at=", result.stdout)

    def test_cli_rejects_unsupported_or_malformed_profiles_before_child_commands(self):
        for profile in (None, [], {"env": []}, {"env": {"KEY": 1}},
                        {"extends": "base"}, {"ios": {"env": {"KEY": "private-sentinel"}}},
                        {"ios": []}, {"environment": "preview"},
                        {"distribution": "internal"}, {"distribution": "internal", "developmentClient": True},
                        {"distribution": "unknown"}, {"developmentClient": "false"},
                        {"ios": {"distribution": "internal"}}, {"ios": {"environment": "preview"}}):
            with self.subTest(profile=profile):
                child, result = self.run_profile_boundary(profile, {})
                self.assertIsNone(child)
                self.assertIn("production profile", result.stderr)

    def test_cli_preserves_eas_store_default_and_explicit_environment_precedence(self):
        for profile in ({}, {"distribution": "store"}, {"distribution": "store", "developmentClient": True},
                        {"developmentClient": True}, {"distribution": "internal", "environment": "production"},
                        {"distribution": "internal", "developmentClient": True, "environment": "production"}):
            with self.subTest(profile=profile):
                child, _ = self.run_profile_boundary(profile, {})
                self.assertIsNotNone(child)

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
                    for name in ("stdout", "stderr"):
                        captures = [arg.removeprefix(f"--{name}=") for arg in args
                                    if arg.startswith(f"--{name}=")]
                        self.assertEqual(len(captures), 1)
                        capture = Path(captures[0])
                        self.assertEqual(capture, output / f"cold-start-1.{name}.log")
                        capture.write_text("private user data and token; uncaught exception")
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
                            "runtimeLogProbe": "available", "processExitProbe": "unavailable",
                            "consoleProbe": "available", "consoleTruncated": False,
                            "consoleSignals": ["uncaught_exception"]}
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
