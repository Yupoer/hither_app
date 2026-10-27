#!/usr/bin/env python3
"""Verify a Release simulator app survives two cold starts and mounts its JS root.

No uninstall or simulator erase: this also exercises upgrades over existing data.
Screenshots still require review; simulator success does not certify a device IPA.
"""
import argparse
import json
import os
from pathlib import Path
import plistlib
import re
import subprocess
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


def run(*args, check=True):
    result = subprocess.run(args, capture_output=True, text=True)
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
        if pid is not None:
            try:
                os.kill(pid, 0)
                evidence['processAlive'] = True
            except ProcessLookupError:
                evidence['processAlive'] = False
            except OSError:
                pass
        if phase is not None:
            evidence['lastObservedPhase'] = phase if phase in {
                'session_resolved', 'navigation_ready', 'stable'} else 'other'
        if isinstance(error, CommandFailure):
            evidence['simctlExitCode'] = error.returncode
        if evidence.get('processAlive') is False and pid is not None:
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
                       'process == "' + info['CFBundleExecutable'] + '"', check=False)
            (options.output / 'native-launch.log').write_text(logs.stdout + logs.stderr)
            if evidence.get('passed') is False:
                evidence['runtimeLogSignals'] = runtime_log_signals(logs.stdout + logs.stderr)
        except OSError:
            pass
        (options.output / 'launch-result.json').write_text(json.dumps(evidence, indent=2) + '\n')


if __name__ == '__main__':
    main()
