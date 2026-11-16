#!/usr/bin/env python3
"""Verify an exact production Hither IPA and, when requested, submit it once."""

import argparse
import json
import os
from pathlib import Path, PurePosixPath
import plistlib
import re
import runpy
import shutil
import stat
import subprocess
import sys
import tempfile
import zipfile

sys.dont_write_bytecode = True
from ios_release import release_directory, require_master_ci


APP_ID = "app.hither.mobile"
WIDGET_ID = "app.hither.mobile.widget"
ASC_APP_ID = "6790314569"
EAS_CLI = "eas-cli@21.0.2"
SOURCE_SHA = re.compile(r"[0-9a-f]{40}")
IPA_SHA = re.compile(r"[0-9a-f]{64}")
UUID = r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}"
UPLOAD_SUCCESS = "Your binary has been successfully uploaded to App Store Connect!"
SUBMISSION_FILES = ("submission-intent.json", "eas-submit.log", "submission-receipt.json")
RELEASE_IDENTITY = ("sourceSha", "ipaSha256", "appVersion", "buildNumber")
SYMBOL_HELPERS = Path(__file__).with_name("retain-ios-debug-symbols.py")


def git(repo, *arguments):
    result = subprocess.run(["git", *arguments], cwd=repo, check=True, capture_output=True)
    return result.stdout


def read_source(repo, source_sha):
    if not SOURCE_SHA.fullmatch(source_sha) or git(repo, "cat-file", "-t", source_sha).strip() != b"commit":
        raise ValueError("--source-sha must be a locally available 40-character Git commit")
    config = json.loads(git(repo, "show", f"{source_sha}:apps/mobile/app.json"))["expo"]
    eas_config = json.loads(git(repo, "show", f"{source_sha}:apps/mobile/eas.json"))
    profile = eas_config["build"]["production"]
    if profile["channel"] != "production" or profile["distribution"] != "store":
        raise ValueError("pinned source has no production store build profile")
    if eas_config["submit"]["production"]["ios"]["ascAppId"] != ASC_APP_ID:
        raise ValueError("pinned production submit profile does not target Hither's App Store Connect app")
    if config["ios"]["bundleIdentifier"] != APP_ID:
        raise ValueError("pinned production app bundle ID does not identify Hither")
    return config


def safe_zip(ipa):
    with zipfile.ZipFile(ipa) as archive:
        names = set()
        for entry in archive.infolist():
            path = PurePosixPath(entry.filename)
            if path.is_absolute() or ".." in path.parts or stat.S_ISLNK(entry.external_attr >> 16):
                raise ValueError("IPA ZIP contains an unsafe archive entry")
            if path in names:
                raise ValueError("IPA ZIP contains duplicate entries")
            names.add(path)
        if archive.testzip() is not None:
            raise ValueError("IPA ZIP failed its integrity check")


def only_directory(parent, pattern):
    matches = [path for path in parent.glob(pattern) if path.is_dir()]
    if len(matches) != 1:
        raise ValueError(f"expected exactly one {pattern} bundle in {parent.name}")
    return matches[0]


def command_check(*command):
    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode:
        raise ValueError(f"{command[0]} failed ({result.returncode}): {result.stderr.strip()}")


def bundle_metadata(app, widget, config):
    app_info = plistlib.loads((app / "Info.plist").read_bytes())
    widget_info = plistlib.loads((widget / "Info.plist").read_bytes())
    updates = plistlib.loads((app / "Expo.plist").read_bytes())
    version = config["version"]
    runtime = config["runtimeVersion"]
    updates_url = config["updates"]["url"]
    build = app_info["CFBundleVersion"]
    if not isinstance(build, str) or not re.fullmatch(r"[0-9]+", build):
        raise ValueError("IPA build number must contain only decimal digits")
    for info, identifier in ((app_info, APP_ID), (widget_info, WIDGET_ID)):
        if info.get("CFBundleIdentifier") != identifier:
            raise ValueError(f"IPA is missing bundle ID {identifier}")
        if (info.get("CFBundleShortVersionString"), info.get("CFBundleVersion")) != (version, build):
            raise ValueError("app and widget versions/build must agree with each other and pinned source")
    if (updates.get("EXUpdatesEnabled") is not True
            or updates.get("EXUpdatesRuntimeVersion") != runtime
            or updates.get("EXUpdatesURL") != updates_url
            or updates.get("EXUpdatesRequestHeaders", {}).get("expo-channel-name") != "production"):
        raise ValueError("IPA updates must be enabled and match the pinned runtime, URL, and production channel")
    return app_info, widget_info, {
        "appBundleId": APP_ID,
        "widgetBundleId": WIDGET_ID,
        "appVersion": version,
        "buildNumber": build,
        "runtimeVersion": runtime,
        "updatesUrl": updates_url,
        "channel": "production",
    }


def verify_ipa(ipa, source_sha, expected_sha, config):
    if not ipa.is_absolute() or not ipa.is_file() or ipa.suffix != ".ipa":
        raise ValueError("--ipa must name an existing absolute .ipa path")
    symbols = runpy.run_path(str(SYMBOL_HELPERS))
    if not IPA_SHA.fullmatch(expected_sha) or symbols["sha256"](ipa) != expected_sha:
        raise ValueError("IPA SHA-256 does not match --sha256")
    safe_zip(ipa)
    with tempfile.TemporaryDirectory(prefix="hither-ipa-") as temporary:
        root = Path(temporary)
        command_check("/usr/bin/ditto", "-x", "-k", str(ipa), str(root))
        app = only_directory(root / "Payload", "*.app")
        widget = only_directory(app / "PlugIns", "*.appex")
        command_check("/usr/bin/codesign", "--verify", "--deep", "--strict", str(app))
        app_info, widget_info, metadata = bundle_metadata(app, widget, config)
        binaries = []
        for bundle, info in ((app, app_info), (widget, widget_info)):
            executable = info["CFBundleExecutable"]
            if not isinstance(executable, str) or executable in {"", ".", ".."} or Path(executable).name != executable:
                raise ValueError("invalid IPA bundle executable name")
            binaries.append({
                "bundleIdentifier": info["CFBundleIdentifier"],
                "executable": executable,
                "uuids": symbols["dwarf_uuids"](bundle / executable),
            })
    if symbols["sha256"](ipa) != expected_sha:
        raise ValueError("IPA changed while it was being verified")
    return {"sourceSha": source_sha, "ipa": str(ipa), "ipaSha256": expected_sha,
            **metadata, "binaries": binaries}


def write_receipt(path, value, *, exclusive=False):
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent, delete=False) as stream:
        temporary = Path(stream.name)
        try:
            json.dump(value, stream, indent=2, sort_keys=True)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
            if exclusive:
                os.link(temporary, path)
            else:
                os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)


def ensure_artifact_receipt(path, verification):
    try:
        write_receipt(path, verification, exclusive=True)
    except FileExistsError:
        prior = json.loads(path.read_text(encoding="utf-8"))
        if any(prior.get(key) != verification[key] for key in RELEASE_IDENTITY):
            raise ValueError("release directory already belongs to a different verified IPA")
        if prior != verification:
            write_receipt(path, verification)


def submission_pattern(config):
    project = f"{re.escape(config['owner'])}/projects/{re.escape(config['slug'])}"
    return re.compile(rf"Submission details: (https://expo\.dev/accounts/{project}/submissions/({UUID}))\s*$", re.MULTILINE)


def parse_submission(log, identity, url_pattern, exit_code=None):
    matches = set(url_pattern.findall(log))
    upload_reported = UPLOAD_SUCCESS in {line.strip() for line in log.splitlines()}
    submission_url, submission_id = next(iter(matches)) if len(matches) == 1 else (None, None)
    status = "unknown"
    if submission_id:
        if upload_reported:
            status = "uploaded"
        elif ("Something went wrong when submitting your app to Apple App Store Connect." in log
                or "The submission has been canceled" in log):
            status = "failed"
        else:
            status = "scheduled"
    return submission_receipt(identity, status, submission_url, submission_id, exit_code)


def submission_receipt(identity, status, submission_url, submission_id, exit_code):
    return {
        **identity,
        "easStatus": status,
        "submissionId": submission_id,
        "submissionUrl": submission_url,
        "easExitCode": exit_code,
        "appStoreConnectUrl": f"https://appstoreconnect.apple.com/apps/{ASC_APP_ID}/testflight/ios",
        "appleProcessing": "unknown",
    }


def load_receipt(path, identity, url_pattern):
    receipt = json.loads(path.read_text(encoding="utf-8"))
    if any(receipt.get(key) != value for key, value in identity.items()):
        raise ValueError(f"{path.name} does not identify this verified IPA")
    status = receipt.get("easStatus")
    if status not in {"uploaded", "scheduled", "failed", "unknown"}:
        raise ValueError(f"{path.name} has no recognized EAS status")
    url_match = url_pattern.fullmatch(f"Submission details: {receipt.get('submissionUrl')}")
    if status != "unknown" and (url_match is None or url_match[2] != receipt.get("submissionId")):
        raise ValueError(f"{path.name} has an invalid Hither EAS submission URL/ID")
    submission_url, submission_id = url_match.groups() if url_match else (None, None)
    exit_code = receipt.get("easExitCode")
    return submission_receipt(identity, status, submission_url, submission_id,
                              exit_code if type(exit_code) is int else None)


def submit_ipa(repo, release_dir, verification, config, existing_receipt=None):
    identity = {key: verification[key] for key in RELEASE_IDENTITY}
    intent_path, log_path, receipt_path = (release_dir / name for name in SUBMISSION_FILES)
    url_pattern = submission_pattern(config)
    if existing_receipt is not None:
        return load_receipt(existing_receipt, identity, url_pattern)
    if receipt_path.exists():
        return load_receipt(receipt_path, identity, url_pattern)
    if intent_path.exists():
        if json.loads(intent_path.read_text(encoding="utf-8")) != identity:
            raise ValueError("submission intent belongs to a different IPA")
        log = log_path.read_text(encoding="utf-8", errors="replace") if log_path.exists() else ""
        return parse_submission(log, identity, url_pattern)
    if log_path.exists():
        raise ValueError(f"{log_path} already exists without an intent; reconcile that upload before submitting")
    if (git(repo, "rev-parse", "HEAD").decode().strip() != identity["sourceSha"]
            or git(repo, "status", "--porcelain", "--untracked-files=normal", "--", "apps/mobile")):
        raise ValueError("submit from the clean mobile checkout at --source-sha")
    npx = shutil.which("npx")
    if npx is None:
        raise ValueError("npx is required for EAS submission")
    require_master_ci(identity["sourceSha"])
    ipa = verification["ipa"]
    if runpy.run_path(str(SYMBOL_HELPERS))["sha256"](Path(ipa)) != identity["ipaSha256"]:
        raise ValueError("IPA changed before EAS submission")

    write_receipt(intent_path, identity, exclusive=True)
    log_fd = os.open(log_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    print(f"Waiting for EAS submission. Private log: {log_path}", file=sys.stderr, flush=True)
    with os.fdopen(log_fd, "wb") as log_stream:
        result = subprocess.run([
            npx, "--yes", EAS_CLI, "submit", "--platform", "ios", "--profile", "production",
            "--path", ipa, "--non-interactive", "--wait",
        ], cwd=repo / "apps/mobile", stdout=log_stream, stderr=subprocess.STDOUT,
            env={**os.environ, "FORCE_COLOR": "0"})
    log = log_path.read_text(encoding="utf-8", errors="replace")
    receipt = parse_submission(log, identity, url_pattern, result.returncode)
    write_receipt(receipt_path, receipt)
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path.cwd(),
                        help="Git checkout containing the pinned source (defaults to the current checkout)")
    parser.add_argument("--source-sha", required=True)
    parser.add_argument("--ipa", type=Path, required=True)
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--release-dir", type=Path, required=True,
                        help="absolute private directory for this IPA's receipts; reuse it when resuming")
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--verify-only", action="store_true")
    mode.add_argument("--submission-receipt", type=Path,
                      help="read a prior submission receipt for the same verified IPA without submitting")
    args = parser.parse_args()

    try:
        repo = Path(os.fsdecode(git(args.repo, "rev-parse", "--show-toplevel").strip()))
        config = read_source(repo, args.source_sha)
        verification = verify_ipa(args.ipa, args.source_sha, args.sha256, config)
        output = release_directory(args.release_dir)
        ensure_artifact_receipt(output / "ipa-receipt.json", verification)
        if args.verify_only:
            print(json.dumps(verification, sort_keys=True))
            return 0
        receipt = submit_ipa(repo, output, verification, config, args.submission_receipt)
        print(json.dumps(receipt, sort_keys=True))
        if receipt["easStatus"] == "uploaded":
            return 0
        print("Upload unconfirmed. Inspect the retained submission evidence before any retry.", file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        print("Interrupted. Keep the release directory and inspect its submission evidence before any retry.", file=sys.stderr)
        return 130
    except (ValueError, OSError, KeyError, TypeError, AttributeError, zipfile.BadZipFile,
            plistlib.InvalidFileException, subprocess.CalledProcessError) as err:
        print(f"iOS IPA release failed: {err}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
