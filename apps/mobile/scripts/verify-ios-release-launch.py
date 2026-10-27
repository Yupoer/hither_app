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
import subprocess
import time


class CommandFailure(RuntimeError):
    def __init__(self, args, result):
        self.returncode = result.returncode
        super().__init__(' '.join(args) + '\n' + result.stdout + result.stderr)


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
        raise
    finally:
        try:
            logs = run('xcrun', 'simctl', 'spawn', options.simulator, 'log', 'show',
                       '--style', 'compact', '--last', '3m', '--predicate',
                       'process == "' + info['CFBundleExecutable'] + '"', check=False)
            (options.output / 'native-launch.log').write_text(logs.stdout + logs.stderr)
        except OSError:
            pass
        (options.output / 'launch-result.json').write_text(json.dumps(evidence, indent=2) + '\n')


if __name__ == '__main__':
    main()
