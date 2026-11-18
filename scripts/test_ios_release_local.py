import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('ios_release_local', Path(__file__).with_name('ios-release-local.py'))
LOCAL = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(LOCAL)
SOURCE = 'a' * 40
SIMULATOR = '12345678-1234-1234-1234-123456789abc'
RUNTIME = {'identifier': 'com.apple.CoreSimulator.SimRuntime.iOS-27-0',
           'buildversion': '24A1', 'isAvailable': True}
VERIFICATION = {'sourceSha': SOURCE, 'appVersion': '0.1.16', 'runtimeVersion': '0.1.16',
                'buildNumber': '88', 'channel': 'production', 'binaries': []}


class LocalReleaseTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.output = Path(self.directory.name)

    def write(self, name, payload):
        LOCAL.write_json(self.output / name, payload)

    def test_production_config_is_deferred_until_eas_loads_the_environment(self):
        with patch.dict('os.environ', {'EAS_BUILD_PROFILE': 'production'}):
            env = LOCAL.local_environment(self.output)
        self.assertNotIn('EAS_BUILD_PROFILE', env)
        self.assertEqual(env['CI'], '1')

    def test_shared_verifier_uses_external_temp_and_requires_archive_uuid_match(self):
        ipa, archive = self.output / 'Hither.ipa', self.output / 'Hither.xcarchive'
        ipa.write_bytes(b'IPA')
        archive.mkdir()
        uuids = [{'architecture': 'arm64', 'uuid': 'A' * 36}]
        binary = {'executable': 'Hither', 'bundleIdentifier': 'app.hither.mobile', 'uuids': uuids}
        metadata = {**VERIFICATION, 'ipa': str(ipa), 'binaries': [binary]}
        dwarf = archive / 'dSYMs/Hither.app.dSYM/Contents/Resources/DWARF/Hither'
        dwarf.parent.mkdir(parents=True)
        dwarf.write_bytes(b'symbols')
        def verify(ipa_path, source, digest, config, *, temporary_dir):
            self.assertEqual(ipa_path, ipa)
            self.assertEqual(source, SOURCE)
            self.assertEqual(digest, LOCAL.digest(ipa))
            self.assertEqual(Path(temporary_dir), self.output / 'build-tmp')
            return {**metadata, 'ipaSha256': digest}

        config = {'version': '0.1.16', 'runtimeVersion': '0.1.16'}
        with patch.object(LOCAL.UPLOAD, 'verify_ipa', side_effect=verify), \
                patch.object(LOCAL.SYMBOLS, 'dwarf_uuids', return_value=uuids):
            self.assertEqual(LOCAL.verify_ipa(ipa, archive, self.output, SOURCE, config)['buildNumber'], '88')
        with patch.object(LOCAL.UPLOAD, 'verify_ipa', side_effect=verify), \
                patch.object(LOCAL.SYMBOLS, 'dwarf_uuids', return_value=[]):
            with self.assertRaisesRegex(ValueError, 'matching dSYM'):
                LOCAL.verify_ipa(ipa, archive, self.output, SOURCE, config)

    def test_existing_ipa_requires_exact_source_and_digest(self):
        ipa = self.output / 'Hither.ipa'
        ipa.write_bytes(b'signed IPA')
        receipt = {**LOCAL.identity(SOURCE, self.output), 'ipaSha256': LOCAL.digest(ipa)}
        self.write('local-build.json', receipt)
        self.assertEqual(LOCAL.existing_ipa(SOURCE, self.output), receipt)
        with self.assertRaisesRegex(ValueError, 'different source'):
            LOCAL.existing_ipa('b' * 40, self.output)
        ipa.write_bytes(b'replaced IPA')
        with self.assertRaisesRegex(ValueError, 'digest'):
            LOCAL.existing_ipa(SOURCE, self.output)

    def test_unreceipted_ipa_is_not_adopted(self):
        (self.output / 'Hither.ipa').write_bytes(b'unknown IPA')
        with self.assertRaisesRegex(ValueError, 'no matching source'):
            LOCAL.existing_ipa(SOURCE, self.output)

    def test_interrupted_build_does_not_trigger_another_remote_increment(self):
        self.write('local-build-intent.json', {**LOCAL.identity(SOURCE, self.output), 'status': 'unknown'})
        with patch.object(LOCAL, 'run') as run:
            with self.assertRaisesRegex(ValueError, 'outcome is unknown'):
                LOCAL.build_ipa(SOURCE, self.output, {}, {})
        run.assert_not_called()

    def test_complete_artifact_after_interruption_is_verified_without_building(self):
        ipa = self.output / 'Hither.ipa'
        ipa.write_bytes(b'IPA completed before receipt')
        self.write('local-build-intent.json', {**LOCAL.identity(SOURCE, self.output), 'status': 'unknown'})
        metadata = {**VERIFICATION, 'ipaSha256': LOCAL.digest(ipa)}
        with patch.object(LOCAL, 'run') as run, patch.object(LOCAL, 'verify_ipa', return_value=metadata) as verify:
            receipt, _ = LOCAL.build_ipa(SOURCE, self.output, {}, {})
        run.assert_not_called()
        verify.assert_called_once()
        self.assertEqual(receipt['sourceSha'], SOURCE)
        self.assertEqual(receipt['easUpload'], 'not_attempted')
        self.assertFalse((self.output / 'local-build.json').exists())

    def test_build_pins_eas_and_puts_work_archive_and_temporary_files_in_output(self):
        expo_plist = self.output / 'ios/Hither/Supporting/Expo.plist'
        expo_plist.parent.mkdir(parents=True)
        expo_plist.write_bytes(b'<plist/>\n')

        def command(argv, **kwargs):
            self.assertEqual(argv[:3], ['npx', '--yes', 'eas-cli@21.0.2'])
            self.assertIn('--local', argv)
            self.assertNotIn('submit', argv)
            self.assertEqual(kwargs['env']['GYM_ARCHIVE_PATH'], str(self.output / 'Hither.xcarchive'))
            self.assertEqual(kwargs['env']['EAS_LOCAL_BUILD_WORKINGDIR'], str(self.output / 'eas-work'))
            self.assertEqual(kwargs['env']['GYM_DERIVED_DATA_PATH'], str(self.output / 'device-derived-data'))
            self.assertTrue(kwargs['env']['TMPDIR'].startswith(str(self.output)))
            self.assertTrue((self.output / 'local-build-intent.json').is_file())
            expo_plist.write_bytes(b'<plist/>')
            (self.output / 'Hither.ipa').write_bytes(b'IPA')
        with patch.object(LOCAL, 'MOBILE', self.output), \
                patch.object(LOCAL, 'run', side_effect=command), patch.object(LOCAL, 'preflight_tools'), \
                patch.object(LOCAL, 'prepare_dependencies'), patch.object(
                    LOCAL, 'verify_ipa', return_value={**VERIFICATION, 'ipaSha256': 'b' * 64}):
            LOCAL.build_ipa(SOURCE, self.output, {}, LOCAL.local_environment(self.output))
        self.assertEqual(expo_plist.read_bytes(), b'<plist/>\n')

    def test_existing_receipt_still_reverifies_signature_and_archive(self):
        ipa = self.output / 'Hither.ipa'
        ipa.write_bytes(b'IPA')
        self.write('local-build.json', {**LOCAL.identity(SOURCE, self.output), 'ipaSha256': LOCAL.digest(ipa)})
        with patch.object(LOCAL, 'verify_ipa', side_effect=ValueError('signature failed')):
            with self.assertRaisesRegex(ValueError, 'signature failed'):
                LOCAL.build_ipa(SOURCE, self.output, {}, {})

    def test_only_one_booted_ios_simulator_is_selected(self):
        device = {'udid': SIMULATOR, 'state': 'Booted', 'isAvailable': True}
        devices = {'devices': {RUNTIME['identifier']: [device]}}
        self.assertEqual(LOCAL.select_simulator(None, devices, {'runtimes': [RUNTIME]}), (SIMULATOR, RUNTIME))
        devices['devices'][RUNTIME['identifier']].append({**device, 'udid': '22345678-1234-1234-1234-123456789abc'})
        with self.assertRaisesRegex(ValueError, 'exactly one'):
            LOCAL.select_simulator(None, devices, {'runtimes': [RUNTIME]})
        self.assertEqual(LOCAL.select_simulator(SIMULATOR, devices, {'runtimes': [RUNTIME]})[0], SIMULATOR)
        with self.assertRaisesRegex(ValueError, 'exactly one'):
            LOCAL.select_simulator('32345678-1234-1234-1234-123456789abc', devices, {'runtimes': [RUNTIME]})

    def gate_fixture(self):
        app = self.output / 'Hither.app'
        app.mkdir()
        (app / 'main.jsbundle').write_bytes(b'production bundle')
        startup = self.output / 'startup'
        startup.mkdir()
        launches = []
        for attempt in (1, 2):
            image = startup / f'cold-start-{attempt}.png'
            image.write_bytes(LOCAL.GATE.PNG_MAGIC + b'pixels')
            launches.append({'attempt': attempt, 'phase': 'stable', 'screenshotSha256': LOCAL.digest(image),
                             'screenshotBytes': image.stat().st_size})
        config = {'version': '0.1.16', 'runtimeVersion': '0.1.16'}
        receipt = {'sourceSha': SOURCE, 'appVersion': config['version'], 'runtimeVersion': config['runtimeVersion'],
                   'runtimeId': RUNTIME['identifier'], 'runtimeBuild': RUNTIME['buildversion'],
                   'validationScope': 'source_equivalent_release_simulator', 'appSha256': LOCAL.tree_digest(app),
                   'environment': 'production', 'configuration': 'Release', 'channel': 'production', 'launches': launches}
        LOCAL.write_json(startup / 'launch-receipt.json', receipt)
        return app, config, receipt

    def test_matching_startup_receipt_can_resume_without_simulator_launch(self):
        app, config, receipt = self.gate_fixture()
        self.assertEqual(LOCAL.reusable_launch(self.output, SOURCE, RUNTIME, config, app), receipt)

    def test_changed_screenshot_blocks_startup_reuse(self):
        app, config, _ = self.gate_fixture()
        (self.output / 'startup/cold-start-2.png').write_bytes(b'changed screenshot')
        with self.assertRaisesRegex(ValueError, 'screenshot'):
            LOCAL.reusable_launch(self.output, SOURCE, RUNTIME, config, app)

    def test_changed_app_runtime_or_production_settings_block_startup_reuse(self):
        app, config, receipt = self.gate_fixture()
        for key, value in [('sourceSha', 'b' * 40), ('runtimeBuild', 'other'), ('channel', 'preview'),
                           ('environment', 'preview'), ('configuration', 'Debug'), ('runtimeVersion', 'other')]:
            with self.subTest(key=key):
                LOCAL.write_json(self.output / 'startup/launch-receipt.json', {**receipt, key: value})
                with self.assertRaisesRegex(ValueError, 'does not match'):
                    LOCAL.reusable_launch(self.output, SOURCE, RUNTIME, config, app)
        LOCAL.write_json(self.output / 'startup/launch-receipt.json', receipt)
        (app / 'main.jsbundle').write_bytes(b'different JS')
        with self.assertRaisesRegex(ValueError, 'does not match'):
            LOCAL.reusable_launch(self.output, SOURCE, RUNTIME, config, app)

    def test_source_guard_rejects_dirty_or_wrong_checkout(self):
        for output in ([SOURCE, ' M app.json'], ['b' * 40]):
            with self.subTest(output=output), patch.object(LOCAL, 'run', side_effect=output):
                with self.assertRaises(ValueError):
                    LOCAL.require_source(SOURCE)
        with patch.object(LOCAL, 'run', side_effect=[SOURCE, '']):
            LOCAL.require_source(SOURCE)

    def test_private_output_required(self):
        self.output.chmod(0o755)
        with self.assertRaisesRegex(ValueError, '0700'):
            LOCAL.prepare_directory(self.output)
        self.output.chmod(0o700)
        self.assertEqual(LOCAL.prepare_directory(self.output), self.output.resolve())
        with self.assertRaisesRegex(ValueError, 'absolute'):
            LOCAL.prepare_directory(Path('relative-output'))

    def test_build_only_never_enters_simulator_environment_or_submits(self):
        receipt = {'sourceSha': SOURCE}
        with patch.object(LOCAL, 'require_source'), patch.object(LOCAL.sys, 'platform', 'darwin'), \
                patch.object(LOCAL, 'build_ipa', return_value=(receipt, VERIFICATION)), \
                patch.object(LOCAL.UPLOAD, 'read_source', return_value={}), \
                patch.object(LOCAL.RELEASE, 'require_master_ci', return_value={'sourceSha': SOURCE}) as ci, \
                patch.object(LOCAL, 'run') as run, patch.object(LOCAL.UPLOAD, 'submit_ipa') as submit:
            LOCAL.main(['--source-sha', SOURCE, '--release-dir', str(self.output), '--build-only'])
        run.assert_not_called()
        ci.assert_called_once_with(SOURCE)
        submit.assert_not_called()
        self.assertEqual(LOCAL.read_json(self.output / 'local-build.json'), receipt)

    def test_submit_requires_a_fresh_build_and_startup_confirmation(self):
        arguments = ['--source-sha', SOURCE, '--release-dir', str(self.output), '--submit', '--backend-verified']
        receipt = {'sourceSha': SOURCE, 'easUpload': 'not_attempted'}
        config = {'version': '0.1.16'}
        verification = {**VERIFICATION, 'ipaSha256': 'b' * 64, 'ipa': str(self.output / 'Hither.ipa')}
        with patch.object(LOCAL, 'require_source') as clean, patch.object(LOCAL.sys, 'platform', 'darwin'), \
                patch.object(LOCAL.sys.stdin, 'isatty', return_value=True), \
                patch.object(LOCAL.UPLOAD, 'read_source', return_value=config), \
                patch.object(LOCAL.RELEASE, 'require_master_ci', return_value={'sourceSha': SOURCE}), \
                patch.object(LOCAL, 'build_ipa', return_value=(receipt, verification)) as build, \
                patch.object(LOCAL, 'run') as run, patch.object(LOCAL.UPLOAD, 'submit_ipa', return_value={
                    'easStatus': 'uploaded',
                }) as submit:
            def approve(_prompt):
                self.assertIn('env:exec', run.call_args.args[0])
                self.assertEqual(LOCAL.read_json(self.output / 'local-build.json')['visualReview'], 'pending')
                submit.assert_not_called()
                return 'submit'

            with patch('builtins.input', side_effect=approve):
                self.assertEqual(LOCAL.main(arguments), 0)
            self.assertTrue(build.call_args.kwargs['fresh'])
            self.assertEqual(clean.call_count, 3)
            submit.assert_called_once_with(LOCAL.REPO, self.output.resolve(), verification, config)
            self.assertEqual(LOCAL.read_json(self.output / 'local-build.json')['easUpload'], 'uploaded')
            with self.assertRaisesRegex(ValueError, 'requires a new empty release directory'):
                LOCAL.main(arguments)
            build.assert_called_once()
            submit.assert_called_once()

    def test_fresh_build_rejects_a_retained_ipa_even_with_a_matching_digest(self):
        ipa = self.output / 'Hither.ipa'
        ipa.write_bytes(b'existing IPA')
        self.write('local-build.json', {**LOCAL.identity(SOURCE, self.output), 'ipaSha256': LOCAL.digest(ipa)})
        with patch.object(LOCAL, 'verify_ipa') as verify:
            with self.assertRaisesRegex(ValueError, 'built in this invocation'):
                LOCAL.build_ipa(SOURCE, self.output, {}, {}, fresh=True)
        verify.assert_not_called()


if __name__ == '__main__':
    unittest.main()
