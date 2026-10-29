#!/usr/bin/env python3
"""Behavior checks for the bounded, separate iOS launch debugger replay."""
import copy
from contextlib import contextmanager
import importlib.util
import json
import os
from pathlib import Path
import plistlib
import select
import shutil
import signal
import subprocess
import sys
import tempfile
import textwrap
import time
import types
import unittest
from unittest import mock


ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / 'apps/mobile/scripts/ios_launch_debugger.py'
SPEC = importlib.util.spec_from_file_location('ios_launch_debugger', HELPER)
DEBUGGER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(DEBUGGER)


def failure():
    return {'passed': False, 'bundleId': 'app.hither.mobile', 'build': '77',
            'attempt': 1, 'processExitProbe': 'observed', 'appExitKind': 'signaled',
            'appExitSignal': 5, 'appProcessState': 'absent', 'crashReportFound': False}


def frame():
    return {'module': 'Hither', 'uuid': '01234567-89AB-CDEF-0123-456789ABCDEF',
            'imageOffset': 42, 'function': 'hither_lldb_probe'}


def make_app(path, executable=b'same release executable', **changed):
    path.mkdir()
    info = {'CFBundleIdentifier': 'app.hither.mobile', 'CFBundleExecutable': 'Hither',
            'CFBundleVersion': '77', 'CFBundleSupportedPlatforms': ['iPhoneSimulator']}
    info.update(changed)
    (path / 'Info.plist').write_bytes(plistlib.dumps(info))
    (path / 'Hither').write_bytes(executable)
    return path


def alive(pid):
    try:
        os.kill(pid, 0)
        status = Path(f'/proc/{pid}/stat')
        return not status.exists() or status.read_text().split(') ', 1)[1][0] != 'Z'
    except ProcessLookupError:
        return False


class EligibilityTests(unittest.TestCase):
    def test_only_the_observed_sigtrap_failure_is_eligible(self):
        self.assertTrue(DEBUGGER.eligible_failure(failure()))
        self.assertTrue(DEBUGGER.eligible_failure(failure(), '77'))
        self.assertTrue(DEBUGGER.eligible_failure(dict(failure(), attempt=2), '77'))
        changes = {'passed': (True, 0, None), 'bundleId': ('other', None),
                   'build': (77, None), 'attempt': (True, 0, 3, 1.0),
                   'processExitProbe': ('unavailable', 'not_observed'),
                   'appExitKind': ('exited', None), 'appExitSignal': (True, 5.0, 6),
                   'appProcessState': ('replacement_pid', 'original_pid', 'unavailable'),
                   'crashReportFound': (True, 0, None)}
        for key, values in changes.items():
            for value in values:
                with self.subTest(key=key, value=value):
                    self.assertFalse(DEBUGGER.eligible_failure(dict(failure(), **{key: value})))
            missing = failure()
            del missing[key]
            self.assertFalse(DEBUGGER.eligible_failure(missing))
        self.assertFalse(DEBUGGER.eligible_failure(failure(), '78'))
        self.assertFalse(DEBUGGER.eligible_failure(failure(), 77))
        for malformed in (None, [], True, 'secret'):
            self.assertFalse(DEBUGGER.eligible_failure(malformed))


class SafeResultTests(unittest.TestCase):
    def test_exited_status_is_bounded_and_never_mistaken_for_os_exit_evidence(self):
        for value in (-1, 0, 2, 255, -2, 256, True, 2.0, 'private detail'):
            source = {'scope': 'diagnostic_replay', 'probe': 'exited',
                      'lldbExitStatus': value, 'sigtrapStopConfigured': True,
                      'fixtureRelease': 'write_failed', 'exitDescription': 'private detail'}
            result = DEBUGGER.safe_result(source)
            self.assertEqual(result.get('lldbExitStatus'), value if type(value) is int and -1 <= value <= 255 else None)
            self.assertIs(result['sigtrapStopConfigured'], True)
            self.assertEqual(result['fixtureRelease'], 'write_failed')
            self.assertNotIn('private', json.dumps(result))
        self.assertNotIn('lldbExitStatus', DEBUGGER.safe_result({
            'scope': 'diagnostic_replay', 'probe': 'stopped', 'lldbExitStatus': 2}))
        for value in (0, 1, 'true', None):
            self.assertNotIn('sigtrapStopConfigured', DEBUGGER.safe_result({
                'scope': 'diagnostic_replay', 'probe': 'exited', 'sigtrapStopConfigured': value}))
        for value in ('private path', 'consumed', True, None):
            self.assertNotIn('fixtureRelease', DEBUGGER.safe_result({
                'scope': 'diagnostic_replay', 'probe': 'exited', 'fixtureRelease': value}))

    def test_static_fields_are_reconstructed_and_bounded(self):
        source = {'scope': 'diagnostic_replay', 'probe': 'stopped',
                  'stopReason': 'signal', 'signal': 5,
                  'frames': [dict(frame(), variables='secret', source='/private/source')] * 20,
                  'passed': True, 'raw': 'secret', 'pid': 123}
        before = copy.deepcopy(source)
        result = DEBUGGER.safe_result(source)
        self.assertEqual(result, {'scope': 'diagnostic_replay', 'probe': 'stopped',
                                 'stopReason': 'signal', 'signal': 5, 'frames': [frame()] * 16})
        self.assertEqual(source, before)
        result['frames'][0]['function'] = 'changed'
        self.assertEqual(source, before)

    def test_unknown_shapes_and_function_data_are_rejected(self):
        for bad in (None, [], {'scope': 'other', 'probe': 'stopped'},
                    {'scope': 'diagnostic_replay', 'probe': 'secret'}):
            self.assertEqual(DEBUGGER.safe_result(bad), {})
        for value in ('/private/path', '..\\private', 'https://private', 'line\nbreak',
                      'f\x00secret', 'x' * 241, 'f(token="private")'):
            payload = {'scope': 'diagnostic_replay', 'probe': 'stopped',
                       'frames': [dict(frame(), function=value)]}
            with self.subTest(value=value):
                self.assertNotIn('function', DEBUGGER.safe_result(payload)['frames'][0])
        self.assertEqual(DEBUGGER.safe_result({'scope': 'diagnostic_replay',
                         'probe': 'timeout', 'signal': 5, 'frames': [frame()]}),
                         {'scope': 'diagnostic_replay', 'probe': 'timeout'})

    def test_frame_identity_and_numbers_have_strict_types(self):
        for key, values in {
                'module': ('../Hither', '/Hither', 'Hither\\secret', 'x' * 129, None),
                'uuid': ('secret', '0123456789abcdef0123456789abcdef', None),
                'imageOffset': (-1, True, 1.0, 2**64, '42')}.items():
            for value in values:
                payload = {'scope': 'diagnostic_replay', 'probe': 'stopped',
                           'frames': [dict(frame(), **{key: value})]}
                with self.subTest(key=key, value=value):
                    self.assertEqual(DEBUGGER.safe_result(payload)['frames'], [])
        for code in (0, 128, True, 5.0, '5', None):
            self.assertNotIn('signal', DEBUGGER.safe_result({
                'scope': 'diagnostic_replay', 'probe': 'stopped', 'stopReason': 'signal',
                'signal': code}))
        for reason in ('exception', 'other', 'secret', ['secret']):
            self.assertNotIn('signal', DEBUGGER.safe_result({
                'scope': 'diagnostic_replay', 'probe': 'stopped',
                'stopReason': reason, 'signal': 5}))
        result = DEBUGGER.safe_result({'scope': 'diagnostic_replay', 'probe': 'stopped',
                                      'frames': [dict(frame(), uuid=frame()['uuid'].lower())]})
        self.assertEqual(result['frames'][0]['uuid'], frame()['uuid'])

    def test_only_finite_stage_names_survive_sanitization(self):
        for stage in DEBUGGER.STAGES:
            self.assertEqual(DEBUGGER.safe_result({'scope': 'diagnostic_replay', 'probe': 'timeout',
                                                   'stage': stage}),
                             {'scope': 'diagnostic_replay', 'probe': 'timeout', 'stage': stage})
        for stage in ('/private/attach', 'private error', ['attach'], True, None):
            self.assertNotIn('stage', DEBUGGER.safe_result({'scope': 'diagnostic_replay',
                                                          'probe': 'unavailable', 'stage': stage}))

    def test_cleanup_status_is_an_explicit_boolean(self):
        for value in (True, False, 0, 1, 'private error', None):
            result = DEBUGGER.safe_result({'scope': 'diagnostic_replay', 'probe': 'stopped',
                                          'cleanupFailed': value})
            if type(value) is bool:
                self.assertIs(result['cleanupFailed'], value)
            else:
                self.assertNotIn('cleanupFailed', result)


class ReplayTests(unittest.TestCase):
    def test_ineligible_and_non_native_runs_never_launch_and_preserve_original(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            original = base / 'original.json'
            for index, payload in enumerate((dict(failure(), passed=True), failure())):
                data = json.dumps(payload, indent=3).encode() + b'\n'
                original.write_bytes(data)
                with mock.patch.object(DEBUGGER, '_run_command') as run, \
                        mock.patch.object(DEBUGGER, '_is_darwin', return_value=False):
                    result = DEBUGGER.replay(base / 'App.app', 'not-a-udid', '77', original,
                                             base / str(index))
                self.assertEqual(result['probe'], 'not_eligible' if index == 0 else 'unavailable')
                self.assertEqual(original.read_bytes(), data)
                run.assert_not_called()

    def test_binary_metadata_and_hash_mismatch_prevents_launch(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            compiled = make_app(base / 'Compiled.app')
            installed = make_app(base / 'Installed.app', executable=b'different')
            output = base / 'output'
            output.mkdir()
            container = subprocess.CompletedProcess([], 0, str(installed) + '\n', '')
            with mock.patch.object(DEBUGGER, '_run_command', return_value=container) as run:
                with self.assertRaises(DEBUGGER._IdentityMismatch):
                    DEBUGGER._installed_executable(compiled, 'simulator', '77', output)
            self.assertEqual(run.call_count, 1)
            (installed / 'Hither').write_bytes((compiled / 'Hither').read_bytes())
            info = plistlib.loads((installed / 'Info.plist').read_bytes())
            info['CFBundleVersion'] = '78'
            (installed / 'Info.plist').write_bytes(plistlib.dumps(info))
            with mock.patch.object(DEBUGGER, '_run_command', return_value=container):
                with self.assertRaises(DEBUGGER._IdentityMismatch):
                    DEBUGGER._installed_executable(compiled, 'simulator', '77', output)

    def test_running_installed_app_is_not_reused_or_terminated(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            app = make_app(base / 'App.app')
            output = base / 'output'
            output.mkdir()
            commands = (subprocess.CompletedProcess([], 0, str(app) + '\n', ''),
                        subprocess.CompletedProcess([], 0, '123\n', ''))
            with mock.patch.object(DEBUGGER, '_run_command', side_effect=commands), \
                    mock.patch.object(DEBUGGER, 'host_executable_path', return_value=str(app / 'Hither')), \
                    mock.patch.object(DEBUGGER.os, 'kill') as kill:
                with self.assertRaises(DEBUGGER._IdentityMismatch):
                    DEBUGGER._installed_executable(app, 'simulator', '77', output)
            kill.assert_not_called()

    def test_wrong_returned_pid_never_attaches_or_kills(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            original = base / 'original.json'
            original.write_text(json.dumps(failure()))
            with mock.patch.object(DEBUGGER, '_is_darwin', return_value=True), \
                    mock.patch.object(DEBUGGER, '_installed_executable',
                                      return_value=(base / 'Hither', base / 'Compiled/Hither')), \
                    mock.patch.object(DEBUGGER, '_run_command', return_value=
                                      subprocess.CompletedProcess([], 0, 'app.hither.mobile: 123\n', '')), \
                    mock.patch.object(DEBUGGER, 'host_executable_path', return_value='/unrelated/process'), \
                    mock.patch.object(DEBUGGER, '_run_lldb') as capture, \
                    mock.patch.object(DEBUGGER.os, 'kill') as kill:
                result = DEBUGGER.replay(base / 'App.app', frame()['uuid'], '77', original, base / 'output')
            self.assertEqual(result['probe'], 'identity_mismatch')
            capture.assert_not_called()
            kill.assert_not_called()

    def test_output_reservation_prevents_a_second_launch_or_overwrite(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'existing'
            output.mkdir()
            marker = output / DEBUGGER.RESULT_NAME
            marker.write_text('immutable prior diagnostic')
            with mock.patch.object(DEBUGGER, '_run_command') as run:
                with self.assertRaises(FileExistsError):
                    DEBUGGER.replay('/App.app', frame()['uuid'], '77', '/original.json', output)
            self.assertEqual(marker.read_text(), 'immutable prior diagnostic')
            run.assert_not_called()

    def test_outer_replay_cleanup_failure_keeps_capture_and_original_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            original = base / 'original.json'
            original.write_text(json.dumps(failure()))
            before = original.read_bytes()
            owned = mock.Mock()
            owned.close.side_effect = OSError('private cleanup error')
            captured = {'scope': 'diagnostic_replay', 'probe': 'stopped',
                        'stopReason': 'signal', 'signal': 5, 'frames': [frame()], 'cleanupFailed': False}
            with mock.patch.object(DEBUGGER, '_is_darwin', return_value=True), \
                    mock.patch.object(DEBUGGER, '_installed_executable',
                                      return_value=(base / 'Installed/Hither', base / 'Compiled/Hither')), \
                    mock.patch.object(DEBUGGER, '_run_command', return_value=
                                      subprocess.CompletedProcess([], 0, 'app.hither.mobile: 123\n', '')), \
                    mock.patch.object(DEBUGGER, '_OwnedAppProcess', return_value=owned), \
                    mock.patch.object(DEBUGGER, '_run_lldb', return_value=captured):
                result = DEBUGGER.replay(base / 'App.app', frame()['uuid'], '77', original, base / 'output')
            self.assertEqual(result['frames'], [frame()])
            self.assertIs(result['cleanupFailed'], True)
            self.assertEqual(original.read_bytes(), before)
            self.assertNotIn('private', json.dumps(result))


@contextmanager
def lldb_fixture(mode='stopped'):
    calls = []
    error = mock.Mock()
    error.Fail.return_value = mode == 'denied'
    target, process, thread, stack_frame = (mock.Mock() for _ in range(4))
    module = stack_frame.GetModule.return_value
    target.IsValid.return_value = process.IsValid.return_value = thread.IsValid.return_value = True
    stack_frame.IsValid.return_value = module.IsValid.return_value = True
    target.AttachToProcessWithID.return_value = process
    process.GetProcessID.return_value = 123
    process.Continue.return_value = mock.Mock(Fail=lambda: False)
    process.Continue.side_effect = lambda: (calls.append('continue') or mock.Mock(Fail=lambda: False))
    process.GetState.return_value = 2 if mode == 'exited' else 1
    process.GetSelectedThread.return_value = thread
    process.GetNumThreads.return_value = 1
    process.GetThreadAtIndex.return_value = thread
    process.GetUnixSignals.return_value.IsValid.return_value = True
    process.GetUnixSignals.return_value.SetShouldStop.return_value = True
    process.GetExitStatus.return_value = 2
    process.Kill.return_value.Fail.return_value = False
    process.Detach.return_value.Fail.return_value = False
    thread.GetStopReason.return_value = 3
    thread.GetStopReasonDataCount.return_value = 1
    thread.GetStopReasonDataAtIndex.return_value = 5
    thread.GetNumFrames.return_value = 1
    thread.GetFrameAtIndex.return_value = stack_frame
    stack_frame.GetPCAddress.return_value.GetLoadAddress.return_value = 1042
    module.GetObjectFileHeaderAddress.return_value.GetLoadAddress.return_value = 1000
    module.GetFileSpec.return_value.GetFilename.return_value = 'Hither'
    module.GetUUIDString.return_value = frame()['uuid']
    stack_frame.GetFunctionName.return_value = 'hither_lldb_probe'
    debugger = mock.Mock()
    debugger.CreateTarget.return_value = target
    native = types.SimpleNamespace(SBTarget=type(target), SBProcess=type(process),
                                   SBThread=type(thread), SBFrame=type(stack_frame),
                                   SBError=lambda: error, LLDB_INVALID_ADDRESS=2**64 - 1,
                                   eStateStopped=1, eStateCrashed=4, eStateExited=2,
                                   eStopReasonSignal=3, eStopReasonException=6)
    with mock.patch.dict(sys.modules, {'lldb': native}):
        yield debugger, process, calls


class CaptureTests(unittest.TestCase):
    def test_sb_api_captures_static_frame_then_cleans_only_attached_process(self):
        with tempfile.TemporaryDirectory() as directory, lldb_fixture() as (debugger, process, calls), \
                mock.patch.object(DEBUGGER, '_same_executable', return_value=True):
            DEBUGGER.lldb_capture(debugger, 123, '/installed/Hither', Path(directory))
            result = json.loads((Path(directory) / DEBUGGER.CAPTURE_RESULT_NAME).read_text())
            self.assertEqual(result, {'scope': 'diagnostic_replay', 'probe': 'stopped',
                                     'stage': 'frames', 'stopReason': 'signal', 'signal': 5,
                                     'frames': [frame()], 'cleanupFailed': False})
            self.assertEqual(calls, ['continue'])
            process.Kill.assert_called_once_with()
            process.Detach.assert_not_called()
            debugger.SetAsync.assert_called_once_with(False)

    def test_denied_attach_has_no_continue_and_no_free_form_error(self):
        with tempfile.TemporaryDirectory() as directory, lldb_fixture('denied') as (debugger, process, calls), \
                mock.patch.object(DEBUGGER, '_same_executable', return_value=True):
            DEBUGGER.lldb_capture(debugger, 123, '/installed/Hither', Path(directory))
            result = json.loads((Path(directory) / DEBUGGER.CAPTURE_RESULT_NAME).read_text())
            self.assertEqual(result, {'scope': 'diagnostic_replay', 'probe': 'unavailable', 'stage': 'attach'})
            self.assertEqual(calls, [])
            process.Kill.assert_not_called()

    def test_identity_changed_after_attach_is_detached_without_continue_or_kill(self):
        with tempfile.TemporaryDirectory() as directory, lldb_fixture() as (debugger, process, calls), \
                mock.patch.object(DEBUGGER, '_same_executable', side_effect=[True, False]):
            DEBUGGER.lldb_capture(debugger, 123, '/installed/Hither', Path(directory))
            result = json.loads((Path(directory) / DEBUGGER.CAPTURE_RESULT_NAME).read_text())
            self.assertEqual(result, {'scope': 'diagnostic_replay', 'probe': 'identity_mismatch',
                                     'stage': 'identity'})
            self.assertEqual(calls, [])
            process.Kill.assert_not_called()
            process.Detach.assert_called_once_with(True)

    def test_exit_is_separate_evidence_without_stale_frames(self):
        with tempfile.TemporaryDirectory() as directory, lldb_fixture('exited') as (debugger, process, _), \
                mock.patch.object(DEBUGGER, '_same_executable', return_value=True):
            DEBUGGER.lldb_capture(debugger, 123, '/installed/Hither', Path(directory))
            result = json.loads((Path(directory) / DEBUGGER.CAPTURE_RESULT_NAME).read_text())
            self.assertEqual(result, {'scope': 'diagnostic_replay', 'probe': 'exited', 'stage': 'continue',
                                     'lldbExitStatus': 2, 'sigtrapStopConfigured': True})

    def test_debugserver_lost_status_remains_lldb_evidence(self):
        with tempfile.TemporaryDirectory() as directory, lldb_fixture('exited') as (debugger, process, _), \
                mock.patch.object(DEBUGGER, '_same_executable', return_value=True):
            process.GetExitStatus.return_value = -1
            process.GetExitDescription.return_value = 'private error description'
            DEBUGGER.lldb_capture(debugger, 123, '/installed/Hither', Path(directory))
            result = json.loads((Path(directory) / DEBUGGER.CAPTURE_RESULT_NAME).read_text())
            self.assertEqual(result['lldbExitStatus'], -1)
            self.assertNotIn('private', json.dumps(result))
            process.GetExitDescription.assert_not_called()

    def test_symbol_target_uses_compiled_binary_but_pid_checks_stay_installed(self):
        with tempfile.TemporaryDirectory() as directory, lldb_fixture() as (debugger, process, _):
            base = Path(directory)
            installed, compiled = base / 'installed', base / 'compiled'
            installed.write_bytes(b'identical Mach-O including UUID')
            compiled.write_bytes(installed.read_bytes())
            output = base / 'output'
            output.mkdir()
            with mock.patch.object(DEBUGGER, '_same_executable', return_value=True) as identity:
                DEBUGGER.lldb_capture(debugger, 123, installed, output, symbol_executable=compiled)
            debugger.CreateTarget.assert_called_once_with(str(compiled))
            self.assertTrue(all(call.args == (123, installed) for call in identity.call_args_list))
            process.Continue.assert_called_once_with()

    def test_different_symbol_binary_is_rejected_before_attach(self):
        with tempfile.TemporaryDirectory() as directory, lldb_fixture() as (debugger, process, _):
            base = Path(directory)
            installed, compiled = base / 'installed', base / 'compiled'
            installed.write_bytes(b'installed')
            compiled.write_bytes(b'different')
            output = base / 'output'
            output.mkdir()
            with mock.patch.object(DEBUGGER, '_same_executable', return_value=True):
                DEBUGGER.lldb_capture(debugger, 123, installed, output, symbol_executable=compiled)
            result = json.loads((output / DEBUGGER.CAPTURE_RESULT_NAME).read_text())
            self.assertEqual(result['probe'], 'identity_mismatch')
            debugger.CreateTarget.assert_not_called()
            process.Continue.assert_not_called()

    def test_cleanup_failure_preserves_frames_but_rejects_fixture_success(self):
        for raises in (False, True):
            with self.subTest(raises=raises), tempfile.TemporaryDirectory() as directory, \
                    lldb_fixture() as (debugger, process, _), \
                    mock.patch.object(DEBUGGER, '_same_executable', return_value=True):
                process.Kill.return_value.Fail.return_value = True
                if raises:
                    process.Kill.side_effect = RuntimeError('/private/cleanup token=secret')
                DEBUGGER.lldb_capture(debugger, 123, '/installed/Hither', Path(directory))
                result = json.loads((Path(directory) / DEBUGGER.CAPTURE_RESULT_NAME).read_text())
                self.assertEqual(result, {'scope': 'diagnostic_replay', 'probe': 'stopped',
                                         'stage': 'frames', 'stopReason': 'signal', 'signal': 5,
                                         'frames': [frame()], 'cleanupFailed': True})
                self.assertFalse(DEBUGGER._fixture_captured(result))

    def test_fixture_requires_known_successful_cleanup(self):
        result = {'scope': 'diagnostic_replay', 'probe': 'stopped',
                  'stopReason': 'signal', 'signal': 5, 'frames': [frame()]}
        self.assertFalse(DEBUGGER._fixture_captured(result))
        self.assertTrue(DEBUGGER._fixture_captured(dict(result, cleanupFailed=False, fixtureRelease='sent')))


FAKE_XCRUN = r'''#!/usr/bin/env python3
import json, os
from pathlib import Path
import subprocess, sys, time
root = Path(os.environ['DEBUGGER_FIXTURE_ROOT'])
mode = os.environ.get('DEBUGGER_FIXTURE_MODE', 'success')
with (root / 'calls.jsonl').open('a') as stream:
    stream.write(json.dumps(sys.argv[1:]) + '\n')
args = sys.argv[1:]
if args[:2] == ['--sdk', 'macosx']:
    args = args[2:]
if args[:3] == ['simctl', 'help', 'launch']:
    if mode == 'usage':
        print('Usage: launch [--wait-for-debugger] [--stdout|--stderr]')
    elif mode == 'suffix':
        print('Usage: launch [--wait-for-debugger-extra] [--stdout2] [--stderr]')
    else:
        print('--stdout=<path> --stderr=<path>')
        print('--wait-for-debugger' if mode != 'unsupported' else '--other-option', file=sys.stderr)
elif args[0] == 'clang':
    executable = Path(args[args.index('-o') + 1])
    executable.write_text('#!' + sys.executable + '\n'
                          'import os, sys\nfrom pathlib import Path\n'
                          'root = Path(os.environ["DEBUGGER_FIXTURE_ROOT"])\n'
                          'sys.stdin.buffer.read(1)\n'
                          '(root / "released-after-attach").write_text(str((root / "output/attached.ready").exists()))\n')
    executable.chmod(0o700)
elif args[:2] == ['simctl', 'get_app_container']:
    print(root / 'Installed.app')
elif args[:2] == ['simctl', 'launch']:
    with open(os.devnull, 'wb') as devnull:
        child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'],
                                 stdin=subprocess.DEVNULL, stdout=devnull, stderr=devnull,
                                 start_new_session=True)
    (root / 'app.pid').write_text(str(child.pid))
    print('app.hither.mobile: ' + str(child.pid), flush=True)
    if mode == 'launch-timeout':
        time.sleep(60)
elif args[0] == 'lldb':
    if mode == 'denied':
        print('attach denied /private/path token=private', file=sys.stderr)
        sys.exit(1)
    if mode == 'timeout':
        child = subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(60)'])
        (root / 'debugger-child.pid').write_text(str(child.pid))
        time.sleep(60)
    output = root / 'output'
    (output / 'attached.ready').touch()
    if (output / 'hither_lldb_probe').exists():
        until = time.monotonic() + 2
        while not (root / 'released-after-attach').exists() and time.monotonic() < until:
            time.sleep(0.01)
    result = {'scope': 'diagnostic_replay', 'probe': 'stopped', 'stage': 'frames',
              'stopReason': 'signal', 'signal': 5, 'cleanupFailed': mode == 'cleanup',
              'frames': [] if mode == 'empty' else [
                  {'module': 'Hither', 'uuid': '01234567-89AB-CDEF-0123-456789ABCDEF',
                   'imageOffset': 42, 'function': 'hither_lldb_probe'}]}
    (output / 'lldb-capture.json').write_text(json.dumps(result))
else:
    sys.exit(2)
'''

CLI_DRIVER = '''import importlib.util, os, subprocess, sys, time
from pathlib import Path
spec = importlib.util.spec_from_file_location('ios_launch_debugger', sys.argv[1])
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
root = Path(os.environ['DEBUGGER_FIXTURE_ROOT'])
module._is_darwin = lambda: True
module.DEBUGGER_TIMEOUT = 0.8
native_run = module._run_command
def bounded_run(argv, output, name, **options):
    if name == 'launch' and os.environ.get('DEBUGGER_FIXTURE_MODE') == 'launch-timeout':
        native_popen = subprocess.Popen
        def command_process(*args, **kwargs):
            process = native_popen(*args, **kwargs)
            native_wait = process.wait
            pending = True
            def wait(timeout=None):
                nonlocal pending
                if pending:
                    pending = False
                    until = time.monotonic() + 5
                    def pid_returned():
                        try:
                            pid = (root / 'app.pid').read_text().strip()
                            return pid.isdigit() and (output / 'launch.stdout.log').read_text().strip() == 'app.hither.mobile: ' + pid
                        except OSError:
                            return False
                    while not pid_returned() and process.poll() is None and time.monotonic() < until:
                        time.sleep(0.01)
                    if not pid_returned():
                        raise RuntimeError('controlled launch did not produce its PID')
                    raise subprocess.TimeoutExpired(process.args, timeout)
                return native_wait(timeout=timeout)
            process.wait = wait
            return process
        subprocess.Popen = command_process
        try:
            return native_run(argv, output, name, **options)
        finally:
            subprocess.Popen = native_popen
    return native_run(argv, output, name, **options)
module._run_command = bounded_run
def executable(pid):
    if sys.argv[2] == 'check':
        return str(root / 'output/hither_lldb_probe')
    recorded = root / 'app.pid'
    if recorded.exists() and int(recorded.read_text()) == pid:
        return str(root / 'Installed.app/Hither')
    return None
module.host_executable_path = executable
sys.exit(module.main(sys.argv[2:]))
'''


@unittest.skipUnless(sys.platform.startswith('linux'), 'Controlled executable identities use Linux fixtures')
class ControlledCliTests(unittest.TestCase):
    def run_cli(self, command='check', mode='success'):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        base = Path(temporary.name)
        binary = base / 'bin'
        binary.mkdir()
        xcrun = binary / 'xcrun'
        xcrun.write_text(FAKE_XCRUN)
        xcrun.chmod(0o700)
        driver = base / 'driver.py'
        driver.write_text(CLI_DRIVER)
        args = [sys.executable, str(driver), str(HELPER), command, '--output', str(base / 'output')]
        if command == 'replay':
            make_app(base / 'Compiled.app')
            make_app(base / 'Installed.app')
            (base / 'original.json').write_text(json.dumps(failure(), indent=4) + '\n')
            args.extend(('--app', str(base / 'Compiled.app'), '--simulator', frame()['uuid'],
                         '--build', '77', '--original-result', str(base / 'original.json')))
        environment = dict(os.environ, PATH=str(binary) + os.pathsep + os.environ.get('PATH', ''),
                           DEBUGGER_FIXTURE_ROOT=str(base), DEBUGGER_FIXTURE_MODE=mode)
        result = subprocess.run(args, env=environment, capture_output=True, text=True, timeout=8)
        self.assertEqual(result.stdout, '')
        self.assertEqual(result.stderr, '')
        calls = [json.loads(line) for line in (base / 'calls.jsonl').read_text().splitlines()]
        exported = json.loads((base / 'output' / DEBUGGER.RESULT_NAME).read_text())
        self.assertEqual(exported, DEBUGGER.safe_result(exported))
        return base, result, exported, calls, args, environment

    def test_prebuild_check_uses_both_help_streams_and_releases_only_after_attach(self):
        base, result, exported, calls, _, _ = self.run_cli()
        self.assertEqual(result.returncode, 0)
        self.assertTrue(DEBUGGER._fixture_captured(exported))
        self.assertEqual((base / 'released-after-attach').read_text(), 'True')
        self.assertEqual(calls[0], ['simctl', 'help', 'launch'])
        self.assertEqual(calls[1][:5], ['--sdk', 'macosx', 'clang', '-g', '-O0'])
        self.assertIn('--no-lldbinit', calls[2])
        self.assertIn('--batch', calls[2])
        self.assertEqual(calls[2].count('-o'), 1)
        self.assertNotIn('backtrace', calls[2])

    def test_unsupported_launch_flags_stop_before_compile(self):
        for mode in ('unsupported', 'suffix'):
            with self.subTest(mode=mode):
                _, result, exported, calls, _, _ = self.run_cli(mode=mode)
                self.assertEqual(result.returncode, 1)
                self.assertEqual(exported['probe'], 'unavailable')
                self.assertEqual(exported['stage'], 'launch_help')
                self.assertEqual(len(calls), 1)

    def test_usage_only_help_accepts_documented_flag_delimiters(self):
        _, result, exported, _, _, _ = self.run_cli(mode='usage')
        self.assertEqual(result.returncode, 0)
        self.assertTrue(DEBUGGER._fixture_captured(exported))

    def test_denied_attach_and_empty_stack_fail_the_prebuild_check(self):
        for mode in ('denied', 'empty', 'cleanup'):
            with self.subTest(mode=mode):
                _, result, _, _, _, _ = self.run_cli(mode=mode)
                self.assertEqual(result.returncode, 1)

    def test_replay_cleanup_failure_keeps_frames_with_failed_command(self):
        base, result, exported, _, _, _ = self.run_cli(command='replay', mode='cleanup')
        self.assertEqual(result.returncode, 1)
        self.assertEqual(exported['frames'], [frame()])
        self.assertIs(exported['cleanupFailed'], True)
        self.assertFalse(alive(int((base / 'app.pid').read_text())))

    def test_debugger_timeout_kills_descendants_and_fails_closed(self):
        base, result, exported, _, _, _ = self.run_cli(mode='timeout')
        self.assertEqual(result.returncode, 1)
        self.assertEqual(exported['probe'], 'timeout')
        self.assertEqual(exported['stage'], 'attach')
        pid = int((base / 'debugger-child.pid').read_text())
        self.assertFalse(alive(pid))

    def test_one_replay_preserves_original_and_cleans_its_real_child(self):
        unrelated = subprocess.Popen((sys.executable, '-c', 'import time; time.sleep(60)'),
                                     start_new_session=True)
        self.addCleanup(lambda: (unrelated.kill(), unrelated.wait()) if unrelated.poll() is None else None)
        base, result, exported, calls, args, environment = self.run_cli(command='replay')
        self.assertEqual(result.returncode, 0)
        self.assertEqual(exported['probe'], 'stopped')
        self.assertEqual((base / 'original.json').read_text(), json.dumps(failure(), indent=4) + '\n')
        launches = [call for call in calls if call[:2] == ['simctl', 'launch']]
        self.assertEqual(len(launches), 1)
        self.assertIn('--wait-for-debugger', launches[0])
        self.assertFalse(alive(int((base / 'app.pid').read_text())))
        self.assertTrue(alive(unrelated.pid))
        before = (base / 'output' / DEBUGGER.RESULT_NAME).read_bytes()
        again = subprocess.run(args, env=environment, capture_output=True, text=True, timeout=5)
        self.assertEqual(again.returncode, 1)
        self.assertEqual((base / 'output' / DEBUGGER.RESULT_NAME).read_bytes(), before)
        self.assertEqual((base / 'calls.jsonl').read_text().count('"launch"'), 1)
        for call in calls:
            self.assertFalse(any(option in call for option in ('install', 'uninstall', 'erase', 'terminate')))

    def test_replay_debugger_timeout_cleans_app_and_debugger_descendant(self):
        base, result, exported, _, _, _ = self.run_cli(command='replay', mode='timeout')
        self.assertEqual(result.returncode, 1)
        self.assertEqual(exported, {'scope': 'diagnostic_replay', 'probe': 'timeout', 'stage': 'attach'})
        self.assertFalse(alive(int((base / 'app.pid').read_text())))
        self.assertFalse(alive(int((base / 'debugger-child.pid').read_text())))

    def test_launch_timeout_after_returned_pid_cleans_only_that_diagnostic_child(self):
        base, result, exported, calls, _, _ = self.run_cli(command='replay', mode='launch-timeout')
        self.assertEqual(result.returncode, 1)
        self.assertEqual(exported, {'scope': 'diagnostic_replay', 'probe': 'timeout', 'stage': 'replay_launch'})
        self.assertFalse(alive(int((base / 'app.pid').read_text())))
        self.assertFalse(any(call[0] == 'lldb' for call in calls))


@unittest.skipUnless(sys.platform.startswith('linux') and shutil.which('cc'),
                     'Real C read interruption test uses Linux and cc')
class NativeFixtureReadTests(unittest.TestCase):
    def compile_fixture(self, directory, closed_stdin=False):
        source, binary = Path(directory) / 'probe.c', Path(directory) / 'probe'
        source.write_text('''#include <errno.h>
#include <signal.h>
#include <sys/resource.h>
#include <unistd.h>
static void interrupt_read(int value) { (void)value; }
__attribute__((constructor)) static void install_handler(void) {
  struct sigaction action = {0};
  action.sa_handler = interrupt_read;
  sigemptyset(&action.sa_mask);
  sigaction(SIGALRM, &action, 0);
  struct rlimit limit = {0, 0};
  setrlimit(RLIMIT_CORE, &limit);
#ifdef FIXTURE_CLOSED_STDIN
  close(STDIN_FILENO);
#endif
  alarm(1);
}
static ssize_t record_read(int fd, void *buffer, size_t size) {
  ssize_t count = read(fd, buffer, size);
  int saved = errno;
  if (count == -1 && saved == EINTR) (void)write(1, "i", 1);
  errno = saved;
  return count;
}
#define read record_read
#define __builtin_debugtrap() raise(SIGTRAP)
''' + DEBUGGER.FIXTURE_SOURCE)
        if closed_stdin:
            source.write_text('#define FIXTURE_CLOSED_STDIN\n' + source.read_text())
        built = subprocess.run(('cc', '-O0', str(source), '-o', str(binary)),
                               capture_output=True, text=True, timeout=10)
        self.assertEqual(built.returncode, 0, built.stderr)
        return binary

    def test_real_c_interrupted_read_waits_for_release_and_reaches_trap(self):
        with tempfile.TemporaryDirectory() as directory:
            binary = self.compile_fixture(directory)
            process = subprocess.Popen((str(binary),), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                       stderr=subprocess.PIPE, start_new_session=True)
            try:
                ready, _, _ = select.select([process.stdout], [], [], 4)
                self.assertTrue(ready, 'the actual C read must return EINTR before release')
                self.assertEqual(process.stdout.read(1), b'i')
                process.communicate(b'x', timeout=2)
                self.assertEqual(process.returncode, -signal.SIGTRAP,
                                 'an interrupted read must still wait for release and reach the trap')
            finally:
                if process.poll() is None:
                    process.kill()
                process.communicate(timeout=2)

    def test_real_c_eof_still_rejects_the_fixture(self):
        with tempfile.TemporaryDirectory() as directory:
            binary = self.compile_fixture(directory)
            process = subprocess.run((str(binary),), stdin=subprocess.DEVNULL,
                                     capture_output=True, timeout=2)
            self.assertEqual(process.returncode, 2)

    def test_real_c_fatal_read_error_stays_distinct_from_eof(self):
        with tempfile.TemporaryDirectory() as directory:
            binary = self.compile_fixture(directory, closed_stdin=True)
            process = subprocess.run((str(binary),), stdin=subprocess.DEVNULL,
                                     capture_output=True, timeout=2)
            self.assertEqual(process.returncode, 3)


class DebuggerCommandResultTests(unittest.TestCase):
    def test_debugger_command_cleanup_failure_preserves_its_committed_capture(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory)
            captured = {'scope': 'diagnostic_replay', 'probe': 'stopped', 'stage': 'frames',
                        'stopReason': 'signal', 'signal': 5, 'frames': [frame()], 'cleanupFailed': False}
            raw = json.dumps(captured).encode()
            (output / DEBUGGER.CAPTURE_RESULT_NAME).write_bytes(raw)
            process = mock.Mock()
            process.poll.return_value = 0
            with mock.patch.object(DEBUGGER.subprocess, 'Popen', return_value=process), \
                    mock.patch.object(DEBUGGER, '_stop_group', side_effect=OSError('private cleanup error')):
                result = DEBUGGER._run_lldb(123, '/installed/Hither', output)
            self.assertEqual(result['frames'], [frame()])
            self.assertIs(result['cleanupFailed'], True)
            self.assertFalse(DEBUGGER._fixture_captured(dict(result, fixtureRelease='sent')))
            self.assertEqual((output / DEBUGGER.CAPTURE_RESULT_NAME).read_bytes(), raw)
            self.assertNotIn('private', json.dumps(result))


class HostCheckResultTests(unittest.TestCase):
    def run_host_check(self, captured, invoke_release=True, broken_pipe=False, cleanup_failed=False):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'output'
            fixture = mock.Mock()
            fixture.pid = 123
            fixture.stdin.closed = False
            if broken_pipe:
                fixture.stdin.write.side_effect = BrokenPipeError('private write error')
                fixture.stdin.close.side_effect = BrokenPipeError('private close error')
            else:
                fixture.stdin.close.side_effect = lambda: setattr(fixture.stdin, 'closed', True)

            def capture(pid, executable, destination, attached=None):
                if invoke_release:
                    attached()
                (destination / DEBUGGER.CAPTURE_RESULT_NAME).write_text(json.dumps(captured))
                return DEBUGGER._read_result(destination, DEBUGGER.CAPTURE_RESULT_NAME)

            command = subprocess.CompletedProcess([], 0, '--wait-for-debugger --stdout --stderr', '')
            with mock.patch.object(DEBUGGER, '_is_darwin', return_value=True), \
                    mock.patch.object(DEBUGGER, '_run_command', return_value=command), \
                    mock.patch.object(DEBUGGER, '_same_executable', return_value=True), \
                    mock.patch.object(DEBUGGER.subprocess, 'Popen', return_value=fixture), \
                    mock.patch.object(DEBUGGER, '_run_lldb', side_effect=capture), \
                    mock.patch.object(DEBUGGER, '_stop_group',
                                      side_effect=OSError('private cleanup error') if cleanup_failed else None) as stop:
                result = DEBUGGER.check(output)
            stop.assert_called_once_with(fixture)
            final = json.loads((output / DEBUGGER.RESULT_NAME).read_text())
            self.assertEqual(result, final)
            self.assertEqual(json.loads((output / DEBUGGER.CAPTURE_RESULT_NAME).read_text()), captured)
            self.assertNotIn('private', json.dumps(final))
            return result

    def test_exited_check_keeps_lldb_status_and_completed_release(self):
        for status in (2, -1):
            with self.subTest(status=status):
                result = self.run_host_check({'scope': 'diagnostic_replay', 'probe': 'exited',
                    'stage': 'continue', 'lldbExitStatus': status, 'sigtrapStopConfigured': True})
                self.assertEqual(result['lldbExitStatus'], status)
                self.assertEqual(result['fixtureRelease'], 'sent')
                self.assertFalse(DEBUGGER._fixture_captured(result))

    def test_fast_exit_records_unobserved_release_without_losing_status(self):
        result = self.run_host_check({'scope': 'diagnostic_replay', 'probe': 'exited',
            'stage': 'continue', 'lldbExitStatus': 2}, invoke_release=False)
        self.assertEqual(result['lldbExitStatus'], 2)
        self.assertEqual(result['fixtureRelease'], 'not_observed')

    def test_broken_pipe_and_close_failure_still_publish_capture_and_cleanup(self):
        result = self.run_host_check({'scope': 'diagnostic_replay', 'probe': 'exited',
            'stage': 'continue', 'lldbExitStatus': 2}, broken_pipe=True)
        self.assertEqual(result['lldbExitStatus'], 2)
        self.assertEqual(result['fixtureRelease'], 'write_failed')

    def test_named_trap_requires_release_and_successful_cleanup(self):
        captured = {'scope': 'diagnostic_replay', 'probe': 'stopped', 'stage': 'frames',
                    'stopReason': 'signal', 'signal': 5, 'frames': [frame()], 'cleanupFailed': False}
        result = self.run_host_check(captured)
        self.assertTrue(DEBUGGER._fixture_captured(result))
        result = self.run_host_check(captured, invoke_release=False)
        self.assertFalse(DEBUGGER._fixture_captured(result))
        self.assertEqual(result['frames'], [frame()])

    def test_outer_cleanup_failure_retains_static_frames_and_fails_check(self):
        captured = {'scope': 'diagnostic_replay', 'probe': 'stopped', 'stage': 'frames',
                    'stopReason': 'signal', 'signal': 5, 'frames': [frame()], 'cleanupFailed': False}
        result = self.run_host_check(captured, cleanup_failed=True)
        self.assertIs(result['cleanupFailed'], True)
        self.assertEqual(result['frames'], [frame()])
        self.assertFalse(DEBUGGER._fixture_captured(result))


class NativeCheckTests(unittest.TestCase):
    @unittest.skipUnless(sys.platform.startswith('linux'), 'This check covers the unavailable Linux toolchain')
    def test_real_cli_fails_closed_without_a_native_toolchain(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'unavailable'
            result = subprocess.run((sys.executable, str(HELPER), 'check', '--output', str(output)),
                                    capture_output=True, text=True, timeout=5)
            self.assertEqual(result.returncode, 1)
            self.assertEqual(result.stdout, '')
            self.assertEqual(result.stderr, '')
            self.assertEqual(json.loads((output / DEBUGGER.RESULT_NAME).read_text()),
                             {'scope': 'diagnostic_replay', 'probe': 'unavailable', 'stage': 'launch_help', 'fixtureRelease': 'not_observed'})

    @unittest.skipUnless(sys.platform == 'darwin' and shutil.which('xcrun'),
                         'Selected-Xcode LLDB trap capture requires Darwin and xcrun')
    def test_selected_lldb_captures_the_real_named_c_trap(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'native'
            result = subprocess.run((sys.executable, str(HELPER), 'check', '--output', str(output)),
                                    capture_output=True, text=True, timeout=100)
            self.assertEqual(result.returncode, 0)
            self.assertTrue(DEBUGGER._fixture_captured(json.loads((output / DEBUGGER.RESULT_NAME).read_text())))


if __name__ == '__main__':
    unittest.main()
