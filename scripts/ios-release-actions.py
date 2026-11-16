#!/usr/bin/env python3
"""Run an explicitly requested iOS GitHub Actions mode."""

import argparse
import sys

sys.dont_write_bytecode = True
from ios_release import ACTIONS_MODES, add_source_arguments, dispatch, main_guard


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    add_source_arguments(parser)
    parser.add_argument("--mode", choices=ACTIONS_MODES, required=True)
    args = parser.parse_args()
    dispatch(args.mode, args.source_sha, args.release_dir, args.backend_verified)


if __name__ == "__main__":
    sys.exit(main_guard(main))
