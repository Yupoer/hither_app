#!/usr/bin/env python3
"""Build and cold-launch the full iOS Release app on a GitHub Xcode runner."""

import argparse
from datetime import datetime, timezone
import hashlib
import importlib.util
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
RUNTIME_LOG_SIGNALS = {"dyld_failure", "uncaught_exception", "fatal_error", "assertion_failure"}
SYSTEM_TERMINATION_SIGNALS = {"jetsam", "watchdog", "codesigning", "process_exit"}
RELEASE_STAGES = {"runner_preflight", "simulator_create", "simulator_boot", "pod_install",
                  "source_equivalence", "xcodebuild", "app_metadata", "cold_launch", "launch_receipt"}


class ReleaseCommandFailure(RuntimeError):
    def __init__(self, command, returncode, output):
        self.returncode = returncode
        detail = f"; see {output}" if output else ""
        super().__init__(f"{command} failed with exit code {returncode}{detail}")


def run(*command, cwd=None, timeout=600, output=None, include_stderr=False):
    if output:
        with Path(output).open("w", encoding="utf-8") as stream:
            result = subprocess.run(command, cwd=cwd, text=True, stdout=stream,
                                    stderr=subprocess.STDOUT, timeout=timeout)
    else:
        result = subprocess.run(command, cwd=cwd, capture_output=True, text=True,
                                timeout=timeout)
    if result.returncode:
        raise ReleaseCommandFailure(command[0], result.returncode, output)
    contents = result.stdout or ""
    if include_stderr and result.stderr:
        contents += "\n" + result.stderr
    return contents.strip()


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


def production_profile_environment(inherited, eas):
    build = eas.get("build") if isinstance(eas, dict) else None
    profile = build.get("production") if isinstance(build, dict) else None
    if not isinstance(profile, dict):
        raise ValueError("production profile must be an object")
    ios = profile.get("ios", {})
    if ("extends" in profile or not isinstance(ios, dict)
            or any(key in ios for key in ("env", "environment", "distribution", "developmentClient"))):
        raise ValueError("production profile inheritance or iOS environment overrides are unsupported")
    distribution = profile.get("distribution", "store")
    development = profile.get("developmentClient", False)
    if (not isinstance(distribution, str) or distribution not in {"store", "internal"}
            or type(development) is not bool):
        raise ValueError("production profile distribution or developmentClient is invalid")
    suggested = "production" if distribution == "store" else "development" if development else "preview"
    if profile.get("environment", suggested) != "production":
        raise ValueError("production profile must select the production environment")
    values = profile.get("env", {})
    if not isinstance(values, dict) or any(not isinstance(value, str) for value in values.values()):
        raise ValueError("production profile env must contain string values")
    return {**inherited, **values}


def mark_stage(diagnostic, stage):
    if stage not in RELEASE_STAGES:
        raise ValueError("unsupported Release stage")
    diagnostic["stage"] = stage
    print(f"hither-ios-release-stage={stage} at={datetime.now(timezone.utc).isoformat()}", flush=True)


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
                         ("lastObservedPhase", BOOT_PHASES | {"other"}),
                         ("exceptionType", {"EXC_BAD_ACCESS", "EXC_CRASH", "EXC_BREAKPOINT",
                                            "EXC_ARITHMETIC", "EXC_BAD_INSTRUCTION", "EXC_GUARD",
                                            "EXC_RESOURCE", "EXC_CORPSE_NOTIFY"}),
                         ("exceptionSignal", {"SIGABRT", "SIGBUS", "SIGILL", "SIGKILL",
                                              "SIGSEGV", "SIGTRAP", "SIGTERM"}),
                         ("crashReportProbe", {"unavailable"}),
                         ("appProcessState", {"original_pid", "replacement_pid", "absent",
                                              "unavailable"}),
                         ("simulatorState", {"booted", "shutdown", "other", "unavailable"}),
                         ("systemLogProbe", {"available", "unavailable"}),
                         ("processExitProbe", {"observed", "not_observed", "unavailable"}),
                         ("consoleProbe", {"available", "unavailable"}),
                         ("runtimeLogProbe", {"available", "unavailable"})):
        value = payload.get(key)
        if isinstance(value, str) and value in choices:
            safe[key] = value
    if type(payload.get("attempt")) is int and payload["attempt"] in (1, 2):
        safe["attempt"] = payload["attempt"]
    for key in ("processAlive", "hostPidAliveAtLaunch", "crashReportFound"):
        if type(payload.get(key)) is bool:
            safe[key] = payload[key]
    if payload.get("crashReportFound") is True and isinstance(payload.get("crashFrames"), list):
        try:
            frames = load_debugger_helper().safe_result({
                "scope": "diagnostic_replay", "probe": "stopped", "frames": payload["crashFrames"],
            }).get("frames")
            if frames:
                safe["crashFrames"] = frames
        except Exception:
            pass
    if safe.get("processExitProbe") == "observed":
        during = payload.get("appExitObservedDuring")
        if isinstance(during, str) and during in {"launch_observation", "failure_collection"}:
            safe["appExitObservedDuring"] = during
        kind = payload.get("appExitKind")
        if isinstance(kind, str) and kind in {"exited", "signaled", "unknown"}:
            safe["appExitKind"] = kind
        else:
            kind = None
        key = {"exited": "appExitCode", "signaled": "appExitSignal"}.get(kind)
        code = payload.get(key)
        if key and type(code) is int and (0 <= code <= 255 if kind == "exited" else 1 <= code <= 127):
            safe[key] = code
        details = payload.get("appExitDetails")
        if (isinstance(details, list) and all(isinstance(item, str)
                and item in {"memory", "code_signing", "decryption"} for item in details)):
            safe["appExitDetails"] = sorted(set(details))
    if safe.get("consoleProbe") == "available":
        signals = payload.get("consoleSignals")
        if isinstance(signals, list) and all(isinstance(item, str)
                and item in RUNTIME_LOG_SIGNALS for item in signals):
            safe["consoleSignals"] = sorted(set(signals))
        if type(payload.get("consoleTruncated")) is bool:
            safe["consoleTruncated"] = payload["consoleTruncated"]
    code = payload.get("simctlExitCode")
    if type(code) is int and 1 <= code <= 255:
        safe["simctlExitCode"] = code
    code = payload.get("terminationCode")
    if type(code) is int and 0 <= code < 2**64:
        safe["terminationCode"] = code
    namespace = payload.get("terminationNamespace")
    if isinstance(namespace, str) and re.fullmatch(r"[A-Z][A-Z0-9_]{0,31}", namespace):
        safe["terminationNamespace"] = namespace
    module = payload.get("faultingModule")
    if isinstance(module, str) and re.fullmatch(r"[A-Za-z][A-Za-z0-9_.+-]{0,63}", module):
        safe["faultingModule"] = module
    for key in ("faultingModules", "lastExceptionModules"):
        modules = payload.get(key)
        if (isinstance(modules, list) and len(modules) <= 8
                and all(isinstance(module, str)
                        and re.fullmatch(r"[A-Za-z][A-Za-z0-9_.+-]{0,63}", module)
                        for module in modules)):
            safe[key] = modules
    signals = payload.get("runtimeLogSignals")
    if isinstance(signals, list) and all(isinstance(item, str) and item in RUNTIME_LOG_SIGNALS
                                         for item in signals):
        safe["runtimeLogSignals"] = sorted(set(signals))
    signals = payload.get("systemTerminationSignals")
    if isinstance(signals, list) and all(isinstance(item, str)
                                         and item in SYSTEM_TERMINATION_SIGNALS
                                         for item in signals):
        safe["systemTerminationSignals"] = sorted(set(signals))
    signals = payload.get("pidCorrelatedSystemSignals")
    if isinstance(signals, list) and all(isinstance(item, str)
                                         and item in SYSTEM_TERMINATION_SIGNALS
                                         for item in signals):
        safe["pidCorrelatedSystemSignals"] = sorted(set(signals))
    window = payload.get("systemLogWindowSeconds")
    if type(window) is int and 0 <= window <= 120:
        safe["systemLogWindowSeconds"] = window
    return safe


def load_debugger_helper():
    path = MOBILE / "scripts/ios_launch_debugger.py"
    spec = importlib.util.spec_from_file_location("hither_launch_debugger", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def read_debugger_summary(path, helper=None):
    unavailable = {"scope": "diagnostic_replay", "probe": "unavailable"}
    try:
        if path.stat().st_size > 65536:
            return unavailable
        helper = helper or load_debugger_helper()
        return helper.safe_result(json.loads(path.read_text(encoding="utf-8"))) or unavailable
    except Exception:
        return unavailable


def collect_failure_replay(app, simulator, build, output):
    unavailable = {"scope": "diagnostic_replay", "probe": "unavailable"}
    try:
        original = output / "launch-result.json"
        if original.stat().st_size > 65536:
            return unavailable
        payload = json.loads(original.read_text(encoding="utf-8"))
        helper = load_debugger_helper()
        if not helper.eligible_failure(payload, build):
            return None
        replay = output / "diagnostic-replay"
        print("hither-ios-release-diagnostic=replay", flush=True)
        try:
            run(sys.executable, str(MOBILE / "scripts/ios_launch_debugger.py"), "replay",
                "--app", str(app), "--simulator", simulator, "--build", build,
                "--original-result", str(original), "--output", str(replay),
                timeout=120, output=output / "debugger-replay-run.log")
        except (OSError, ReleaseCommandFailure, subprocess.TimeoutExpired):
            pass
        return read_debugger_summary(replay / "replay-result.json", helper)
    except Exception:
        return unavailable


def main(diagnostic):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-sha", required=True)
    parser.add_argument("--receipt", type=Path, required=True)
    args = parser.parse_args()
    if not SOURCE_SHA.fullmatch(args.source_sha):
        raise ValueError("source SHA must be a full lowercase Git commit")
    os.environ.update(production_profile_environment(
        os.environ, json.loads((MOBILE / "eas.json").read_text(encoding="utf-8"))))
    require_production_environment(os.environ)
    mark_stage(diagnostic, "runner_preflight")
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
    launch_help = run("xcrun", "simctl", "help", "launch", timeout=15, include_stderr=True)
    if not all(flag in launch_help for flag in ("--stdout", "--stderr")):
        raise RuntimeError("simctl launch must support stdout/stderr capture")
    run(sys.executable, str(MOBILE / "scripts/verify-ios-release-launch.py"),
        "--check-exit-observer", timeout=20)
    debugger_check = runner_temp / "hither-debugger-check"
    try:
        run(sys.executable, str(MOBILE / "scripts/ios_launch_debugger.py"), "check",
            "--output", str(debugger_check), timeout=120,
            output=runner_temp / "hither-debugger-check.log")
    except (ReleaseCommandFailure, subprocess.TimeoutExpired):
        diagnostic["debuggerCheck"] = read_debugger_summary(debugger_check / "replay-result.json")
        raise
    runtime = select_ios_27_runtime(json.loads(run("xcrun", "simctl", "list", "runtimes", "--json")))
    app_config = json.loads((MOBILE / "app.json").read_text(encoding="utf-8"))["expo"]
    output = runner_temp / "hither-release-launch"
    output.mkdir(exist_ok=False)
    mark_stage(diagnostic, "simulator_create")
    simulator = run("xcrun", "simctl", "create", f"Hither-Release-{args.source_sha[:8]}",
                    "com.apple.CoreSimulator.SimDeviceType.iPhone-12-Pro", runtime["identifier"])
    UUID(simulator)
    mark_stage(diagnostic, "simulator_boot")
    run("xcrun", "simctl", "boot", simulator, timeout=300)
    run("xcrun", "simctl", "bootstatus", simulator, "-b", timeout=600)
    mark_stage(diagnostic, "pod_install")
    run("pod", "install", "--deployment", cwd=MOBILE / "ios", timeout=1800,
        output=output / "pod-install.log")
    mark_stage(diagnostic, "source_equivalence")
    verify_ios_source_equivalence()
    derived = runner_temp / "hither-release-derived"
    plist = MOBILE / "ios/Hither/Supporting/Expo.plist"
    original_plist = plist.read_bytes()
    try:
        mark_stage(diagnostic, "xcodebuild")
        plist.write_bytes(production_simulator_plist(original_plist))
        run("xcodebuild", "-workspace", str(MOBILE / "ios/Hither.xcworkspace"),
            "-scheme", "Hither", "-configuration", "Release", "-sdk", "iphonesimulator",
            "-destination", f"platform=iOS Simulator,id={simulator}",
            "-derivedDataPath", str(derived), "CODE_SIGNING_ALLOWED=NO", "build",
            cwd=MOBILE, timeout=5400, output=output / "xcodebuild.log")
    finally:
        plist.write_bytes(original_plist)
    mark_stage(diagnostic, "app_metadata")
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
    mark_stage(diagnostic, "cold_launch")
    try:
        run(sys.executable, str(MOBILE / "scripts/verify-ios-release-launch.py"),
            "--app", str(app), "--simulator", simulator, "--build", build,
            "--output", str(output), cwd=MOBILE, timeout=300,
            output=output / "cold-launch-run.log")
    except ReleaseCommandFailure:
        replay = collect_failure_replay(app, simulator, build, output)
        if replay is not None:
            diagnostic["diagnosticReplay"] = replay
        raise
    launch = json.loads((output / "launch-result.json").read_text(encoding="utf-8"))
    mark_stage(diagnostic, "launch_receipt")
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
            diagnostic["commandExitCode"] = error.returncode
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
