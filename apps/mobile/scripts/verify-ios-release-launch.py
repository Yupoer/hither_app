#!/usr/bin/env python3
"""Verify a Release simulator app survives two cold starts and mounts its JS root.

No uninstall or simulator erase: this also exercises upgrades over existing data.
Screenshots still require review; simulator success does not certify a device IPA.
"""
import argparse
import ctypes
from datetime import datetime
import json
import math
import os
from pathlib import Path
import plistlib
import re
import select
import subprocess
import sys
import time


class CommandFailure(RuntimeError):
    def __init__(self, args, result):
        self.returncode = result.returncode
        super().__init__(' '.join(args) + '\n' + result.stdout + result.stderr)


def crash_report_summary(report, pid, executable, bundle):
    if (not isinstance(report, dict) or report.get('pid') != pid
            or report.get('procName') != executable):
        return None
    bundle_info = report.get('bundleInfo', {})
    if isinstance(bundle_info, dict) and bundle_info.get('CFBundleIdentifier') not in (None, bundle):
        return None
    summary = {'crashReportFound': True}
    exception = report.get('exception', {})
    if isinstance(exception, dict):
        kind = exception.get('type')
        if isinstance(kind, str) and re.fullmatch(r'EXC_[A-Z_]{1,32}', kind):
            summary['exceptionType'] = kind
        signal = exception.get('signal')
        if isinstance(signal, str):
            signal = re.match(r'SIG[A-Z0-9]{1,16}', signal)
            if signal:
                summary['exceptionSignal'] = signal.group()
    termination = report.get('termination', {})
    if isinstance(termination, dict):
        namespace = termination.get('namespace')
        if isinstance(namespace, str) and re.fullmatch(r'[A-Z][A-Z0-9_]{0,31}', namespace):
            summary['terminationNamespace'] = namespace
        code = termination.get('code')
        if type(code) is int and 0 <= code < 2**64:
            summary['terminationCode'] = code
    images = report.get('usedImages', [])
    if not isinstance(images, list):
        images = []

    def frame_modules(frames):
        if not isinstance(frames, list):
            return []
        modules = []
        for frame in frames[:8]:
            if not isinstance(frame, dict):
                continue
            image_index = frame.get('imageIndex')
            if type(image_index) is not int or not 0 <= image_index < len(images):
                continue
            image = images[image_index]
            if not isinstance(image, dict):
                continue
            name = image.get('name') or image.get('path')
            if isinstance(name, str):
                name = Path(name).name
                if re.fullmatch(r'[A-Za-z][A-Za-z0-9_.+-]{0,63}', name):
                    modules.append(name)
        return modules

    def frame_evidence(frames):
        if not isinstance(frames, list):
            return []
        evidence = []
        for frame in frames[:16]:
            if not isinstance(frame, dict):
                continue
            index, offset = frame.get('imageIndex'), frame.get('imageOffset')
            if (type(index) is not int or not 0 <= index < len(images)
                    or type(offset) is not int or not 0 <= offset < 2**64):
                continue
            image = images[index]
            if not isinstance(image, dict):
                continue
            name, identifier = image.get('name') or image.get('path'), image.get('uuid')
            if (not isinstance(name, str) or not isinstance(identifier, str)
                    or len(identifier) > 128):
                continue
            item = {'module': Path(name).name, 'uuid': identifier, 'imageOffset': offset}
            symbol = frame.get('symbol')
            if isinstance(symbol, str) and len(symbol) <= 240:
                item['function'] = symbol
            evidence.append(item)
        return evidence

    threads = report.get('threads', [])
    index = report.get('faultingThread')
    if (type(index) is int and isinstance(threads, list)
            and 0 <= index < len(threads) and isinstance(threads[index], dict)):
        modules = frame_modules(threads[index].get('frames'))
        if modules:
            summary['faultingModule'] = modules[0]
            summary['faultingModules'] = modules
        frames = frame_evidence(threads[index].get('frames'))
        if frames:
            summary['crashFrames'] = frames
    modules = frame_modules(report.get('lastExceptionBacktrace'))
    if modules:
        summary['lastExceptionModules'] = modules
    return summary


def find_crash_report(pid, executable, bundle, simulator, started):
    home = Path.home()
    directories = (home / 'Library/Logs/DiagnosticReports',
                   home / 'Library/Developer/CoreSimulator/Devices' / simulator
                   / 'data/Library/Logs/CrashReporter')
    for directory in directories:
        for path in directory.glob(executable + '*.ips'):
            try:
                if path.stat().st_mtime < started - 1 or path.stat().st_size > 8_000_000:
                    continue
                with path.open(encoding='utf-8') as stream:
                    metadata = json.loads(stream.readline())
                    if metadata.get('bug_type') != '309':
                        continue
                    report = json.load(stream)
                summary = crash_report_summary(report, pid, executable, bundle)
                if summary:
                    return summary
            except (OSError, ValueError, UnicodeError, AttributeError):
                continue
    return None


def runtime_log_signals(contents):
    text = contents.casefold()
    patterns = {'dyld_failure': 'library not loaded',
                'uncaught_exception': 'uncaught exception',
                'fatal_error': 'fatal error',
                'assertion_failure': 'assertion failure'}
    return sorted(name for name, pattern in patterns.items() if pattern in text)


def system_termination_signals(contents):
    text = contents.casefold()
    patterns = {'jetsam': ('jetsam', 'memorystatus'),
                'watchdog': ('watchdog', '0x8badf00d'),
                'codesigning': ('code signature', 'codesigning'),
                'process_exit': ('exit status', 'exit code', 'termination reason',
                                 'process exited', 'termination reported by launchd')}
    return sorted(name for name, terms in patterns.items()
                  if any(term in text for term in terms))


def targets_app_termination(message, bundle, target_pid):
    if type(target_pid) is not int or target_pid <= 0:
        return False
    text = message.lstrip()
    lower = text.casefold()
    on_target = re.search(r'\bon\s+<RBSProcess', text, re.IGNORECASE)
    if on_target and 'received termination request' in lower[:128]:
        target = re.match(r'\s+application<([A-Za-z0-9.-]+)>:([0-9]+)>',
                          text[on_target.end():], re.IGNORECASE)
    elif lower.startswith('process exited:'):
        target = re.match(r'^process exited:\s*<FBApplicationProcess:\s+'
                          r'application<([A-Za-z0-9.-]+)>:([0-9]+)>',
                          text, re.IGNORECASE)
    else:
        target = re.match(r'^\[application<([A-Za-z0-9.-]+)>:([0-9]+)\]\s+'
                          r'(?:received termination request|termination reported by launchd)\b',
                          text, re.IGNORECASE)
    app_refs = re.findall(r'application<([A-Za-z0-9.-]+)>:([0-9]+)', text,
                          re.IGNORECASE)
    return (target is not None and len(app_refs) == 1
            and target.group(1).casefold() == bundle.casefold()
            and int(target.group(2)) == target_pid)


def probe_system_termination(simulator, bundle, started, ended, target_pid):
    if (not isinstance(bundle, str) or not re.fullmatch(r'[A-Za-z0-9.-]+', bundle)
            or not all(type(value) in (int, float) and math.isfinite(value)
                       for value in (started, ended))
            or not 0 <= ended - started <= 120):
        return {'systemLogProbe': 'unavailable'}
    predicate = ('(process == "runningboardd" OR process == "SpringBoard") '
                 'AND eventMessage CONTAINS[c] "' + bundle + '"')
    try:
        since = datetime.fromtimestamp(started).astimezone().strftime('%Y-%m-%d %H:%M:%S')
        window_end = min(ended + 1, started + 120)
        until = datetime.fromtimestamp(math.ceil(window_end)).astimezone().strftime('%Y-%m-%d %H:%M:%S')
        result = subprocess.run(('xcrun', 'simctl', 'spawn', simulator, 'log', 'show',
                                 '--style', 'ndjson', '--start', since, '--end', until,
                                 '--predicate', predicate), capture_output=True,
                                text=True, timeout=15)
        if result.returncode:
            return {'systemLogProbe': 'unavailable'}
        bundle_pattern = re.compile(r'(?<![A-Za-z0-9_.-])' + re.escape(bundle)
                                    + r'(?![A-Za-z0-9_.-])', re.IGNORECASE)
        contextual = set()
        correlated = set()
        for line in result.stdout.splitlines():
            if not line.strip():
                continue
            record = json.loads(line)
            if not isinstance(record, dict):
                return {'systemLogProbe': 'unavailable'}
            if 'finished' in record:
                continue
            message = record.get('eventMessage')
            timestamp = record.get('timestamp')
            if not isinstance(message, str) or not isinstance(timestamp, str):
                return {'systemLogProbe': 'unavailable'}
            observed = datetime.fromisoformat(timestamp.replace('Z', '+00:00'))
            if observed.tzinfo is None:
                return {'systemLogProbe': 'unavailable'}
            if not started <= observed.timestamp() <= window_end or not bundle_pattern.search(message):
                continue
            signals = system_termination_signals(message)
            contextual.update(signals)
            # processID is the logger PID. Require the App's bundle and PID in
            # a known termination-subject position within the same message.
            if targets_app_termination(message, bundle, target_pid):
                correlated.update(signals)
        return {'systemLogProbe': 'available',
                'systemTerminationSignals': sorted(contextual),
                'pidCorrelatedSystemSignals': sorted(correlated),
                'systemLogWindowSeconds': math.ceil(window_end - started)}
    except (OSError, ValueError, TypeError, OverflowError, UnicodeError,
            subprocess.TimeoutExpired):
        return {'systemLogProbe': 'unavailable'}


def probe_simulator_state(simulator):
    try:
        result = run('xcrun', 'simctl', 'list', 'devices', '--json',
                     check=False, timeout=10)
        if result.returncode:
            return 'unavailable'
        devices = json.loads(result.stdout)['devices']
        matches = [device.get('state') for group in devices.values() for device in group
                   if device.get('udid') == simulator]
        if len(matches) != 1:
            return 'unavailable'
        return {'Booted': 'booted', 'Shutdown': 'shutdown'}.get(matches[0], 'other')
    except (OSError, ValueError, KeyError, TypeError, AttributeError,
            subprocess.TimeoutExpired):
        return 'unavailable'


def host_executable_path(pid):
    if sys.platform != 'darwin':
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


class ProcessExitObserver:
    # Darwin event.h flags are not all exported by Python's select module.
    EXIT_STATUS = 0x04000000
    EXIT_DETAIL = 0x02000000

    def __init__(self, pid, executable):
        self.queue = None
        self.pid = pid
        self.observation = {'processExitProbe': 'unavailable'}
        if sys.platform != 'darwin':
            return
        try:
            expected = executable.resolve()
            path = host_executable_path(pid)
            if path is None or Path(path).resolve() != expected:
                return
            self.queue = select.kqueue()
            event = select.kevent(pid, filter=select.KQ_FILTER_PROC,
                                  flags=select.KQ_EV_ADD | select.KQ_EV_ONESHOT,
                                  fflags=select.KQ_NOTE_EXIT | self.EXIT_STATUS | self.EXIT_DETAIL)
            self.queue.control([event], 0, 0)
            path = host_executable_path(pid)
            if path is None or Path(path).resolve() != expected:
                self.close()
                return
            self.observation = {'processExitProbe': 'not_observed'}
        except (OSError, ValueError, AttributeError):
            self.close()

    def poll(self, stage=None):
        if self.queue is None or self.observation['processExitProbe'] != 'not_observed':
            return dict(self.observation)
        try:
            for event in self.queue.control(None, 1, 0):
                if (event.ident != self.pid or event.filter != select.KQ_FILTER_PROC
                        or event.flags & select.KQ_EV_ERROR
                        or not event.fflags & select.KQ_NOTE_EXIT):
                    raise ValueError('unexpected process observation')
                self.observation = {'processExitProbe': 'observed', 'appExitKind': 'unknown'}
                if stage in {'launch_observation', 'failure_collection'}:
                    self.observation['appExitObservedDuring'] = stage
                if type(event.data) is int and event.fflags & self.EXIT_STATUS:
                    status = event.data & 0xffff
                    if os.WIFEXITED(status):
                        self.observation.update(appExitKind='exited', appExitCode=os.WEXITSTATUS(status))
                    elif os.WIFSIGNALED(status):
                        self.observation.update(appExitKind='signaled', appExitSignal=os.WTERMSIG(status))
                if type(event.data) is int and event.fflags & self.EXIT_DETAIL:
                    self.observation['appExitDetails'] = [
                        name for flag, name in ((0x10000, 'decryption'), (0x20000, 'memory'),
                                                (0x40000, 'code_signing')) if event.data & flag]
        except (OSError, ValueError, AttributeError):
            self.observation = {'processExitProbe': 'unavailable'}
        return dict(self.observation)

    def close(self):
        if self.queue is not None:
            queue = self.queue
            self.queue = None
            try:
                queue.close()
            except OSError:
                pass


def check_exit_observer():
    executable = host_executable_path(os.getpid())
    if executable is None:
        raise RuntimeError('Running interpreter executable is unavailable')
    for code, expected in ((37, {'appExitKind': 'exited', 'appExitCode': 37}),
                           (-15, {'appExitKind': 'signaled', 'appExitSignal': 15})):
        child = subprocess.Popen((executable, '-c',
                                  'import os,sys; sys.stdin.buffer.read(1); '
                                  + ('sys.exit(37)' if code > 0 else 'os.kill(os.getpid(),15)')),
                                 stdin=subprocess.PIPE, stdout=subprocess.DEVNULL,
                                 stderr=subprocess.DEVNULL)
        observer = ProcessExitObserver(child.pid, Path(executable))
        try:
            if observer.poll()['processExitProbe'] == 'unavailable':
                raise RuntimeError('Native exit observer is unavailable')
            child.stdin.write(b'x')
            child.stdin.flush()
            child.wait(timeout=5)
            result = observer.poll()
            if (result.get('processExitProbe') != 'observed'
                    or any(result.get(key) != value for key, value in expected.items())):
                raise RuntimeError('Native exit observer self-check failed')
        finally:
            observer.close()
            if child.poll() is None:
                child.kill()
                child.wait(timeout=5)
            child.stdin.close()
    print('PASS native exit observer self-check', flush=True)


def probe_console(paths):
    try:
        chunks = []
        truncated = False
        for path in paths:
            with path.open('rb') as stream:
                chunk = stream.read(1_000_001)
            truncated |= len(chunk) > 1_000_000
            chunks.append(chunk[:1_000_000].decode('utf-8', errors='replace'))
        return {'consoleProbe': 'available', 'consoleSignals': runtime_log_signals('\n'.join(chunks)),
                'consoleTruncated': truncated}
    except OSError:
        return {'consoleProbe': 'unavailable'}


def probe_app_process_state(simulator, bundle, executable, launched_pid):
    try:
        container = run('xcrun', 'simctl', 'get_app_container', simulator, bundle,
                        'app', check=False, timeout=10)
        if container.returncode or not Path(container.stdout.strip()).is_absolute():
            return 'unavailable'
        expected = (Path(container.stdout.strip()) / executable).resolve()
        candidates = run('pgrep', '-x', executable, check=False, timeout=10)
        if candidates.returncode == 1:
            return 'absent'
        if candidates.returncode:
            return 'unavailable'
        pids = [int(line) for line in candidates.stdout.splitlines()]
        if not pids or len(pids) > 32 or any(pid <= 0 for pid in pids):
            return 'unavailable'
        matches = set()
        unknown = False
        for pid in pids:
            path = host_executable_path(pid)
            if path is None:
                unknown = True
            elif Path(path).resolve() == expected:
                matches.add(pid)
        if launched_pid in matches:
            return 'original_pid'
        if matches:
            return 'replacement_pid'
        return 'unavailable' if unknown else 'absent'
    except (OSError, ValueError, TypeError, AttributeError,
            subprocess.TimeoutExpired):
        return 'unavailable'


def run(*args, check=True, timeout=None):
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    if check and result.returncode:
        raise CommandFailure(args, result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app', required=True, type=Path)
    parser.add_argument('--simulator', required=True)
    parser.add_argument('--build', required=True)
    parser.add_argument('--output', required=True, type=Path)
    options = parser.parse_args()
    with (options.app / 'Info.plist').open('rb') as handle:
        info = plistlib.load(handle)
    bundle = info['CFBundleIdentifier']
    assert info['CFBundleVersion'] == options.build, 'Wrong build number'
    assert info['CFBundleSupportedPlatforms'] == ['iPhoneSimulator'], 'Simulator app required'
    assert not list(options.app.glob('*.debug.dylib')), 'Debug app is not a Release launch check'
    options.output.mkdir(parents=True, exist_ok=True)
    evidence = {'bundleId': bundle, 'build': options.build, 'launches': []}
    stage = 'install'
    attempt = None
    pid = None
    phase = None
    started = None
    observer = None
    console_paths = []
    try:
        run('xcrun', 'simctl', 'install', options.simulator, str(options.app))
        stage = 'app_container'
        installed = run('xcrun', 'simctl', 'get_app_container', options.simulator, bundle, 'app').stdout.strip()
        executable = Path(installed) / info['CFBundleExecutable']
        for attempt in range(1, 3):
            stage = 'launch'
            pid = None
            phase = None
            run('xcrun', 'simctl', 'terminate', options.simulator, bundle, check=False)
            console_paths = [options.output.resolve() / f'cold-start-{attempt}.{name}.log'
                             for name in ('stdout', 'stderr')]
            for path in console_paths:
                path.write_bytes(b'')
            started = time.time()
            stage = 'launch'
            launched = run('xcrun', 'simctl', 'launch', '--stdout=' + str(console_paths[0]),
                           '--stderr=' + str(console_paths[1]), options.simulator, bundle)
            pid = int(launched.stdout.strip().rsplit(': ', 1)[1])
            observer = ProcessExitObserver(pid, executable)
            try:
                os.kill(pid, 0)
                evidence['hostPidAliveAtLaunch'] = True
            except ProcessLookupError:
                evidence['hostPidAliveAtLaunch'] = False
                raise
            stage = 'app_container'
            container = run('xcrun', 'simctl', 'get_app_container', options.simulator, bundle, 'data').stdout.strip()
            preferences = Path(container) / 'Library/Preferences' / (bundle + '.plist')
            stage = 'startup_breadcrumb'
            record = {}
            # A fresh timestamp prevents an earlier successful launch passing this run.
            while time.time() - started < 45:
                evidence.update(observer.poll('launch_observation'))
                if evidence.get('processExitProbe') == 'observed':
                    raise ProcessLookupError('App exited during cold-launch observation')
                os.kill(pid, 0)
                try:
                    with preferences.open('rb') as handle:
                        record = plistlib.load(handle)
                    if record.get('hither.launch.recordedAt.v1', 0) >= started * 1000:
                        phase = record.get('hither.launch.phase.v1')
                except (FileNotFoundError, plistlib.InvalidFileException):
                    pass
                time.sleep(1)
            evidence.update(observer.poll('launch_observation'))
            if evidence.get('processExitProbe') == 'observed':
                raise ProcessLookupError('App exited during cold-launch observation')
            os.kill(pid, 0)
            assert phase in {'session_resolved', 'navigation_ready', 'stable'}, 'JS startup incomplete: ' + str(phase)
            assert record.get('hither.launch.build.v1') == options.build, 'Wrong launch breadcrumb build'
            screenshot = options.output / ('cold-start-' + str(attempt) + '.png')
            stage = 'screenshot'
            run('xcrun', 'simctl', 'io', options.simulator, 'screenshot', str(screenshot))
            evidence['launches'].append({'pid': pid, 'phase': phase, 'screenshot': str(screenshot)})
            observer.close()
            observer = None
            print('PASS cold start', attempt, phase, flush=True)
        evidence['passed'] = True
    except Exception as error:
        failed_at = time.time()
        if observer is not None:
            evidence.update(observer.poll('failure_collection'))
        evidence['passed'] = False
        evidence['failureStage'] = stage
        evidence['failureType'] = type(error).__name__
        if attempt is not None:
            evidence['attempt'] = attempt
        evidence['appProcessState'] = 'unavailable'
        if pid is not None:
            try:
                os.kill(pid, 0)
                evidence['processAlive'] = True
            except ProcessLookupError:
                evidence['processAlive'] = False
            except OSError:
                pass
            try:
                evidence['appProcessState'] = probe_app_process_state(
                    options.simulator, bundle, info['CFBundleExecutable'], pid)
            except Exception:
                evidence['appProcessState'] = 'unavailable'
        try:
            evidence['simulatorState'] = probe_simulator_state(options.simulator)
        except Exception:
            evidence['simulatorState'] = 'unavailable'
        if phase is not None:
            evidence['lastObservedPhase'] = phase if phase in {
                'session_resolved', 'navigation_ready', 'stable'} else 'other'
        if isinstance(error, CommandFailure):
            evidence['simctlExitCode'] = error.returncode
        if (pid is not None and (evidence.get('processAlive') is False
                                or evidence.get('appProcessState') in {'absent', 'replacement_pid'})):
            try:
                for _ in range(10):
                    report = find_crash_report(pid, info['CFBundleExecutable'], bundle,
                                               options.simulator, started)
                    if report:
                        evidence.update(report)
                        break
                    time.sleep(1)
                else:
                    evidence['crashReportFound'] = False
            except Exception:
                evidence['crashReportProbe'] = 'unavailable'
        try:
            evidence.update(probe_system_termination(
                options.simulator, bundle, started, failed_at, pid))
        except Exception:
            evidence['systemLogProbe'] = 'unavailable'
        raise
    finally:
        if observer is not None:
            evidence.update(observer.poll('failure_collection'))
            observer.close()
        if console_paths:
            evidence.update(probe_console(console_paths))
        try:
            logs = run('xcrun', 'simctl', 'spawn', options.simulator, 'log', 'show',
                       '--style', 'compact', '--last', '3m', '--predicate',
                       'process == "' + info['CFBundleExecutable'] + '"',
                       check=False, timeout=15)
            if logs.returncode == 0:
                evidence['runtimeLogProbe'] = 'available'
                (options.output / 'native-launch.log').write_text(logs.stdout + logs.stderr)
                if evidence.get('passed') is False:
                    evidence['runtimeLogSignals'] = runtime_log_signals(logs.stdout + logs.stderr)
            else:
                evidence['runtimeLogProbe'] = 'unavailable'
        except (OSError, UnicodeError, subprocess.TimeoutExpired):
            evidence['runtimeLogProbe'] = 'unavailable'
        (options.output / 'launch-result.json').write_text(json.dumps(evidence, indent=2) + '\n')


if __name__ == '__main__':
    if sys.argv[1:] == ['--check-exit-observer']:
        check_exit_observer()
    else:
        main()
