#!/usr/bin/env python3
"""Build and cold-launch the full iOS Release app on a GitHub Xcode runner."""

import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import subprocess
import sys
from urllib.parse import urlparse
from uuid import UUID


REPO = Path(__file__).resolve().parents[1]
MOBILE = REPO / "apps/mobile"
SOURCE_SHA = re.compile(r"[0-9a-f]{40}\Z")
BOOT_PHASES = {"session_resolved", "navigation_ready", "stable"}
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
PRIVACY_PATH = Path("apps/mobile/ios/Hither/PrivacyInfo.xcprivacy")
LAUNCH_FAILURE_STAGES = {"install", "launch", "app_container", "startup_breadcrumb", "screenshot"}
LAUNCH_FAILURE_TYPES = {"AssertionError", "CommandFailure", "FileNotFoundError",
                        "InvalidFileException", "OSError", "PermissionError",
                        "ProcessLookupError", "ValueError"}


class ReleaseCommandFailure(RuntimeError):
    def __init__(self, command, returncode, output):
        self.returncode = returncode
        detail = f"; see {output}" if output else ""
        super().__init__(f"{command} failed with exit code {returncode}{detail}")


def run(*command, cwd=None, timeout=600, output=None):
    if output:
        with Path(output).open("w", encoding="utf-8") as stream:
            result = subprocess.run(command, cwd=cwd, text=True, stdout=stream,
                                    stderr=subprocess.STDOUT, timeout=timeout)
    else:
        result = subprocess.run(command, cwd=cwd, capture_output=True, text=True,
                                timeout=timeout)
    if result.returncode:
        raise ReleaseCommandFailure(command[0], result.returncode, output)
    return result.stdout.strip() if result.stdout else ""


def valid_legal_url(value):
    try:
        parsed = urlparse(value)
    except ValueError:
        return False
    return (parsed.scheme == "https" and bool(parsed.hostname)
            and not re.search(r"example\.(?:com|org)|placeholder|__", value, re.I))


def require_production_environment(environment):
    if environment.get("EAS_BUILD_PROFILE") != "production":
        raise ValueError("EAS_BUILD_PROFILE=production is required")
    for name in ("EXPO_PUBLIC_PRIVACY_URL", "EXPO_PUBLIC_TERMS_URL"):
        if not valid_legal_url(environment.get(name, "")):
            raise ValueError(f"A production HTTPS {name} is required")


def select_ios_27_runtime(payload):
    runtimes = payload.get("runtimes")
    if not isinstance(runtimes, list):
        raise ValueError("simctl runtime list is missing")
    matches = [runtime for runtime in runtimes
               if runtime.get("isAvailable") is True
               and runtime.get("identifier", "").endswith("iOS-27-0")
               and runtime.get("version", "").split(".")[:2] == ["27", "0"]]
    if len(matches) != 1:
        raise ValueError("exactly one available iOS 27.0 simulator runtime is required")
    return matches[0]


def production_simulator_plist(contents):
    updates = plistlib.loads(contents)
    headers = updates.get("EXUpdatesRequestHeaders", {})
    if not isinstance(headers, dict) or headers.get("expo-channel-name") not in (None, "production"):
        raise ValueError("Release simulator app has a non-production update channel")
    updates["EXUpdatesRequestHeaders"] = {**headers, "expo-channel-name": "production"}
    return plistlib.dumps(updates)


def privacy_disclosures(contents):
    try:
        data = plistlib.loads(contents)
        categories = data["NSPrivacyAccessedAPITypes"]
        if not isinstance(data, dict) or not isinstance(categories, list):
            raise ValueError("invalid privacy disclosures")
        names = [entry["NSPrivacyAccessedAPIType"] for entry in categories]
        if any(not isinstance(name, str) for name in names) or len(names) != len(set(names)):
            raise ValueError("invalid privacy API categories")
        return {**data, "NSPrivacyAccessedAPITypes": sorted(
            categories, key=lambda entry: entry["NSPrivacyAccessedAPIType"])}
    except (KeyError, TypeError, ValueError) as error:
        raise RuntimeError("iOS privacy disclosures are invalid") from error


def verify_ios_source_equivalence(repo=REPO):
    changed = run("git", "diff", "--name-only", "HEAD", "--", "apps/mobile/ios",
                  cwd=repo).splitlines()
    if not changed:
        return
    if changed != [PRIVACY_PATH.as_posix()]:
        run("git", "diff", "--exit-code", "HEAD", "--", "apps/mobile/ios", cwd=repo)
    if run("git", "diff", "--summary", "HEAD", "--", "apps/mobile/ios", cwd=repo):
        raise RuntimeError("pod install changed iOS file metadata")
    original = run("git", "show", f"HEAD:{PRIVACY_PATH.as_posix()}", cwd=repo).encode()
    generated = (repo / PRIVACY_PATH).read_bytes()
    if plistlib.dumps(privacy_disclosures(original)) != plistlib.dumps(privacy_disclosures(generated)):
        raise RuntimeError("pod install changed iOS privacy disclosures")


def receipt_from_launch(source_sha, app_version, build, runtime, simulator, result, output_dir):
    if (result.get("passed") is not True or result.get("build") != build
            or result.get("bundleId") != "app.hither.mobile"
            or len(result.get("launches", [])) != 2):
        raise ValueError("full Release cold-launch verification did not pass twice")
    launches = []
    for attempt, launch in enumerate(result["launches"], 1):
        screenshot = output_dir / f"cold-start-{attempt}.png"
        if (launch.get("phase") not in BOOT_PHASES
                or Path(launch.get("screenshot", "")).resolve() != screenshot.resolve()
                or not isinstance(launch.get("pid"), int)):
            raise ValueError("cold-launch evidence is incomplete")
        contents = screenshot.read_bytes()
        if len(contents) <= len(PNG_MAGIC) or not contents.startswith(PNG_MAGIC):
            raise ValueError("cold-launch screenshot is missing or invalid")
        launches.append({"attempt": attempt, "phase": launch["phase"],
                         "screenshotSha256": hashlib.sha256(contents).hexdigest(),
                         "screenshotBytes": len(contents)})
    return {"sourceSha": source_sha, "appVersion": app_version, "simulatorBuild": build,
            "simulatorId": simulator, "runtimeId": runtime["identifier"],
            "runtimeBuild": runtime["buildversion"], "launches": launches,
            "validationScope": "source_equivalent_release_simulator",
            "visualReview": "pending", "deviceAcceptance": "not_verified",
            "verifiedAt": datetime.now(timezone.utc).isoformat()}


def safe_launch_diagnostic(payload):
    if not isinstance(payload, dict):
        return {}
    safe = {}
    for key, choices in (("failureStage", LAUNCH_FAILURE_STAGES),
                         ("failureType", LAUNCH_FAILURE_TYPES),
                         ("lastObservedPhase", BOOT_PHASES | {"other"})):
        value = payload.get(key)
        if isinstance(value, str) and value in choices:
            safe[key] = value
    if type(payload.get("attempt")) is int and payload["attempt"] in (1, 2):
        safe["attempt"] = payload["attempt"]
    if type(payload.get("processAlive")) is bool:
        safe["processAlive"] = payload["processAlive"]
    code = payload.get("simctlExitCode")
    if type(code) is int and 1 <= code <= 255:
        safe["simctlExitCode"] = code
    return safe


def main(diagnostic):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-sha", required=True)
    parser.add_argument("--receipt", type=Path, required=True)
    args = parser.parse_args()
    if not SOURCE_SHA.fullmatch(args.source_sha):
        raise ValueError("source SHA must be a full lowercase Git commit")
    require_production_environment(os.environ)
    diagnostic["stage"] = "runner_preflight"
    runner_temp = Path(os.environ["RUNNER_TEMP"]).resolve()
    receipt = args.receipt.resolve()
    receipt.relative_to(runner_temp)
    if run("git", "rev-parse", "HEAD", cwd=REPO) != args.source_sha:
        raise ValueError("checkout does not match the pinned source SHA")
    if not shutil.which("pod"):
        raise RuntimeError("CocoaPods is required on the Xcode runner")
    pod_version = run("pod", "--version").splitlines()[-1].strip()
    lock = (MOBILE / "ios/Podfile.lock").read_text(encoding="utf-8")
    if pod_version != "1.16.2" or not lock.rstrip().endswith("COCOAPODS: 1.16.2"):
        raise RuntimeError("CocoaPods 1.16.2 must match the checked-in Podfile.lock")
    xcode = run("xcodebuild", "-version")
    if not re.search(r"^Xcode 27\.0(?:\.[0-9]+)?$", xcode, re.M):
        raise RuntimeError("Xcode 27.0 is required for the Release launch gate")
    runtime = select_ios_27_runtime(json.loads(run("xcrun", "simctl", "list", "runtimes", "--json")))
    app_config = json.loads((MOBILE / "app.json").read_text(encoding="utf-8"))["expo"]
    output = runner_temp / "hither-release-launch"
    output.mkdir(exist_ok=False)
    diagnostic["stage"] = "simulator_create"
    simulator = run("xcrun", "simctl", "create", f"Hither-Release-{args.source_sha[:8]}",
                    "com.apple.CoreSimulator.SimDeviceType.iPhone-12-Pro", runtime["identifier"])
    UUID(simulator)
    diagnostic["stage"] = "simulator_boot"
    run("xcrun", "simctl", "boot", simulator, timeout=300)
    run("xcrun", "simctl", "bootstatus", simulator, "-b", timeout=600)
    diagnostic["stage"] = "pod_install"
    run("pod", "install", "--deployment", cwd=MOBILE / "ios", timeout=1800,
        output=output / "pod-install.log")
    diagnostic["stage"] = "source_equivalence"
    verify_ios_source_equivalence()
    derived = runner_temp / "hither-release-derived"
    plist = MOBILE / "ios/Hither/Supporting/Expo.plist"
    original_plist = plist.read_bytes()
    try:
        diagnostic["stage"] = "xcodebuild"
        plist.write_bytes(production_simulator_plist(original_plist))
        run("xcodebuild", "-workspace", str(MOBILE / "ios/Hither.xcworkspace"),
            "-scheme", "Hither", "-configuration", "Release", "-sdk", "iphonesimulator",
            "-destination", f"platform=iOS Simulator,id={simulator}",
            "-derivedDataPath", str(derived), "CODE_SIGNING_ALLOWED=NO", "build",
            cwd=MOBILE, timeout=5400, output=output / "xcodebuild.log")
    finally:
        plist.write_bytes(original_plist)
    diagnostic["stage"] = "app_metadata"
    verify_ios_source_equivalence()
    app = derived / "Build/Products/Release-iphonesimulator/Hither.app"
    with (app / "Info.plist").open("rb") as handle:
        info = plistlib.load(handle)
    with (app / "Expo.plist").open("rb") as handle:
        updates = plistlib.load(handle)
    if (info.get("CFBundleIdentifier") != "app.hither.mobile"
            or info.get("CFBundleShortVersionString") != app_config["version"]
            or info.get("CFBundleSupportedPlatforms") != ["iPhoneSimulator"]
            or updates.get("EXUpdatesEnabled") is not True
            or updates.get("EXUpdatesRuntimeVersion") != app_config["runtimeVersion"]
            or updates.get("EXUpdatesURL") != app_config["updates"]["url"]):
        raise ValueError("Release simulator app metadata does not match production source")
    headers = updates.get("EXUpdatesRequestHeaders", {})
    if not isinstance(headers, dict) or headers.get("expo-channel-name") != "production":
        raise ValueError("Release simulator app does not embed the production update channel")
    build = str(info["CFBundleVersion"])
    diagnostic["stage"] = "cold_launch"
    run(sys.executable, str(MOBILE / "scripts/verify-ios-release-launch.py"),
        "--app", str(app), "--simulator", simulator, "--build", build,
        "--output", str(output), cwd=MOBILE, timeout=300,
        output=output / "cold-launch-run.log")
    launch = json.loads((output / "launch-result.json").read_text(encoding="utf-8"))
    diagnostic["stage"] = "launch_receipt"
    data = receipt_from_launch(args.source_sha, app_config["version"], build,
                               runtime, simulator, launch, output)
    receipt.write_text(json.dumps(data, sort_keys=True) + "\n", encoding="utf-8")
    print(f"Full Release simulator cold launch passed twice; receipt: {receipt}")


if __name__ == "__main__":
    diagnostic = {"stage": "arguments"}
    try:
        main(diagnostic)
    except (KeyError, OSError, ValueError, RuntimeError, subprocess.TimeoutExpired) as error:
        diagnostic["failureType"] = type(error).__name__
        if isinstance(error, ReleaseCommandFailure):
            diagnostic["exitCode"] = error.returncode
        if isinstance(error, subprocess.TimeoutExpired):
            diagnostic["timeoutSeconds"] = error.timeout
        output = Path(os.environ.get("RUNNER_TEMP", "")) / "hither-release-launch/launch-result.json"
        if diagnostic["stage"] == "cold_launch" and output.is_file():
            try:
                diagnostic.update(safe_launch_diagnostic(json.loads(output.read_text(encoding="utf-8"))))
            except (OSError, ValueError):
                pass
        temp = os.environ.get("RUNNER_TEMP")
        if temp:
            (Path(temp) / "hither-release-launch-diagnostic.json").write_text(
                json.dumps(diagnostic, sort_keys=True) + "\n", encoding="utf-8")
        print(f"iOS Release launch gate failed: {error}", file=sys.stderr)
        sys.exit(1)
