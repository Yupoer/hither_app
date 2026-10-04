#!/usr/bin/env python3
"""Exercise the real patched actor before/after the UI fix on an iOS simulator.

This checks native executor behavior, not full-app or TestFlight acceptance.
"""
import argparse
from pathlib import Path
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--simulator', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    mobile = Path(__file__).resolve().parents[1]
    actor = mobile / 'node_modules/expo-modules-jsi/apple/Sources/ExpoModulesJSI/Runtime/JavaScriptActor.swift'
    original = actor.read_text()
    marker = 'Thread.isMainThread || Thread.current.name =='
    if original.count(marker) != 1:
        raise RuntimeError('Expected exactly one shared UI context predicate')
    builder = mobile / 'scripts/build-jsi-executor-probe.py'
    baseline = args.output / 'baseline'
    fixed = args.output / 'fixed'
    try:
        # Change only the UI context predicate in the installed production actor.
        actor.write_text(original.replace(marker, 'Thread.current.name =='))
        subprocess.run([sys.executable, str(builder), str(baseline), '--release'], check=True, timeout=120)
    finally:
        actor.write_text(original)
    subprocess.run([sys.executable, str(builder), str(fixed), '--release'], check=True, timeout=120)
    for name, binary, modes, expected_success in [
        ('baseline-ui', baseline, ['ui'], False),
        ('fixed-ui-js', fixed, ['ui', 'many'], True),
        ('fixed-wrong-thread', fixed, ['wrong'], False),
    ]:
        result = subprocess.run(['xcrun', 'simctl', 'spawn', args.simulator, str(binary), *modes],
                                capture_output=True, text=True, timeout=60)
        log = result.stdout + result.stderr
        (args.output / (name + '.log')).write_text(log)
        if expected_success:
            if result.returncode or 'UI runtime main-thread/nested/typed-throw=PASS' not in log:
                raise RuntimeError(name + ' failed:\n' + log)
            print(result.stdout, end='', flush=True)
        elif result.returncode == 0 or 'data race detected' not in log:
            raise RuntimeError(name + ' did not reject isolation:\n' + log)
        print(name + ': PASS (exit ' + str(result.returncode) + ')', flush=True)


if __name__ == '__main__':
    main()
