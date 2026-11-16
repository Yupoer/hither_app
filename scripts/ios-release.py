#!/usr/bin/env python3
"""Choose the iOS release route from a clean, pinned checkout."""

import argparse
import json
import subprocess
import sys

sys.dont_write_bytecode = True
from ios_release import ROOT, add_source_arguments, main_guard, release_plan, require_pinned_checkout


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    add_source_arguments(parser, release_dir_required=False)
    parser.add_argument("--execute", action="store_true", help="Start the route selected by the plan.")
    parser.add_argument("--simulator", help="Booted simulator UDID for the Mac route.")
    args = parser.parse_args()
    require_pinned_checkout(args.source_sha)
    plan = release_plan(args.source_sha)
    print(json.dumps(plan, indent=2, sort_keys=True), flush=True)
    route = plan["route"]
    if not args.execute or route == "none":
        return 0
    if args.release_dir is None:
        parser.error("--execute requires --release-dir")
    command = [sys.executable, "-B", f"scripts/ios-release-{route}.py", "--source-sha", args.source_sha,
               "--release-dir", str(args.release_dir)]
    if route == "ota" and args.backend_verified:
        command.append("--backend-verified")
    if route == "local" and args.simulator:
        command.extend(("--simulator", args.simulator))
    return subprocess.run(command, cwd=ROOT).returncode


if __name__ == "__main__":
    sys.exit(main_guard(main))
