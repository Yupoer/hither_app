#!/usr/bin/env python3
"""Compile a standalone probe from the installed, patched Expo actor implementation."""
import argparse
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument("output", type=Path)
parser.add_argument("--host", action="store_true")
args = parser.parse_args()
mobile = Path(__file__).resolve().parents[1]
source = (mobile / "node_modules/expo-modules-jsi/apple/Sources/ExpoModulesJSI/Runtime/JavaScriptActor.swift").read_text()
# Remove only the adapter requiring a JSI runtime, retaining the actual actor,
# executor and all synchronous-bridge helpers being shipped by patch-package.
start = source.index("/// An actor that is dedicated for the specific runtime.")
end = source.index("// Only `enqueue` writes the captured job;")
probe = source[:start] + source[end:] + (mobile / "scripts/test-jsi-executor.swift").read_text()
args.output.parent.mkdir(parents=True, exist_ok=True)
source_path = args.output.with_suffix(".swift")
source_path.write_text(probe)
command = ["xcrun", "swiftc", "-swift-version", "6", "-parse-as-library", "-module-cache-path", str(args.output.parent / "module-cache"), "-Xfrontend", "-enable-actor-data-race-checks"]
if not args.host:
    sdk = subprocess.check_output(["xcrun", "--sdk", "iphonesimulator", "--show-sdk-path"], text=True).strip()
    command += ["-sdk", sdk, "-target", "arm64-apple-ios17.0-simulator"]
command += [str(source_path), "-o", str(args.output)]
subprocess.run(command, check=True)
print(args.output)
