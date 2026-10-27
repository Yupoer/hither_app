#!/usr/bin/env python3
"""Reduce read-only EAS output to a public, non-secret release inventory."""

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import sys
from uuid import UUID


SHA = re.compile(r"[0-9a-f]{40}\Z")
METADATA = re.compile(r"[A-Za-z0-9._:+-]{1,128}\Z")


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def optional_text(record, key):
    value = record.get(key)
    return value if isinstance(value, str) and len(value) <= 128 else None


def metadata_text(record, key):
    value = optional_text(record, key)
    return value if value is not None and METADATA.fullmatch(value) else None


def build_candidates(builds):
    if not isinstance(builds, list) or len(builds) > 20:
        raise ValueError("EAS build list must be an array of at most 20 records")
    result = []
    for build in builds:
        if not isinstance(build, dict):
            raise ValueError("EAS build record must be an object")
        if (build.get("platform") != "IOS" or build.get("status") != "FINISHED"
                or build.get("distribution") != "STORE" or build.get("buildProfile") != "production"
                or build.get("isForIosSimulator") is True):
            raise ValueError("EAS build result does not match the production iOS filter")
        simulator = build.get("isForIosSimulator")
        if simulator is not None and simulator is not False:
            raise ValueError("EAS simulator flag must be boolean or null")
        identifier = optional_text(build, "id")
        if not identifier:
            raise ValueError("EAS build ID is missing")
        UUID(identifier)
        source = optional_text(build, "gitCommitHash")
        if source is not None and not SHA.fullmatch(source):
            source = None
        version = metadata_text(build, "appVersion")
        number = optional_text(build, "appBuildVersion")
        if number is not None and not number.isdigit():
            number = None
        runtime = metadata_text(build, "runtimeVersion")
        channel = "production" if build.get("channel") == "production" else None
        completed = optional_text(build, "completedAt")
        if completed:
            try:
                datetime.fromisoformat(completed.replace("Z", "+00:00"))
            except ValueError:
                completed = None
        result.append({
            "buildId": identifier,
            "sourceSha": source,
            "runtimeVersion": runtime,
            "appVersion": version,
            "buildNumber": number,
            "channel": channel,
            "profile": "production",
            "completedAt": completed,
            "easStatus": "FINISHED",
            "simulator": simulator,
            "metadataComplete": bool(source and runtime and version and number
                                     and channel == "production" and simulator is False),
            "appleInstallability": "unknown",
        })
    return result


def production_channel(channel):
    if not isinstance(channel, dict) or not isinstance(channel.get("currentPage"), dict):
        raise ValueError("EAS production channel response is invalid")
    record = channel["currentPage"]
    if record.get("name") != "production":
        raise ValueError("EAS channel is not production")
    branches = record.get("updateBranches")
    if not isinstance(branches, list):
        raise ValueError("EAS channel branches are missing")
    try:
        mapping = json.loads(record["branchMapping"])
    except (KeyError, TypeError, ValueError) as error:
        raise ValueError("EAS branch mapping is invalid") from error
    entries = mapping.get("data") if isinstance(mapping, dict) else None
    unconditional = (mapping.get("version") == 0 and isinstance(entries, list)
                     and len(entries) == 1 and isinstance(entries[0], dict)
                     and len(branches) == 1 and isinstance(branches[0], dict)
                     and branches[0].get("name") == "production"
                     and branches[0].get("id") == entries[0].get("branchId")
                     and entries[0].get("branchMappingLogic") == "true")
    return {
        "active": record.get("isPaused") is False,
        "mapping": "unconditional_production" if unconditional else "conditional_or_unknown",
        "branch": "production" if unconditional else None,
    }


def latest_ios_update(updates, view):
    if not isinstance(updates, dict) or updates.get("name") != "production":
        raise ValueError("EAS update list is not for the production branch")
    groups = updates.get("currentPage")
    if not isinstance(groups, list) or len(groups) > 1:
        raise ValueError("EAS latest update group response is invalid")
    if not groups:
        return None
    group = groups[0]
    if not isinstance(group, dict):
        raise ValueError("EAS update group must be an object")
    identifier = optional_text(group, "group")
    if identifier is None:
        raise ValueError("EAS update group ID is missing")
    UUID(identifier)
    if group.get("branch") != "production" or group.get("platforms") != "IOS":
        raise ValueError("EAS latest update group is not iOS on production")
    runtime = metadata_text(group, "runtimeVersion")
    if view is None:
        source = None
        update_id = None
    else:
        if not isinstance(view, list):
            raise ValueError("EAS update view must be an array")
        ios_updates = [item for item in view if isinstance(item, dict)
                       and str(item.get("platform", "")).upper() == "IOS"]
        if len(ios_updates) != 1 or ios_updates[0].get("group") != identifier:
            raise ValueError("EAS update view does not match latest iOS group")
        record = ios_updates[0]
        if record.get("branch") != "production":
            raise ValueError("EAS update view is not on production")
        if metadata_text(record, "runtimeVersion") != runtime:
            raise ValueError("EAS update view runtime does not match latest group")
        source = optional_text(record, "gitCommitHash")
        if source is not None and not SHA.fullmatch(source):
            source = None
        update_id = optional_text(record, "id")
        if update_id:
            UUID(update_id)
    return {
        "group": identifier,
        "iosUpdateId": update_id,
        "sourceSha": source,
        "runtimeVersion": runtime,
        "branch": "production",
    }


def inventory(builds, channel, updates, view):
    return {
        "queriedAt": datetime.now(timezone.utc).isoformat(),
        "easBuilds": build_candidates(builds),
        "productionChannel": production_channel(channel),
        "latestIosUpdate": latest_ios_update(updates, view),
        "installedBinary": "unknown",
        "appleProcessing": "unknown",
        "note": "EAS build completion and update metadata do not prove TestFlight processing or device installation.",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--builds", required=True)
    parser.add_argument("--channel", required=True)
    parser.add_argument("--updates", required=True)
    parser.add_argument("--view")
    parser.add_argument("--receipt", required=True)
    args = parser.parse_args()
    try:
        result = inventory(read_json(args.builds), read_json(args.channel),
                           read_json(args.updates), read_json(args.view) if args.view else None)
        Path(args.receipt).write_text(json.dumps(result, sort_keys=True) + "\n", encoding="utf-8")
    except (OSError, KeyError, TypeError, ValueError) as error:
        print(f"EAS release inventory unavailable: {error}", file=sys.stderr)
        return 1
    print(f"Sanitized release inventory written to {args.receipt}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
