import argparse
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import subprocess


def dwarf_uuids(path):
    output = subprocess.check_output(["xcrun", "dwarfdump", "--uuid", str(path)], text=True)
    result = []
    for line in output.splitlines():
        match = re.fullmatch(r"UUID: ([0-9A-Fa-f-]{36}) \(([^)]+)\) .+", line)
        if not match:
            raise ValueError("invalid dwarfdump UUID output")
        result.append({"architecture": match[2], "uuid": match[1].upper()})
    if not result:
        raise ValueError("missing Mach-O UUID")
    return sorted(result, key=lambda row: (row["architecture"], row["uuid"]))


def sha256(path):
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def retain_symbols(archive, app, widget, ipa, output, identity):
    with (app / "Info.plist").open("rb") as stream:
        app_info = plistlib.load(stream)
    with (widget / "Info.plist").open("rb") as stream:
        widget_info = plistlib.load(stream)
    if (widget_info["CFBundleShortVersionString"], widget_info["CFBundleVersion"]) != (
        app_info["CFBundleShortVersionString"], app_info["CFBundleVersion"]
    ):
        raise ValueError("app and widget version/build differ")
    with (app / "Expo.plist").open("rb") as stream:
        updates = plistlib.load(stream)
    manifest = {
        **identity,
        "appVersion": app_info["CFBundleShortVersionString"],
        "build": app_info["CFBundleVersion"],
        "runtimeVersion": updates["EXUpdatesRuntimeVersion"],
        "channel": updates["EXUpdatesRequestHeaders"]["expo-channel-name"],
        "ipaSha256": sha256(ipa),
        "binaries": [],
    }
    selected = []
    for bundle, info in ((app, app_info), (widget, widget_info)):
        executable = info["CFBundleExecutable"]
        uuids = dwarf_uuids(bundle / executable)
        matches = []
        for candidate in sorted((archive / "dSYMs").glob("*.dSYM")):
            dwarf = candidate / "Contents/Resources/DWARF" / executable
            if dwarf.is_file() and dwarf_uuids(dwarf) == uuids:
                matches.append((candidate, dwarf))
        if len(matches) != 1:
            raise ValueError(f"expected one UUID-matched dSYM for {executable}; found {len(matches)}")
        candidate, dwarf = matches[0]
        name = bundle.name + ".dSYM"
        selected.append((candidate, name))
        manifest["binaries"].append({
            "bundleIdentifier": info["CFBundleIdentifier"],
            "executable": executable,
            "dSYM": name,
            "uuids": uuids,
            "dwarfSha256": sha256(dwarf),
        })
    output.mkdir()
    for candidate, name in selected:
        shutil.copytree(candidate, output / name)
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    for name in ("archive", "app", "widget", "ipa", "output"):
        parser.add_argument(f"--{name}", type=Path, required=True)
    args = parser.parse_args()
    retain_symbols(args.archive, args.app, args.widget, args.ipa, args.output, {
        "sourceSha": os.environ["SOURCE_SHA"],
        "runId": os.environ["GITHUB_RUN_ID"],
        "runAttempt": int(os.environ["GITHUB_RUN_ATTEMPT"]),
    })
