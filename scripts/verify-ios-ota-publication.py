#!/usr/bin/env python3
"""Check that an EAS iOS update reached the production channel."""

import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import sys
from uuid import UUID


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


def production_branch(channel):
    record = channel["currentPage"]
    branches = record["updateBranches"]
    if (record.get("name") != "production" or record.get("isPaused") is not False
            or len(branches) != 1 or branches[0].get("name") != "production"):
        raise ValueError("production channel must be active and map only to production")
    return branches[0]


def published_ios_update(published, source_sha, runtime):
    if not isinstance(published, list) or len(published) != 1:
        raise ValueError("expected exactly one published iOS update")
    update = published[0]
    if (str(update.get("platform", "")).lower() != "ios"
            or update.get("branch") != "production"
            or update.get("runtimeVersion") != runtime
            or update.get("gitCommitHash") != source_sha
            or update.get("message") != f"hither release {source_sha}"
            or update.get("isRollBackToEmbedded") is not False):
        raise ValueError("published update does not match the pinned iOS release")
    try:
        UUID(update["group"])
        UUID(update["id"])
    except (KeyError, TypeError, ValueError) as error:
        raise ValueError("published update is missing valid IDs") from error
    return update


def verify_readback(published, viewed, channel):
    if not isinstance(viewed, list) or len(viewed) != 1:
        raise ValueError("expected exactly one iOS update in remote readback")
    expected = published[0]
    actual = viewed[0]
    fields = ("id", "group", "branch", "runtimeVersion", "platform", "gitCommitHash", "message")
    if any(actual.get(field) != expected.get(field) for field in fields):
        raise ValueError("remote update readback differs from the published update")
    branch = production_branch(channel)
    groups = branch.get("updateGroups", [])
    if not groups or groups[0].get("group") != expected["group"]:
        raise ValueError("production channel does not point to the new update group")
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
