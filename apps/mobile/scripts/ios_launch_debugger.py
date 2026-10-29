#!/usr/bin/env python3
"""Capture a bounded static stack in a separate, same-install SIGTRAP replay.

Raw debugger and console files stay in the private runner-local output directory.
Only replay-result.json, reconstructed by safe_result, is suitable for an artifact.
This helper never installs an app, changes simulator data, or passes a launch gate.
"""
import argparse
import ctypes
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import select
import signal
import subprocess
import sys
import time
import uuid


BUNDLE = 'app.hither.mobile'
RESULT_NAME = 'replay-result.json'
CAPTURE_RESULT_NAME = 'lldb-capture.json'
PROBES = frozenset(('stopped', 'exited', 'timeout', 'unavailable',
                    'not_eligible', 'identity_mismatch'))
STOP_REASONS = frozenset(('signal', 'exception', 'other'))
STAGES = frozenset(('launch_help', 'compile_probe', 'fixture_launch', 'replay_launch',
                    'identity', 'attach', 'continue', 'frames', 'cleanup'))
DEBUGGER_TIMEOUT = 50
COMMAND_TIMEOUT = 8
MAX_JSON_BYTES = 512_000
MAX_COMMAND_BYTES = 128_000
UINT64_LIMIT = 2**64
MODULE_NAME = re.compile(r'[A-Za-z0-9_][A-Za-z0-9_.+\-]{0,127}')
UUID_TEXT = re.compile(r'[0-9A-Fa-f]{8}(?:-[0-9A-Fa-f]{4}){3}-[0-9A-Fa-f]{12}')
FUNCTION_NAME = re.compile(r'[A-Za-z_$~+?\-][A-Za-z0-9_$~+\-.:(), <>\[\]*&|!?^%{}#@]*')
FIXTURE_SOURCE = '''#include <errno.h>
#include <unistd.h>
__attribute__((noinline)) void hither_lldb_probe(void) { __builtin_debugtrap(); }
int main(void) {
  char token;
  ssize_t count;
  do { count = read(STDIN_FILENO, &token, 1); } while (count == -1 && errno == EINTR);
  if (count == 0) return 2;
  if (count != 1) return 3;
  hither_lldb_probe();
  return 0;
}
'''


def eligible_failure(payload, build=None):
    """Only the original, OS-observed missing-report SIGTRAP is replayable."""
    if not isinstance(payload, dict):
        return False
    original_build = payload.get('build')
    return (payload.get('passed') is False
            and payload.get('bundleId') == BUNDLE
            and isinstance(original_build, str) and bool(original_build)
            and (build is None or (isinstance(build, str) and original_build == build))
            and type(payload.get('attempt')) is int and payload['attempt'] in (1, 2)
            and payload.get('processExitProbe') == 'observed'
            and payload.get('appExitKind') == 'signaled'
            and type(payload.get('appExitSignal')) is int and payload['appExitSignal'] == 5
            and payload.get('appProcessState') == 'absent'
            and payload.get('crashReportFound') is False)


def _safe_frame(payload):
    if not isinstance(payload, dict):
        return None
    module, image_uuid, offset = (payload.get(name) for name in ('module', 'uuid', 'imageOffset'))
    if (not isinstance(module, str) or not MODULE_NAME.fullmatch(module)
            or not isinstance(image_uuid, str) or not UUID_TEXT.fullmatch(image_uuid)
            or type(offset) is not int or not 0 <= offset < UINT64_LIMIT):
        return None
    result = {'module': module, 'uuid': str(uuid.UUID(image_uuid)).upper(), 'imageOffset': offset}
    function = payload.get('function')
    if (isinstance(function, str) and 0 < len(function) <= 240
            and FUNCTION_NAME.fullmatch(function)):
        result['function'] = function
    return result


def safe_result(payload):
    """Reconstruct the complete artifact allowlist; never copy arbitrary fields."""
    if (not isinstance(payload, dict) or payload.get('scope') != 'diagnostic_replay'
            or not isinstance(payload.get('probe'), str) or payload['probe'] not in PROBES):
        return {}
    result = {'scope': 'diagnostic_replay', 'probe': payload['probe']}
    stage = payload.get('stage')
    if isinstance(stage, str) and stage in STAGES:
        result['stage'] = stage
    if type(payload.get('cleanupFailed')) is bool:
        result['cleanupFailed'] = payload['cleanupFailed']
    release = payload.get('fixtureRelease')
    if isinstance(release, str) and release in ('sent', 'write_failed', 'not_observed'):
        result['fixtureRelease'] = release
    if payload['probe'] == 'exited':
        code = payload.get('lldbExitStatus')
        if type(code) is int and -1 <= code <= 255:
            result['lldbExitStatus'] = code
        if type(payload.get('sigtrapStopConfigured')) is bool:
            result['sigtrapStopConfigured'] = payload['sigtrapStopConfigured']
    if payload['probe'] != 'stopped':
        return result
    reason = payload.get('stopReason')
    if isinstance(reason, str) and reason in STOP_REASONS:
        result['stopReason'] = reason
    code = payload.get('signal')
    if reason == 'signal' and type(code) is int and 1 <= code <= 127:
        result['signal'] = code
    frames = payload.get('frames')
    if isinstance(frames, list):
        result['frames'] = [safe for value in frames[:16] if (safe := _safe_frame(value)) is not None]
    return result


def _result(probe, stage=None):
    return safe_result({'scope': 'diagnostic_replay', 'probe': probe, 'stage': stage})


class _IdentityMismatch(ValueError):
    pass


class _CommandFailure(RuntimeError):
    pass


class _CommandTimeout(RuntimeError):
    def __init__(self, stage=None):
        self.stage = stage
        super().__init__()


def _reserve_output(output):
    output = Path(output)
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    return output.resolve()


def _write_result(output, payload, name=RESULT_NAME):
    result = safe_result(payload) or _result('unavailable')
    temporary = Path(output) / ('.replay-result-' + str(os.getpid()) + '.pending')
    try:
        with temporary.open('x', encoding='utf-8') as stream:
            json.dump(result, stream, sort_keys=True)
            stream.write('\n')
        os.link(temporary, Path(output) / name)
    finally:
        temporary.unlink(missing_ok=True)
    return result


def _read_json(path):
    path = Path(path)
    if path.stat().st_size > MAX_JSON_BYTES:
        raise ValueError('Oversized JSON')
    return json.loads(path.read_text(encoding='utf-8'))


def _read_result(output, name=RESULT_NAME):
    try:
        return safe_result(_read_json(Path(output) / name)) or _result('unavailable')
    except (OSError, ValueError, UnicodeError):
        return _result('unavailable')


def _stop_group(process):
    """The group belongs to this command, never to a simulator App launch."""
    try:
        os.killpg(process.pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        process.wait(timeout=0.5)
    except subprocess.TimeoutExpired:
        pass
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    try:
        process.wait(timeout=1)
    except subprocess.TimeoutExpired:
        pass


def _run_command(argv, output, name, timeout=COMMAND_TIMEOUT, check=True):
    stdout_path, stderr_path = (Path(output) / (name + suffix) for suffix in ('.stdout.log', '.stderr.log'))
    with stdout_path.open('xb') as stdout, stderr_path.open('xb') as stderr:
        process = subprocess.Popen(tuple(map(str, argv)), stdin=subprocess.DEVNULL,
                                   stdout=stdout, stderr=stderr, start_new_session=True)
        try:
            process.wait(timeout=timeout)
        except subprocess.TimeoutExpired as error:
            _stop_group(process)
            raise _CommandTimeout() from error
        except BaseException:
            _stop_group(process)
            raise
    with stdout_path.open('rb') as stdout, stderr_path.open('rb') as stderr:
        captured = (stdout.read(MAX_COMMAND_BYTES + 1), stderr.read(MAX_COMMAND_BYTES + 1))
    if any(len(part) > MAX_COMMAND_BYTES for part in captured):
        raise _CommandFailure()
    result = subprocess.CompletedProcess(argv, process.returncode,
                                         *(part.decode('utf-8', errors='replace') for part in captured))
    if check and result.returncode:
        raise _CommandFailure()
    return result


def _is_darwin():
    return sys.platform == 'darwin'


def host_executable_path(pid):
    if not _is_darwin() or type(pid) is not int or pid <= 0:
        return None
    try:
        libproc = ctypes.CDLL('/usr/lib/libproc.dylib')
        libproc.proc_pidpath.argtypes = (ctypes.c_int, ctypes.c_void_p, ctypes.c_uint32)
        libproc.proc_pidpath.restype = ctypes.c_int
        buffer = ctypes.create_string_buffer(4096)
        if libproc.proc_pidpath(pid, buffer, len(buffer)) <= 0:
            return None
        return os.fsdecode(buffer.value)
    except (OSError, ValueError, AttributeError):
        return None


def _same_executable(pid, expected):
    actual = host_executable_path(pid)
    return actual is not None and Path(actual).resolve() == Path(expected).resolve()


class _OwnedAppProcess:
    """Only this returned, executable-checked PID can be cleaned up."""
    def __init__(self, pid, executable):
        self.pid, self.executable, self.queue = pid, Path(executable), None
        self.closed = False
        if not _same_executable(pid, executable):
            raise _IdentityMismatch()
        if _is_darwin() and hasattr(select, 'kqueue'):
            try:
                self.queue = select.kqueue()
                event = select.kevent(pid, filter=select.KQ_FILTER_PROC,
                                      flags=select.KQ_EV_ADD | select.KQ_EV_ONESHOT,
                                      fflags=select.KQ_NOTE_EXIT)
                self.queue.control([event], 0, 0)
            except BaseException:
                self.close()
                raise
        if not _same_executable(pid, executable):
            self.close()
            raise _IdentityMismatch()

    def close(self):
        if self.closed:
            return
        self.closed = True
        try:
            try:
                exited = self.queue is not None and bool(self.queue.control(None, 1, 0))
            except OSError:
                exited = False
            if not exited and _same_executable(self.pid, self.executable):
                os.kill(self.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        finally:
            if self.queue is not None:
                self.queue.close()
                self.queue = None


def _executable_digest(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        while data := stream.read(1024 * 1024):
            digest.update(data)
    return digest.digest()


def _app_identity(app, build):
    app = Path(app).resolve()
    with (app / 'Info.plist').open('rb') as stream:
        info = plistlib.load(stream)
    executable = info.get('CFBundleExecutable') if isinstance(info, dict) else None
    if (not isinstance(info, dict) or info.get('CFBundleIdentifier') != BUNDLE
            or type(info.get('CFBundleVersion')) is not str or info['CFBundleVersion'] != build
            or info.get('CFBundleSupportedPlatforms') != ['iPhoneSimulator']
            or not isinstance(executable, str) or not MODULE_NAME.fullmatch(executable)
            or not (app / executable).is_file()):
        raise _IdentityMismatch()
    path = (app / executable).resolve()
    if path.parent != app:
        raise _IdentityMismatch()
    return executable, path, _executable_digest(path)


def _installed_executable(app, simulator, build, output):
    name, compiled, digest = _app_identity(app, build)
    result = _run_command(('xcrun', 'simctl', 'get_app_container', simulator, BUNDLE, 'app'),
                          output, 'app-container')
    container = result.stdout.strip()
    if not container or '\n' in container or not Path(container).is_absolute():
        raise _IdentityMismatch()
    installed_name, installed, installed_digest = _app_identity(container, build)
    if installed_name != name or installed_digest != digest:
        raise _IdentityMismatch()
    processes = _run_command(('pgrep', '-x', name), output, 'existing-processes', check=False)
    if processes.returncode == 1 and not processes.stdout.strip():
        return installed, compiled
    if processes.returncode:
        raise _CommandFailure()
    candidates = processes.stdout.splitlines()
    if not 0 < len(candidates) <= 32:
        raise _CommandFailure()
    for value in candidates:
        if not re.fullmatch(r'[1-9][0-9]{0,9}', value):
            raise _CommandFailure()
        path = host_executable_path(int(value))
        if path is None:
            raise _CommandFailure()
        if Path(path).resolve() == installed:
            raise _IdentityMismatch()
    return installed, compiled


def _frame_from_lldb(frame, target, lldb):
    if not isinstance(frame, lldb.SBFrame) or not frame.IsValid():
        return None
    module = frame.GetModule()
    if not module.IsValid():
        return None
    pc = frame.GetPCAddress().GetLoadAddress(target)
    base = module.GetObjectFileHeaderAddress().GetLoadAddress(target)
    if (pc == lldb.LLDB_INVALID_ADDRESS or base == lldb.LLDB_INVALID_ADDRESS
            or not 0 <= base <= pc < UINT64_LIMIT):
        return None
    return _safe_frame({'module': module.GetFileSpec().GetFilename(),
                        'uuid': module.GetUUIDString(), 'imageOffset': pc - base,
                        'function': frame.GetFunctionName()})


def _stopped_result(process, target, lldb):
    thread = process.GetSelectedThread()
    for index in range(min(process.GetNumThreads(), 256)):
        candidate = process.GetThreadAtIndex(index)
        if (isinstance(candidate, lldb.SBThread) and candidate.IsValid()
                and candidate.GetStopReason() in (lldb.eStopReasonSignal, lldb.eStopReasonException)):
            thread = candidate
            break
    if not isinstance(thread, lldb.SBThread) or not thread.IsValid():
        return _result('unavailable')
    reason = {lldb.eStopReasonSignal: 'signal', lldb.eStopReasonException: 'exception'}.get(
        thread.GetStopReason(), 'other')
    result = dict(_result('stopped'), stopReason=reason, frames=[])
    if reason == 'signal' and thread.GetStopReasonDataCount():
        result['signal'] = thread.GetStopReasonDataAtIndex(0)
    for index in range(min(thread.GetNumFrames(), 16)):
        frame = _frame_from_lldb(thread.GetFrameAtIndex(index), target, lldb)
        if frame is not None:
            result['frames'].append(frame)
    return safe_result(result)


def lldb_capture(debugger, pid, executable, output, symbol_executable=None):
    """Runs inside selected-Xcode LLDB's embedded Python, never host Python."""
    import lldb

    process = None
    owned = False
    stage = 'identity'
    result = _result('unavailable', stage)
    try:
        if not _same_executable(pid, executable):
            raise _IdentityMismatch()
        if symbol_executable is not None:
            if _executable_digest(symbol_executable) != _executable_digest(executable):
                raise _IdentityMismatch()
        stage = 'attach'
        debugger.SetAsync(False)
        target = debugger.CreateTarget(str(symbol_executable or executable))
        if not isinstance(target, lldb.SBTarget) or not target.IsValid():
            raise _CommandFailure()
        error = lldb.SBError()
        process = target.AttachToProcessWithID(debugger.GetListener(), pid, error)
        if (error.Fail() or not isinstance(process, lldb.SBProcess)
                or not process.IsValid()):
            raise _CommandFailure()
        stage = 'identity'
        if process.GetProcessID() != pid or not _same_executable(pid, executable):
            raise _IdentityMismatch()
        owned = True
        signals = process.GetUnixSignals()
        stop_configured = False
        if signals.IsValid():
            stop_configured = signals.SetShouldStop(5, True)
        (Path(output) / 'attached.ready').touch(exist_ok=False)
        stage = 'continue'
        error = process.Continue()
        if error.Fail():
            raise _CommandFailure()
        state = process.GetState()
        if state in (lldb.eStateStopped, lldb.eStateCrashed):
            stage = 'frames'
            result = _stopped_result(process, target, lldb)
        elif state == lldb.eStateExited:
            result = dict(_result('exited'), lldbExitStatus=process.GetExitStatus(),
                          sigtrapStopConfigured=stop_configured)
    except _IdentityMismatch:
        result = _result('identity_mismatch')
    except Exception:
        result = _result('unavailable')
    finally:
        result['stage'] = stage
        cleanup_failed = False
        try:
            if process is not None and process.IsValid() and process.GetState() != lldb.eStateExited:
                if owned and _same_executable(pid, executable):
                    error = process.Kill()
                else:
                    error = process.Detach(True)
                if error.Fail():
                    cleanup_failed = True
        except Exception:
            cleanup_failed = True
        if result.get('probe') == 'stopped':
            # Cleanup trouble must not discard the only captured static stack.
            result['cleanupFailed'] = cleanup_failed
        elif cleanup_failed:
            result = _result('unavailable', 'cleanup')
        _write_result(output, result, CAPTURE_RESULT_NAME)


def _run_lldb(pid, executable, output, attached=None, symbol_executable=None):
    module_path = str(Path(__file__).resolve())
    symbols = str(symbol_executable) if symbol_executable is not None else None
    code = ('import importlib.util, lldb; '
            f'_s = importlib.util.spec_from_file_location("hither_launch_debugger_capture", {module_path!r}); '
            '_m = importlib.util.module_from_spec(_s); _s.loader.exec_module(_m); '
            f'_m.lldb_capture(lldb.debugger, {pid!r}, {str(executable)!r}, {str(output)!r}, '
            f'{symbols!r})')
    argv = ('xcrun', 'lldb', '--no-lldbinit', '--batch', '--source-quietly', '-o', 'script ' + code)
    with (Path(output) / 'lldb.stdout.log').open('xb') as stdout, (Path(output) / 'lldb.stderr.log').open('xb') as stderr:
        process = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr,
                                   start_new_session=True)
        deadline = time.monotonic() + DEBUGGER_TIMEOUT
        cleanup_failed = False
        try:
            while process.poll() is None:
                if attached is not None and (Path(output) / 'attached.ready').is_file():
                    callback, attached = attached, None
                    callback()
                if time.monotonic() >= deadline:
                    raise _CommandTimeout('continue' if (Path(output) / 'attached.ready').is_file() else 'attach')
                time.sleep(0.05)
        finally:
            try:
                _stop_group(process)
            except OSError:
                cleanup_failed = True
    result = _read_result(output, CAPTURE_RESULT_NAME)
    if cleanup_failed:
        result['cleanupFailed'] = True
    if 'stage' not in result:
        result['stage'] = 'continue' if (Path(output) / 'attached.ready').is_file() else 'attach'
    return result


def check(output):
    """Prove selected tools can collect a real named trap frame before App build."""
    output = _reserve_output(output)
    fixture = None
    stage = 'launch_help'
    result = _result('unavailable', stage)
    released = 'not_observed'
    try:
        if not _is_darwin():
            raise _CommandFailure()
        help_result = _run_command(('xcrun', 'simctl', 'help', 'launch'), output, 'launch-help')
        help_text = help_result.stdout + '\n' + help_result.stderr
        for option in ('--wait-for-debugger', '--stdout', '--stderr'):
            if not re.search(r'(?<![\w-])' + re.escape(option) + r'(?=[=\s,\]|/]|$)', help_text):
                raise _CommandFailure()
        source, executable = output / 'hither_lldb_probe.c', output / 'hither_lldb_probe'
        source.write_text(FIXTURE_SOURCE, encoding='utf-8')
        stage = 'compile_probe'
        _run_command(('xcrun', '--sdk', 'macosx', 'clang', '-g', '-O0', str(source), '-o', str(executable)),
                     output, 'compile-probe', timeout=20)
        with (output / 'probe.stdout.log').open('xb') as stdout, (output / 'probe.stderr.log').open('xb') as stderr:
            stage = 'fixture_launch'
            fixture = subprocess.Popen((str(executable),), stdin=subprocess.PIPE,
                                       stdout=stdout, stderr=stderr, start_new_session=True)
            stage = 'identity'
            if not _same_executable(fixture.pid, executable):
                raise _IdentityMismatch()

            def release():
                nonlocal released
                try:
                    fixture.stdin.write(b'x')
                    fixture.stdin.flush()
                    fixture.stdin.close()
                    released = 'sent'
                except OSError:
                    released = 'write_failed'

            result = _run_lldb(fixture.pid, executable, output, attached=release)
    except _CommandTimeout as error:
        result = _result('timeout', error.stage or stage)
    except _IdentityMismatch:
        result = _result('identity_mismatch', stage)
    except (OSError, ValueError, _CommandFailure):
        result = _result('unavailable', stage)
    finally:
        if fixture is not None:
            try:
                if fixture.stdin is not None and not fixture.stdin.closed:
                    fixture.stdin.close()
            except OSError:
                released = 'write_failed'
            finally:
                try:
                    _stop_group(fixture)
                except OSError:
                    result['cleanupFailed'] = True
        result['fixtureRelease'] = released
    return _write_result(output, result)


def replay(app, simulator, build, original_result, output):
    """Attempt exactly one same-installed-binary replay, preserving the gate JSON."""
    output = _reserve_output(output)
    owned = None
    executable = None
    stage = 'identity'
    result = _result('unavailable', stage)
    try:
        original = _read_json(original_result)
        if not eligible_failure(original, build):
            return _write_result(output, _result('not_eligible'))
        if not _is_darwin():
            return _write_result(output, result)
        if not isinstance(simulator, str) or not UUID_TEXT.fullmatch(simulator):
            raise _IdentityMismatch()
        executable, symbol_executable = _installed_executable(app, simulator, build, output)
        console = [output / ('console.' + name + '.log') for name in ('stdout', 'stderr')]
        for path in console:
            path.touch(exist_ok=False)
        stage = 'replay_launch'
        launched = _run_command(('xcrun', 'simctl', 'launch', '--wait-for-debugger',
                                '--stdout=' + str(console[0]), '--stderr=' + str(console[1]),
                                simulator, BUNDLE), output, 'launch', timeout=15)
        pid = _launch_pid(launched.stdout)
        if pid is None:
            raise _CommandFailure()
        stage = 'identity'
        owned = _OwnedAppProcess(pid, executable)
        result = _run_lldb(pid, executable, output, symbol_executable=symbol_executable)
    except _CommandTimeout as error:
        result = _result('timeout', error.stage or stage)
    except _IdentityMismatch:
        result = _result('identity_mismatch', stage)
    except (OSError, ValueError, _CommandFailure):
        result = _result('unavailable', stage)
    finally:
        if owned is not None:
            try:
                owned.close()
            except OSError:
                result['cleanupFailed'] = True
        elif executable is not None:
            # A launch command can print its PID and then time out. Its exact
            # returned PID remains the only cleanup candidate in that case.
            try:
                with (output / 'launch.stdout.log').open('rb') as stream:
                    contents = stream.read(MAX_COMMAND_BYTES + 1)
                if len(contents) <= MAX_COMMAND_BYTES:
                    pid = _launch_pid(contents.decode('utf-8'))
                    if pid is not None and _same_executable(pid, executable):
                        _OwnedAppProcess(pid, executable).close()
            except (OSError, ValueError):
                pass
    return _write_result(output, result)


def _launch_pid(contents):
    match = re.fullmatch(re.escape(BUNDLE) + r': ([1-9][0-9]{0,9})\s*', contents)
    return int(match.group(1)) if match is not None else None


def _fixture_captured(result):
    return (result.get('probe') == 'stopped'
            and result.get('cleanupFailed') is False
            and result.get('fixtureRelease') == 'sent'
            and (result.get('stopReason') == 'exception'
                 or (result.get('stopReason') == 'signal' and result.get('signal') == 5))
            and any(frame.get('function') == 'hither_lldb_probe' for frame in result.get('frames', [])))


def _interrupt(signum, frame):
    raise InterruptedError()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    check_parser = commands.add_parser('check')
    check_parser.add_argument('--output', required=True, type=Path)
    replay_parser = commands.add_parser('replay')
    replay_parser.add_argument('--app', required=True, type=Path)
    replay_parser.add_argument('--simulator', required=True)
    replay_parser.add_argument('--build', required=True)
    replay_parser.add_argument('--original-result', required=True, type=Path)
    replay_parser.add_argument('--output', required=True, type=Path)
    options = parser.parse_args(argv)
    try:
        if options.command == 'check':
            return 0 if _fixture_captured(check(options.output)) else 1
        result = replay(options.app, options.simulator, options.build,
                        options.original_result, options.output)
        return 0 if (result.get('probe') in ('stopped', 'exited')
                     and result.get('cleanupFailed') is not True) else 1
    except (OSError, ValueError):
        return 1


if __name__ == '__main__':
    signal.signal(signal.SIGTERM, _interrupt)
    sys.exit(main())
