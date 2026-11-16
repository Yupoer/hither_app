#!/usr/bin/env python3
"""Build a pinned production IPA locally and verify full Release simulator startup.

Git/CI admission and screenshot review belong to the caller. This route never submits.
"""

import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import plistlib
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
from uuid import UUID

sys.dont_write_bytecode = True
REPO = Path(__file__).resolve().parents[1]
MOBILE = REPO / 'apps/mobile'
EAS = ['npx', '--yes', 'eas-cli@21.0.2']
SHA = re.compile(r'[0-9a-f]{40}\Z')


def load_helper(name, filename):
    spec = importlib.util.spec_from_file_location(name, REPO / 'scripts' / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


GATE = load_helper('local_release_launch_gate', 'run-ios-release-launch.py')
SYMBOLS = load_helper('local_release_symbols', 'retain-ios-debug-symbols.py')
RELEASE = load_helper('local_release_admission', 'ios_release.py')


def run(command, *, cwd=MOBILE, env=None, log=None, timeout=600):
    if log is None:
        return subprocess.check_output(command, cwd=cwd, env=env, text=True,
                                       stderr=subprocess.PIPE, timeout=timeout).strip()
    with Path(log).open('w') as stream:
        result = subprocess.run(command, cwd=cwd, env=env, stdout=stream,
                                stderr=subprocess.STDOUT, timeout=timeout)
    if result.returncode:
        raise RuntimeError(f'{command[0]} failed ({result.returncode}); see {log}')
    return ''


def read_json(path):
    result = json.loads(path.read_text())
    if not isinstance(result, dict):
        raise ValueError(f'Expected JSON object: {path}')
    return result


def write_json(path, data):
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(data, indent=2, sort_keys=True) + '\n')
    temporary.replace(path)


def digest(path):
    return SYMBOLS.sha256(path)


def tree_digest(path):
    result = hashlib.sha256()
    for entry in sorted(path.rglob('*')):
        relative = entry.relative_to(path).as_posix()
        if entry.is_symlink():
            value = 'link:' + os.readlink(entry)
        elif entry.is_file():
            value = digest(entry)
        else:
            continue
        result.update((relative + '\0' + value + '\n').encode())
    return result.hexdigest()


def prepare_directory(path):
    if not path.is_absolute() or path.is_symlink():
        raise ValueError('release-dir must be an absolute non-symlink private directory')
    path = path.resolve()
    if path == REPO or REPO in path.parents:
        raise ValueError('release-dir must be outside the checkout')
    path.mkdir(mode=0o700, parents=True, exist_ok=True)
    if path.stat().st_uid != os.getuid() or path.stat().st_mode & 0o077:
        raise ValueError('release-dir must be owned by the current user with mode 0700')
    return path


def require_source(source):
    if not SHA.fullmatch(source):
        raise ValueError('source-sha must be 40 lowercase hexadecimal characters')
    if run(['git', 'rev-parse', 'HEAD'], cwd=REPO) != source:
        raise ValueError('checkout HEAD differs from source-sha')
    if run(['git', 'status', '--porcelain', '--untracked-files=all'], cwd=REPO):
        raise ValueError('the pinned checkout must be clean, including untracked files')


@contextmanager
def release_lock(output):
    with (output / '.local-release.lock').open('a') as handle:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError as error:
            raise RuntimeError('another local release is using this release-dir') from error
        yield


def validate_metadata(app, config, platform):
    info = plistlib.loads((app / 'Info.plist').read_bytes())
    updates = plistlib.loads((app / 'Expo.plist').read_bytes())
    if (info.get('CFBundleIdentifier') != 'app.hither.mobile'
            or info.get('CFBundleShortVersionString') != config['version']
            or info.get('CFBundleSupportedPlatforms') != [platform]
            or not re.fullmatch(r'[0-9]+', str(info.get('CFBundleVersion', '')))
            or updates.get('EXUpdatesEnabled') is not True
            or updates.get('EXUpdatesRuntimeVersion') != config['runtimeVersion']
            or updates.get('EXUpdatesURL') != config['updates']['url']
            or updates.get('EXUpdatesRequestHeaders', {}).get('expo-channel-name') != 'production'):
        raise ValueError('built App metadata does not match the production source')
    return info


def verify_ipa(ipa, archive, output, config):
    if not archive.is_dir():
        raise ValueError('matching Hither.xcarchive is required beside the IPA')
    run([sys.executable, str(REPO / 'scripts/ios-release-upload.py'),
         '--source-sha', run(['git', 'rev-parse', 'HEAD'], cwd=REPO),
         '--ipa', str(ipa), '--sha256', digest(ipa), '--release-dir', str(output),
         '--repo', str(REPO), '--verify-only'], env=local_environment(output),
        log=output / 'ipa-verification.log')
    metadata = read_json(output / 'ipa-receipt.json')
    if metadata['appVersion'] != config['version'] or metadata['runtimeVersion'] != config['runtimeVersion']:
        raise ValueError('verified IPA does not match the checkout configuration')
    for binary in metadata['binaries']:
        executable = binary['executable']
        matches = [candidate for candidate in (archive / 'dSYMs').glob('*.dSYM')
                   if (candidate / 'Contents/Resources/DWARF' / executable).is_file()
                   and SYMBOLS.dwarf_uuids(candidate / 'Contents/Resources/DWARF' / executable) == binary['uuids']]
        if len(matches) != 1:
            raise ValueError(f'archive must contain exactly one matching dSYM for {executable}')
    return {'appVersion': metadata['appVersion'], 'build': metadata['buildNumber'],
            'runtimeVersion': metadata['runtimeVersion'], 'channel': metadata['channel'],
            'binaries': metadata['binaries']}


def identity(source, output):
    return {'sourceSha': source, 'ipaPath': str(output / 'Hither.ipa'),
            'archivePath': str(output / 'Hither.xcarchive')}


def check_identity(receipt, expected):
    if any(receipt.get(key) != value for key, value in expected.items()):
        raise ValueError('existing local build belongs to different source or paths')


def existing_ipa(source, output):
    expected = identity(source, output)
    receipt_path = output / 'local-build.json'
    intent_path = output / 'local-build-intent.json'
    ipa = output / 'Hither.ipa'
    if receipt_path.exists():
        receipt = read_json(receipt_path)
        check_identity(receipt, expected)
        if not ipa.is_file() or receipt.get('ipaSha256') != digest(ipa):
            raise ValueError('existing IPA does not match local-build.json digest')
        return receipt
    if intent_path.exists():
        check_identity(read_json(intent_path), expected)
        if not ipa.is_file():
            raise ValueError('previous EAS build outcome is unknown; inspect it before starting another build')
        return expected
    if ipa.exists() or (output / 'Hither.xcarchive').exists():
        raise ValueError('existing IPA/archive has no matching source receipt or build intent')
    return None


def local_environment(output):
    env = dict(os.environ)
    temporary = output / 'build-tmp'
    temporary.mkdir(exist_ok=True)
    env.update(CI='1', TMPDIR=str(temporary) + '/', EAS_BUILD_PROFILE='production')
    return env


def preflight_tools(env):
    run(['xcodebuild', '-version'], env=env)
    run(['xcrun', '--sdk', 'iphoneos', '--show-sdk-version'], env=env)
    pod_version = run(['pod', '--version'], env=env).splitlines()[-1].strip()
    if not (MOBILE / 'ios/Podfile.lock').read_text().rstrip().endswith('COCOAPODS: ' + pod_version):
        raise ValueError('installed CocoaPods must match Podfile.lock')


def prepare_dependencies(source, output, env):
    marker = output / 'dependencies.json'
    node = run(['node', '--version'], env=env)
    if not re.fullmatch(r'v22\.\d+\.\d+', node):
        raise ValueError('Node 22 is required for local production builds')
    expected = {'sourceSha': source, 'node': node, 'checkout': str(REPO)}
    if not marker.exists() or read_json(marker) != expected or not (MOBILE / 'node_modules').is_dir():
        run(['npm', 'ci'], env=env, log=output / 'npm-ci.log', timeout=1800)
        write_json(marker, expected)
    run(['npm', 'run', 'verify:runtime'], env=env, log=output / 'verify-runtime.log')


def build_ipa(source, output, config, env):
    receipt = existing_ipa(source, output)
    ipa, archive = output / 'Hither.ipa', output / 'Hither.xcarchive'
    if receipt is None:
        preflight_tools(env)
        prepare_dependencies(source, output, env)
        write_json(output / 'local-build-intent.json', {
            **identity(source, output), 'status': 'unknown', 'createdAt': datetime.now(timezone.utc).isoformat()})
        build_env = {**env, 'GYM_ARCHIVE_PATH': str(archive),
                     'GYM_DERIVED_DATA_PATH': str(output / 'device-derived-data'),
                     'GYM_BUILDLOG_PATH': str(output / 'gym-logs'),
                     'EAS_LOCAL_BUILD_WORKINGDIR': str(output / 'eas-work'),
                     'EAS_LOCAL_BUILD_SKIP_CLEANUP': '1'}
        run([*EAS, 'build', '--platform', 'ios', '--profile', 'production', '--local',
             '--non-interactive', '--output', str(ipa)], env=build_env,
            log=output / 'eas-build.log', timeout=10800)
    metadata = verify_ipa(ipa, archive, output, config)
    receipt = {**(receipt or {}), **identity(source, output), **metadata,
               'ipaSha256': digest(ipa), 'schemaVersion': 1, 'easCliVersion': '21.0.2',
               'easUpload': 'not_attempted', 'deviceAcceptance': 'not_verified'}
    write_json(output / 'local-build.json', receipt)
    return receipt


def select_simulator(requested, devices, runtimes):
    available = {row['identifier']: row for row in runtimes['runtimes']
                 if row.get('isAvailable') and row.get('identifier', '').startswith('com.apple.CoreSimulator.SimRuntime.iOS-')}
    candidates = [(device, available[runtime]) for runtime, rows in devices['devices'].items()
                  if runtime in available for device in rows
                  if device.get('isAvailable') and device.get('state') == 'Booted'
                  and (requested is None or device.get('udid') == requested)]
    if len(candidates) != 1:
        raise ValueError('specify --simulator with exactly one available booted iOS device')
    device, runtime = candidates[0]
    UUID(device['udid'])
    return device['udid'], runtime


def reusable_launch(output, source, runtime, config, app):
    path = output / 'startup' / 'launch-receipt.json'
    if not path.exists():
        return None
    receipt = read_json(path)
    if (receipt.get('sourceSha') != source or receipt.get('appVersion') != config['version']
            or receipt.get('runtimeId') != runtime['identifier']
            or receipt.get('runtimeBuild') != runtime['buildversion']
            or receipt.get('validationScope') != 'source_equivalent_release_simulator'
            or receipt.get('environment') != 'production'
            or receipt.get('configuration') != 'Release'
            or receipt.get('channel') != 'production'
            or receipt.get('runtimeVersion') != config['runtimeVersion']
            or not app.is_dir() or receipt.get('appSha256') != tree_digest(app)):
        raise ValueError('existing startup evidence does not match source, simulator runtime, or App')
    launches = receipt.get('launches')
    if not isinstance(launches, list) or len(launches) != 2:
        raise ValueError('startup receipt requires two cold starts')
    for attempt, launch in enumerate(launches, 1):
        screenshot = path.parent / f'cold-start-{attempt}.png'
        if (launch.get('attempt') != attempt or launch.get('phase') not in GATE.BOOT_PHASES
                or not screenshot.is_file() or launch.get('screenshotSha256') != digest(screenshot)
                or launch.get('screenshotBytes') != screenshot.stat().st_size):
            raise ValueError('retained startup screenshot evidence is missing or changed')
    return receipt


def simulator_stage(args, output):
    config = read_json(MOBILE / 'app.json')['expo']
    env = GATE.production_profile_environment(local_environment(output), read_json(MOBILE / 'eas.json'))
    env.update(EAS_BUILD_PROFILE='production', NODE_ENV='production')
    GATE.require_production_environment(env)
    simulator, runtime = select_simulator(args.simulator,
        json.loads(run(['xcrun', 'simctl', 'list', 'devices', '--json'])),
        json.loads(run(['xcrun', 'simctl', 'list', 'runtimes', '--json'])))
    derived = output / 'simulator-derived-data'
    app = derived / 'Build/Products/Release-iphonesimulator/Hither.app'
    evidence = reusable_launch(output, args.source_sha, runtime, config, app)
    if evidence:
        return evidence
    prepare_dependencies(args.source_sha, output, env)
    pod_version = run(['pod', '--version'], env=env).splitlines()[-1].strip()
    lock = (MOBILE / 'ios/Podfile.lock').read_text().rstrip()
    if not lock.endswith('COCOAPODS: ' + pod_version):
        raise ValueError('installed CocoaPods must match Podfile.lock')
    xcode = run(['xcodebuild', '-version'])
    app_receipt_path = output / 'simulator-build.json'
    build_identity = {'sourceSha': args.source_sha, 'configuration': 'Release', 'environment': 'production',
                      'channel': 'production', 'runtimeId': runtime['identifier'],
                      'runtimeBuild': runtime['buildversion'], 'xcode': xcode, 'appPath': str(app)}
    if app_receipt_path.exists():
        existing = read_json(app_receipt_path)
        check_identity(existing, build_identity)
        if existing.get('appSha256') != tree_digest(app):
            raise ValueError('retained simulator App differs from its build receipt')
    else:
        privacy = REPO / GATE.PRIVACY_PATH
        original_privacy = privacy.read_bytes()
        run(['pod', 'install', '--deployment'], cwd=MOBILE / 'ios', env=env,
            log=output / 'pod-install.log', timeout=1800)
        GATE.verify_ios_source_equivalence()
        privacy.write_bytes(original_privacy)
        plist = MOBILE / 'ios/Hither/Supporting/Expo.plist'
        node_config = MOBILE / 'ios/.xcode.env.local'
        original_plist = plist.read_bytes()
        original_node = node_config.read_bytes() if node_config.exists() else None
        node = shutil.which('node', path=env.get('PATH'))
        try:
            plist.write_bytes(GATE.production_simulator_plist(original_plist))
            node_config.write_text('export NODE_BINARY=' + shlex.quote(node) + '\n')
            run(['xcodebuild', '-workspace', str(MOBILE / 'ios/Hither.xcworkspace'), '-scheme', 'Hither',
                 '-configuration', 'Release', '-sdk', 'iphonesimulator', '-destination',
                 f'platform=iOS Simulator,id={simulator}', '-derivedDataPath', str(derived),
                 'ONLY_ACTIVE_ARCH=YES', 'CODE_SIGNING_ALLOWED=YES', 'CODE_SIGN_IDENTITY=-', 'build'],
                env=env, log=output / 'simulator-build.log', timeout=10800)
        finally:
            plist.write_bytes(original_plist)
            if original_node is None:
                node_config.unlink(missing_ok=True)
            else:
                node_config.write_bytes(original_node)
        GATE.verify_ios_source_equivalence()
        validate_metadata(app, config, 'iPhoneSimulator')
        write_json(app_receipt_path, {**build_identity, 'appSha256': tree_digest(app)})
    info = validate_metadata(app, config, 'iPhoneSimulator')
    # simctl launchd cannot create stdout/stderr files reliably on external volumes.
    internal = Path(tempfile.mkdtemp(prefix='hither-release-launch-', dir='/private/tmp'))
    write_json(output / 'startup-attempt.json', {'sourceSha': args.source_sha, 'internalOutput': str(internal)})
    launch_env = {**env, 'TMPDIR': str(internal) + '/'}
    destination = output / 'startup'
    destination.mkdir(exist_ok=True)
    try:
        run([sys.executable, str(MOBILE / 'scripts/verify-ios-release-launch.py'), '--check-exit-observer'],
            env=launch_env, timeout=20)
        run([sys.executable, str(MOBILE / 'scripts/verify-ios-release-launch.py'), '--app', str(app),
             '--simulator', simulator, '--build', str(info['CFBundleVersion']), '--output', str(internal)],
            env=launch_env, log=internal / 'cold-launch-run.log', timeout=300)
        result = read_json(internal / 'launch-result.json')
        evidence = GATE.receipt_from_launch(args.source_sha, config['version'], str(info['CFBundleVersion']),
                                             runtime, simulator, result, internal)
        evidence.update(appSha256=tree_digest(app), configuration='Release', environment='production',
                        channel='production', runtimeVersion=config['runtimeVersion'], xcode=xcode)
    finally:
        shutil.copytree(internal, destination, dirs_exist_ok=True)
    write_json(destination / 'launch-receipt.json', evidence)
    return evidence


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-sha', required=True)
    parser.add_argument('--release-dir', type=Path, required=True)
    parser.add_argument('--simulator', help='booted iOS UDID; defaults to the only booted iOS device')
    parser.add_argument('--build-only', action='store_true')
    parser.add_argument('--_simulator-stage', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args(argv)
    require_source(args.source_sha)
    output = prepare_directory(args.release_dir)
    if sys.platform != 'darwin':
        raise ValueError('local iOS builds require macOS')
    os.umask(0o077)
    if args._simulator_stage:
        simulator_stage(args, output)
        return
    with release_lock(output):
        write_json(output / 'ci-admission.json', RELEASE.require_master_ci(args.source_sha))
        config = read_json(MOBILE / 'app.json')['expo']
        env = local_environment(output)
        receipt = build_ipa(args.source_sha, output, config, env)
        if not args.build_only:
            command = [sys.executable, str(Path(__file__).resolve()), '--source-sha', args.source_sha,
                       '--release-dir', str(output), '--_simulator-stage']
            if args.simulator:
                command.extend(['--simulator', args.simulator])
            run([*EAS, 'env:exec', 'production', shlex.join(command), '--non-interactive'],
                env=env, log=output / 'simulator-route.log', timeout=14400)
            receipt['startupEvidence'] = str(output / 'startup/launch-receipt.json')
            receipt['visualReview'] = 'pending'
            write_json(output / 'local-build.json', receipt)
        print(f'Local release artifacts: {output / "local-build.json"}; upload not attempted.')


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        print(f'Local iOS release failed: {error}', file=sys.stderr)
        sys.exit(1)
