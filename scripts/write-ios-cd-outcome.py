#!/usr/bin/env python3
"""Save allowlisted evidence for one iOS CD job attempt. Performs no release actions."""

import argparse
import json
import os
from pathlib import Path
import re
import sys
import tempfile


MODES = {"inspect-release", "preflight", "validate-release", "ota", "build-only", "submit"}
PHASES = {"dispatch", "setup", "ci_admission", "backend_prerequisite", "inventory",
          "ota_compatibility", "ota_publication", "ota_readback", "release_launch",
          "signed_build", "ipa_verification", "eas_upload", "apple_processing", "device_acceptance"}
STATUSES = {"not_run", "passed", "failed", "unknown"}
MUTATIONS = {"ota_publication", "signed_build", "eas_upload"}
IDENTITY_KEYS = {"sourceSha", "runId", "runAttempt", "mode"}
KEYS = IDENTITY_KEYS | {"phase", "status"}


def attempt_identity(environment):
    source = environment.get("SOURCE_SHA", "")
    run_id = environment.get("GITHUB_RUN_ID", "")
    attempt = environment.get("GITHUB_RUN_ATTEMPT", "")
    mode = environment.get("RELEASE_MODE", "")
    if (not re.fullmatch(r"[0-9a-f]{40}", source) or mode not in MODES
            or not re.fullmatch(r"[1-9][0-9]*", run_id)
            or not re.fullmatch(r"[1-9][0-9]*", attempt)):
        raise ValueError("invalid attempt identity")
    return {"sourceSha": source, "runId": run_id, "runAttempt": int(attempt), "mode": mode}


def validate_event(event, identity):
    if (not isinstance(event, dict) or set(event) != KEYS
            or type(event.get("runAttempt")) is not int
            or any(event[key] != identity[key] for key in IDENTITY_KEYS)
            or event.get("phase") not in PHASES or event.get("status") not in STATUSES):
        raise ValueError("invalid journal event")


def read_events(journal, identity):
    if not journal.exists():
        return []
    if journal.stat().st_size > 131072:
        raise ValueError("journal is too large")
    events = [json.loads(line) for line in journal.read_text(encoding="utf-8").splitlines()]
    if len(events) > 200:
        raise ValueError("too many journal events")
    for event in events:
        validate_event(event, identity)
    return events


def atomic_write(path, contents, exclusive=False):
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent,
                                     prefix=".hither-cd-", delete=False) as stream:
        temporary = Path(stream.name)
        try:
            stream.write(contents)
            stream.flush()
            os.fsync(stream.fileno())
        except BaseException:
            temporary.unlink(missing_ok=True)
            raise
    try:
        if exclusive:
            os.link(temporary, path)
        else:
            os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


def record_outcome(journal, identity, phase, status, intent=None):
    event = {**identity, "phase": phase, "status": status}
    validate_event(event, identity)
    if intent is not None and (phase not in MUTATIONS or status != "unknown"):
        raise ValueError("intent must describe an unknown mutation")
    events = read_events(journal, identity)
    if not events or events[-1] != event:
        events.append(event)
    if len(events) > 200:
        raise ValueError("too many journal events")
    atomic_write(journal, "".join(json.dumps(item, sort_keys=True) + "\n" for item in events))
    if intent is not None:
        atomic_write(intent, json.dumps(event, sort_keys=True) + "\n", exclusive=True)
    return event


def finalize(journal, identity, job_status, outcome):
    if job_status not in {"success", "failure", "cancelled"}:
        raise ValueError("invalid job status")
    events = read_events(journal, identity)
    last = events[-1] if events else None
    if last is None:
        last = record_outcome(journal, identity, "dispatch", "failed")
    elif job_status != "success":
        if last["status"] == "unknown":
            status = "unknown" if last["phase"] in MUTATIONS or job_status == "cancelled" else "failed"
            last = record_outcome(journal, identity, last["phase"], status)
        else:
            last = record_outcome(journal, identity, "setup", "unknown" if job_status == "cancelled" else "failed")
    atomic_write(outcome, json.dumps(last, sort_keys=True) + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--journal", type=Path, required=True)
    parser.add_argument("--phase")
    parser.add_argument("--status")
    parser.add_argument("--intent", type=Path)
    parser.add_argument("--finalize", action="store_true")
    parser.add_argument("--job-status")
    parser.add_argument("--outcome", type=Path)
    args = parser.parse_args()
    try:
        identity = attempt_identity(os.environ)
        if args.finalize:
            if args.phase or args.status or args.intent or args.outcome is None:
                raise ValueError("invalid finalization arguments")
            finalize(args.journal, identity, args.job_status, args.outcome)
        else:
            if args.outcome or args.job_status:
                raise ValueError("invalid recording arguments")
            record_outcome(args.journal, identity, args.phase, args.status, args.intent)
    except (KeyError, OSError, TypeError, ValueError):
        print("iOS CD outcome recording failed", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
