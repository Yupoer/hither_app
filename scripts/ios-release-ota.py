#!/usr/bin/env python3
"""Publish an eligible iOS production OTA and retain the verified CD receipt."""

import argparse
import sys

sys.dont_write_bytecode = True
from ios_release import add_source_arguments, dispatch, main_guard


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    add_source_arguments(parser)
    args = parser.parse_args()
    dispatch("ota", args.source_sha, args.release_dir, args.backend_verified)


if __name__ == "__main__":
    sys.exit(main_guard(main))
