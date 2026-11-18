"""Exercise release route selection and resumable CD dispatch."""

import importlib.util
import io
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import ios_release as release


SOURCE = "a" * 40
SELECTOR_SPEC = importlib.util.spec_from_file_location("release_selector", Path(__file__).with_name("ios-release.py"))
SELECTOR = importlib.util.module_from_spec(SELECTOR_SPEC)
SELECTOR_SPEC.loader.exec_module(SELECTOR)


class ReleasePlanTests(unittest.TestCase):
    def plan(self, changed, *, eligible=True, reason="compatible"):
        result = {"eligible": eligible, "reason": reason, "comparisonBaselineSha": "b" * 40,
                  "nonOtaMobilePaths": []}
        with patch.object(release, "compatibility", return_value=result), \
                patch.object(release, "capture", return_value="\0".join(changed)):
            return release.release_plan(SOURCE)["route"]

    def test_compatible_product_change_selects_ota(self):
        self.assertEqual(self.plan(["apps/mobile/src/components/Card.tsx"]), "ota")

    def test_only_tests_and_docs_skip_product_release(self):
        self.assertEqual(self.plan(["apps/mobile/src/__tests__/Card.test.tsx", "apps/mobile/docs/setup.md"]), "none")

    def test_native_or_unverified_binary_selects_local(self):
        for reason in ("mobile_native_or_config_changed", "missing_or_invalid_binary_record",
                       "binary_runtime_or_channel_mismatch"):
            with self.subTest(reason=reason):
                self.assertEqual(self.plan([], eligible=False, reason=reason), "local")

    def test_invalid_source_configuration_does_not_build(self):
        with self.assertRaisesRegex(ValueError, "invalid_app_configuration"):
            self.plan([], eligible=False, reason="invalid_app_configuration")

    def test_selector_forwards_explicit_local_submission(self):
        arguments = ["--source-sha", SOURCE, "--release-dir", "/unused", "--execute", "--backend-verified"]
        with patch.object(SELECTOR, "require_pinned_checkout"), \
                patch.object(SELECTOR, "release_plan", return_value={"route": "local"}), \
                patch.object(SELECTOR.subprocess, "run", return_value=subprocess.CompletedProcess([], 0)) as run, \
                patch("sys.stdout", new_callable=io.StringIO):
            self.assertEqual(SELECTOR.main(arguments), 0)
            self.assertNotIn("--submit", run.call_args.args[0])
            self.assertEqual(SELECTOR.main([*arguments, "--submit"]), 0)
            command = run.call_args.args[0]
            self.assertIn("scripts/ios-release-local.py", command)
            self.assertEqual(command[-2:], ["--submit", "--backend-verified"])


class DispatchTests(unittest.TestCase):
    def test_repeat_watches_same_run_without_dispatching(self):
        with tempfile.TemporaryDirectory() as tmp, \
                patch.object(release, "require_pinned_checkout"), \
                patch.object(release, "capture", return_value=f"https://github.com/{release.REPOSITORY}/actions/runs/123"), \
                patch.object(release, "watch_dispatch") as watch:
            directory = Path(tmp)
            release.dispatch("build-only", SOURCE, directory)
            with patch.object(release, "capture", side_effect=AssertionError("duplicate dispatch")):
                release.dispatch("build-only", SOURCE, directory)
            self.assertEqual(watch.call_count, 2)
            watch.assert_called_with("123", "build-only", SOURCE, directory.resolve())

    def test_unacknowledged_dispatch_blocks_another_request(self):
        with tempfile.TemporaryDirectory() as tmp, \
                patch.object(release, "require_pinned_checkout"), \
                patch.object(release, "capture", side_effect=subprocess.CalledProcessError(1, "gh")) as request:
            directory = Path(tmp)
            with self.assertRaises(subprocess.CalledProcessError):
                release.dispatch("build-only", SOURCE, directory)
            with self.assertRaisesRegex(RuntimeError, "existing dispatch"):
                release.dispatch("build-only", SOURCE, directory)
            self.assertEqual(request.call_count, 1)

    def test_ineligible_ota_never_dispatches(self):
        with patch.object(release, "require_pinned_checkout"), \
                patch.object(release, "release_plan", return_value={"route": "local"}), \
                patch.object(release, "capture") as request:
            with self.assertRaisesRegex(ValueError, "not eligible"):
                release.dispatch("ota", SOURCE, Path("/unused"), backend_verified=True)
            request.assert_not_called()


if __name__ == "__main__":
    unittest.main()
