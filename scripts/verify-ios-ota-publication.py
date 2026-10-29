#!/usr/bin/env python3
"""Check that an EAS iOS update reached the production channel."""

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import sys
from uuid import UUID


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def require_uuid(value):
    if not isinstance(value, str):
        raise ValueError("update and branch IDs must be UUID strings")
    UUID(value)


def production_branch(channel):
    if not isinstance(channel, dict) or not isinstance(channel.get("currentPage"), dict):
        raise ValueError("production channel record is invalid")
    record = channel["currentPage"]
    branches = record.get("updateBranches")
    if (record.get("name") != "production" or record.get("isPaused") is not False
            or not isinstance(branches, list) or len(branches) != 1
            or not isinstance(branches[0], dict) or branches[0].get("name") != "production"):
        raise ValueError("production channel must be active and map only to production")
    require_uuid(branches[0]["id"])
    mapping = json.loads(record["branchMapping"])
    if not isinstance(mapping, dict):
        raise ValueError("production channel branch mapping is invalid")
    entries = mapping.get("data")
    if (mapping.get("version") != 0 or not isinstance(entries, list)
            or len(entries) != 1 or not isinstance(entries[0], dict)
            or entries[0].get("branchId") != branches[0].get("id")
            or entries[0].get("branchMappingLogic") != "true"):
        raise ValueError("production channel must unconditionally serve its production branch")
    return branches[0]


def published_ios_update(published, source_sha, runtime):
    if not re.fullmatch(r"[0-9a-f]{40}", source_sha) or not runtime:
        raise ValueError("a pinned source SHA and runtime are required")
    if not isinstance(published, list) or len(published) != 1:
        raise ValueError("expected exactly one published iOS update")
    update = published[0]
    if (not isinstance(update, dict) or str(update.get("platform", "")).lower() != "ios"
            or update.get("branch") != "production"
            or update.get("runtimeVersion") != runtime
            or update.get("gitCommitHash") != source_sha
            or update.get("message") != f"hither release {source_sha}"
            or update.get("isRollBackToEmbedded") is not False):
        raise ValueError("published update does not match the pinned iOS release")
    try:
        require_uuid(update["group"])
        require_uuid(update["id"])
    except (KeyError, TypeError, ValueError) as error:
        raise ValueError("published update is missing valid IDs") from error
    return update


def latest_channel_ios_update(branch):
    groups = branch.get("updateGroups")
    if (not isinstance(groups, list) or not groups
            or not isinstance(groups[0], list) or not groups[0]):
        raise ValueError("production channel latest update group is invalid")
    ios = []
    group_ids = set()
    for update in groups[0]:
        if not isinstance(update, dict) or update.get("platform") not in ("IOS", "ios", "ANDROID", "android"):
            raise ValueError("production channel update platform is invalid")
        require_uuid(update["id"])
        require_uuid(update["group"])
        group_ids.add(update["group"])
        raw_branch = update.get("branch")
        if (not isinstance(raw_branch, dict) or raw_branch.get("id") != branch["id"]
                or raw_branch.get("name") != "production"):
            raise ValueError("production channel update branch is invalid")
        if update["platform"].lower() == "ios":
            ios.append(update)
    if len(group_ids) != 1 or len(ios) != 1:
        raise ValueError("production channel latest group must contain exactly one iOS update")
    return ios[0]


def verify_readback(published, viewed, channel):
    expected = published[0]
    actual = published_ios_update(viewed, expected["gitCommitHash"], expected["runtimeVersion"])
    fields = ("id", "group", "branch", "runtimeVersion", "gitCommitHash", "message", "isRollBackToEmbedded")
    if any(actual.get(field) != expected.get(field) for field in fields):
        raise ValueError("remote update readback differs from the published update")
    latest = latest_channel_ios_update(production_branch(channel))
    fields = ("id", "group", "runtimeVersion", "gitCommitHash", "message", "isRollBackToEmbedded")
    if (latest.get("isRollBackToEmbedded") is not False
            or any(latest.get(field) != expected.get(field) for field in fields)):
        raise ValueError("production channel does not serve the exact published iOS update")
    return expected


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="stage", required=True)
    before = sub.add_parser("before")
    before.add_argument("--channel", required=True)
    published = sub.add_parser("published")
    published.add_argument("--published", required=True)
    published.add_argument("--source-sha", required=True)
    published.add_argument("--runtime", required=True)
    after = sub.add_parser("after")
    after.add_argument("--published", required=True)
    after.add_argument("--view", required=True)
    after.add_argument("--channel", required=True)
    after.add_argument("--source-sha", required=True)
    after.add_argument("--runtime", required=True)
    after.add_argument("--receipt", required=True)
    args = parser.parse_args()
    try:
        if args.stage == "before":
            production_branch(read_json(args.channel))
            print("Production channel routes only to the active production branch")
        elif args.stage == "published":
            update = published_ios_update(read_json(args.published), args.source_sha, args.runtime)
            print(update["group"])
        else:
            sent = read_json(args.published)
            published_ios_update(sent, args.source_sha, args.runtime)
            update = verify_readback(sent, read_json(args.view), read_json(args.channel))
            receipt = {
                "sourceSha": args.source_sha,
                "channel": "production",
                "branch": "production",
                "runtimeVersion": args.runtime,
                "group": update["group"],
                "iosUpdateId": update["id"],
                "verifiedAt": datetime.now(timezone.utc).isoformat(),
            }
            Path(args.receipt).write_text(json.dumps(receipt, sort_keys=True) + "\n", encoding="utf-8")
    except (KeyError, OSError, TypeError, ValueError, json.JSONDecodeError) as error:
        print(f"OTA publication verification failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
