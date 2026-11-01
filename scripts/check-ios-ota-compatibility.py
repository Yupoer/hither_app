#!/usr/bin/env python3
"""Reject iOS OTA when the recorded installed binary cannot run this checkout."""

import argparse
import json
from pathlib import Path
import plistlib
import re
import subprocess
import sys


SHA = re.compile(r"[0-9a-f]{40}\Z")
SOURCE_FILE = re.compile(r"apps/mobile/src/(?!native/).+\.(?:js|jsx|ts|tsx|json)\Z")
NON_RUNTIME_PREFIXES = (
    "apps/mobile/src/__tests__/",
    "apps/mobile/__tests__/",
    "apps/mobile/test/",
    "apps/mobile/docs/",
    "apps/mobile/scripts/",
)


def git(repo, *args):
    return subprocess.run(
        ["git", *args], cwd=repo, capture_output=True, check=True
    ).stdout


def check(repo, source_sha, manifest_path):
    result = {"eligible": False, "reason": "unknown", "runtimeVersion": None,
              "binarySourceSha": None, "nonOtaMobilePaths": []}
    if not SHA.fullmatch(source_sha):
        result["reason"] = "invalid_source_sha"
        return result
    try:
        if git(repo, "rev-parse", "HEAD").decode().strip() != source_sha:
            result["reason"] = "checkout_not_pinned_source"
            return result
        manifest = json.loads(manifest_path.read_text())
    except (OSError, UnicodeError, ValueError, subprocess.CalledProcessError):
        result["reason"] = "missing_or_invalid_binary_record"
        return result

    if not isinstance(manifest, dict):
        result["reason"] = "invalid_binary_record"
        return result
    binary_sha = manifest.get("sourceSha")
    result["binarySourceSha"] = binary_sha
    result["runtimeVersion"] = manifest.get("runtimeVersion")
    if (not isinstance(binary_sha, str) or not SHA.fullmatch(binary_sha)
            or manifest.get("platform") != "ios"
            or manifest.get("channel") != "production"
            or not isinstance(manifest.get("buildNumber"), str)
            or not manifest["buildNumber"].isdigit()
            or manifest.get("appleState") not in {"IN_BETA_TESTING", "READY_FOR_SALE"}):
        result["reason"] = "invalid_binary_record"
        return result
    evidence = manifest.get("evidence")
    if not isinstance(evidence, str) or not evidence:
        result["reason"] = "missing_binary_evidence"
        return result
    try:
        evidence_path = (repo / evidence).resolve(strict=True)
        evidence_path.relative_to(repo.resolve())
        evidence_text = evidence_path.read_text()
        expected_evidence = (binary_sha, manifest.get("runtimeVersion"),
                             manifest.get("appVersion"), manifest["buildNumber"],
                             manifest["channel"], manifest["appleState"])
        if any(not isinstance(value, str) or value not in evidence_text
               for value in expected_evidence):
            result["reason"] = "binary_evidence_mismatch"
            return result
    except (OSError, ValueError, UnicodeError):
        result["reason"] = "missing_binary_evidence"
        return result
    try:
        git(repo, "merge-base", "--is-ancestor", binary_sha, source_sha)
    except subprocess.CalledProcessError:
        result["reason"] = "binary_source_not_ancestor"
        return result
    try:
        changed = git(repo, "diff", "--no-renames", "--name-only", "-z",
                      binary_sha, source_sha).decode().split("\0")
    except (UnicodeError, subprocess.CalledProcessError):
        result["reason"] = "cannot_compare_binary_source"
        return result
    unsafe = sorted(path for path in changed if path.startswith("apps/mobile/")
                    and not SOURCE_FILE.fullmatch(path)
                    and not path.startswith(NON_RUNTIME_PREFIXES))
    result["nonOtaMobilePaths"] = unsafe
    try:
        app = json.loads((repo / "apps/mobile/app.json").read_text())["expo"]
        eas = json.loads((repo / "apps/mobile/eas.json").read_text())
        with (repo / "apps/mobile/ios/Hither/Supporting/Expo.plist").open("rb") as handle:
            ios_updates = plistlib.load(handle)
    except (OSError, UnicodeError, ValueError, KeyError, plistlib.InvalidFileException):
        result["reason"] = "invalid_app_configuration"
        return result
    runtime = manifest.get("runtimeVersion")
    if (not isinstance(runtime, str) or not runtime
            or app.get("runtimeVersion") != runtime
            or app.get("version") != manifest.get("appVersion")
            or ios_updates.get("EXUpdatesRuntimeVersion") != runtime
            or ios_updates.get("EXUpdatesEnabled") is not True
            or ios_updates.get("EXUpdatesURL") != app.get("updates", {}).get("url")
            or eas.get("build", {}).get("production", {}).get("channel") != "production"):
        result["reason"] = "binary_runtime_or_channel_mismatch"
        return result

    if unsafe:
        result["reason"] = "mobile_native_or_config_changed"
        return result
    result["eligible"] = True
    result["reason"] = "compatible"
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-sha", required=True)
    parser.add_argument("--manifest", default="release/ios-production-binary.json")
    args = parser.parse_args()
    repo = Path.cwd().resolve()
    try:
        repo = Path(git(repo, "rev-parse", "--show-toplevel").decode().strip())
        result = check(repo, args.source_sha, repo / args.manifest)
    except (OSError, UnicodeError, subprocess.CalledProcessError):
        result = {"eligible": False, "reason": "not_a_git_checkout", "runtimeVersion": None,
                  "binarySourceSha": None, "nonOtaMobilePaths": []}
    print(json.dumps(result, sort_keys=True))
    return 0 if result["eligible"] else 1


if __name__ == "__main__":
    sys.exit(main())
