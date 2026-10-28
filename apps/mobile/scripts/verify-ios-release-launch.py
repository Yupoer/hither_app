#!/usr/bin/env python3
"""Verify a Release simulator app survives two cold starts and mounts its JS root.

No uninstall or simulator erase: this also exercises upgrades over existing data.
Screenshots still require review; simulator success does not certify a device IPA.
"""
import argparse
import ctypes
from datetime import datetime
import json
import os
from pathlib import Path
import plistlib
import re
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

    threads = report.get('threads', [])
    index = report.get('faultingThread')
    if (type(index) is int and isinstance(threads, list)
            and 0 <= index < len(threads) and isinstance(threads[index], dict)):
        modules = frame_modules(threads[index].get('frames'))
        if modules:
            summary['faultingModule'] = modules[0]
            summary['faultingModules'] = modules
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
                'process_exit': ('exit status', 'exit code', 'termination reason')}
    return sorted(name for name, terms in patterns.items()
                  if any(term in text for term in terms))


def probe_system_termination(simulator, bundle, started):
    if started is None or not re.fullmatch(r'[A-Za-z0-9.-]+', bundle):
        return {'systemLogProbe': 'unavailable'}
    predicate = ('(process == "runningboardd" OR process == "SpringBoard") '
                 'AND eventMessage CONTAINS[c] "' + bundle + '"')
    try:
        since = datetime.fromtimestamp(started).astimezone().strftime('%Y-%m-%d %H:%M:%S')
        result = subprocess.run(('xcrun', 'simctl', 'spawn', simulator, 'log', 'show',
                                 '--style', 'compact', '--start', since, '--predicate',
                                 predicate), capture_output=True, text=True, timeout=15)
        if result.returncode:
            return {'systemLogProbe': 'unavailable'}
        return {'systemLogProbe': 'available',
                'systemTerminationSignals': system_termination_signals(result.stdout)}
    except (OSError, ValueError, UnicodeError, subprocess.TimeoutExpired):
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
    try:
        run('xcrun', 'simctl', 'install', options.simulator, str(options.app))
        for attempt in range(1, 3):
            stage = 'launch'
            pid = None
            phase = None
            run('xcrun', 'simctl', 'terminate', options.simulator, bundle, check=False)
            started = time.time()
            stage = 'launch'
            launched = run('xcrun', 'simctl', 'launch', options.simulator, bundle)
            pid = int(launched.stdout.strip().rsplit(': ', 1)[1])
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
                os.kill(pid, 0)
                try:
                    with preferences.open('rb') as handle:
                        record = plistlib.load(handle)
                    if record.get('hither.launch.recordedAt.v1', 0) >= started * 1000:
                        phase = record.get('hither.launch.phase.v1')
                except (FileNotFoundError, plistlib.InvalidFileException):
                    pass
                time.sleep(1)
            assert phase in {'session_resolved', 'navigation_ready', 'stable'}, 'JS startup incomplete: ' + str(phase)
            assert record.get('hither.launch.build.v1') == options.build, 'Wrong launch breadcrumb build'
            screenshot = options.output / ('cold-start-' + str(attempt) + '.png')
            stage = 'screenshot'
            run('xcrun', 'simctl', 'io', options.simulator, 'screenshot', str(screenshot))
            evidence['launches'].append({'pid': pid, 'phase': phase, 'screenshot': str(screenshot)})
            print('PASS cold start', attempt, phase, flush=True)
        evidence['passed'] = True
    except Exception as error:
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
        try:
            evidence.update(probe_system_termination(options.simulator, bundle, started))
        except Exception:
            evidence['systemLogProbe'] = 'unavailable'
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
        raise
    finally:
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
    main()
