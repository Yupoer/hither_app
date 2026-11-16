"""Shared source admission and GitHub Actions dispatch for iOS release scripts."""

import json
import os
from pathlib import Path
import re
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]
REPOSITORY = "Yupoer/hither_app"
WORKFLOW = "cd-ios-testflight.yml"
MANIFEST = "release/ios-production-binary.json"
ACTIONS_MODES = ("inspect-release", "preflight", "validate-release", "build-only", "submit")
NON_PRODUCT_MOBILE_PREFIXES = (
    "apps/mobile/src/__tests__/", "apps/mobile/__tests__/", "apps/mobile/test/",
    "apps/mobile/docs/", "apps/mobile/scripts/",
)


def capture(*command, **kwargs):
    return subprocess.run(command, cwd=ROOT, text=True, stdout=subprocess.PIPE,
                          check=True, **kwargs).stdout


def require_pinned_checkout(source_sha):
    if not re.fullmatch(r"[0-9a-f]{40}", source_sha) or capture("git", "rev-parse", "HEAD").strip() != source_sha:
        raise ValueError("Use a checkout pinned to the full --source-sha.")
    if capture("git", "status", "--porcelain", "--untracked-files=normal"):
        raise ValueError("Use a clean checkout for release decisions and execution.")


def require_master_ci(source_sha):
    """Verify the reviewed SHA against the same CI policy used by CD."""
    repository_id = capture("gh", "api", f"repos/{REPOSITORY}", "--jq", ".id").strip()
    token = capture("gh", "auth", "token", "--hostname", "github.com").strip()
    return json.loads(capture(
        "node", "scripts/check-release-ci.mjs",
        env={**os.environ, "GITHUB_REPOSITORY": REPOSITORY, "GITHUB_REPOSITORY_ID": repository_id,
             "SOURCE_SHA": source_sha, "GITHUB_TOKEN": token},
    ))


def compatibility(source_sha):
    response = subprocess.run(
        [sys.executable, "-B", "scripts/check-ios-ota-compatibility.py", "--source-sha", source_sha,
         "--manifest", MANIFEST], cwd=ROOT, text=True, stdout=subprocess.PIPE,
    )
    if response.returncode not in (0, 1):
        raise RuntimeError("The OTA compatibility check did not produce a decision.")
    result = json.loads(response.stdout)
    if type(result.get("eligible")) is not bool or result["eligible"] != (response.returncode == 0):
        raise RuntimeError("Invalid OTA compatibility result.")
    return result


def release_plan(source_sha):
    result = compatibility(source_sha)
    if result["reason"] in {"invalid_source_sha", "not_a_git_checkout", "checkout_not_pinned_source",
                           "cannot_compare_binary_source", "invalid_app_configuration"}:
        raise ValueError(f"Unable to evaluate release source: {result['reason']}")
    if not result["eligible"]:
        return {"sourceSha": source_sha, "route": "local", "reason": result["reason"],
                "otaCompatibility": result}
    changed = capture("git", "diff", "--name-only", "--no-renames", "-z",
                      result["comparisonBaselineSha"], source_sha, "--", "apps/mobile").split("\0")
    has_app_changes = any(path and not path.startswith(NON_PRODUCT_MOBILE_PREFIXES) for path in changed)
    return {"sourceSha": source_sha, "route": "ota" if has_app_changes else "none",
            "reason": "compatible" if has_app_changes else "no_mobile_product_changes",
            "otaCompatibility": result}


def release_directory(directory):
    if not directory.is_absolute() or directory.resolve().is_relative_to(ROOT):
        raise ValueError("--release-dir must be an absolute path outside the source checkout.")
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    if directory.stat().st_mode & 0o077:
        raise ValueError("Use a private release directory (chmod 700).")
    return directory.resolve()


def watch_dispatch(run_id, mode, source_sha, directory):
    run = json.loads(capture("gh", "run", "view", run_id, "--repo", REPOSITORY,
                             "--json", "attempt,databaseId,event,headBranch,workflowName,url"))
    link = f"https://github.com/{REPOSITORY}/actions/runs/{run_id}"
    if (str(run.get("databaseId")) != run_id or run.get("url") != link
            or run.get("workflowName") != "CD iOS TestFlight"
            or run.get("event") != "workflow_dispatch" or run.get("headBranch") != "master"):
        raise RuntimeError("GitHub did not return the expected release workflow run.")
    print(link, flush=True)
    watched = subprocess.run(["gh", "run", "watch", run_id, "--repo", REPOSITORY,
                              "--exit-status", "--interval", "15"], cwd=ROOT)
    attempt = run["attempt"]
    name = f"hither-ios-cd-outcome-{run_id}-{attempt}"
    artifacts = directory / name
    subprocess.run(["gh", "run", "download", run_id, "--repo", REPOSITORY, "--name", name,
                    "--dir", str(artifacts)], cwd=ROOT, check=True)
    outcome = json.loads((artifacts / "hither-ios-cd-outcome.json").read_text())
    identity = {"sourceSha": source_sha, "mode": mode, "runId": run_id, "runAttempt": attempt}
    if any(outcome.get(key) != value for key, value in identity.items()):
        raise RuntimeError("The GitHub release receipt does not match the selected source and mode.")
    if watched.returncode or outcome.get("status") != "passed":
        raise RuntimeError(f"Review the release outcome at {artifacts} before another dispatch.")
    if mode == "ota":
        subprocess.run(["gh", "run", "download", run_id, "--repo", REPOSITORY,
                        "--name", f"hither-ios-ota-receipt-{run_id}-{attempt}", "--dir", str(artifacts)],
                       cwd=ROOT, check=True)
        receipt = json.loads((artifacts / "hither-ota-receipt.json").read_text())
        if receipt.get("sourceSha") != source_sha:
            raise RuntimeError("The OTA receipt does not match the selected source.")
    print(json.dumps({**identity, "url": link, "artifacts": str(artifacts)}), flush=True)


def dispatch(mode, source_sha, directory, backend_verified=False):
    require_pinned_checkout(source_sha)
    if mode in {"ota", "submit"} and not backend_verified:
        raise ValueError("Pass --backend-verified after verifying any required production backend change.")
    if mode == "ota" and release_plan(source_sha)["route"] != "ota":
        raise ValueError("The selected source is not eligible for an OTA release.")
    directory = release_directory(directory)
    dispatch_path = directory / f"actions-{mode}.json"
    identity = {"sourceSha": source_sha, "mode": mode}
    request = {"source_sha": source_sha, "mode": mode, "backend_verified": str(backend_verified).lower()}
    if not dispatch_path.exists():
        with dispatch_path.open("x") as journal:
            json.dump(identity, journal)
            journal.flush()
            os.fsync(journal.fileno())
        dispatched = capture("gh", "workflow", "run", WORKFLOW, "--repo", REPOSITORY,
                             "--ref", "master", "--json", input=json.dumps(request)).strip()
        prefix = f"https://github.com/{REPOSITORY}/actions/runs/"
        match = re.search(re.escape(prefix) + r"([1-9][0-9]*)\b", dispatched)
        if not match:
            raise RuntimeError(f"GitHub did not return a run URL. Reconcile the dispatch recorded in {dispatch_path}.")
        pending = dispatch_path.with_suffix(".tmp")
        pending.write_text(json.dumps({**identity, "runId": match[1]}) + "\n")
        pending.replace(dispatch_path)
    prior = json.loads(dispatch_path.read_text())
    run_id = prior.get("runId", "")
    if any(prior.get(key) != value for key, value in identity.items()) or not re.fullmatch(r"[1-9][0-9]*", run_id):
        raise RuntimeError(f"Resolve the existing dispatch recorded in {dispatch_path} before retrying.")
    watch_dispatch(run_id, mode, source_sha, directory)


def add_source_arguments(parser, *, release_dir_required=True):
    parser.add_argument("--source-sha", required=True)
    parser.add_argument("--release-dir", type=Path, required=release_dir_required)
    parser.add_argument("--backend-verified", action="store_true")


def main_guard(main):
    try:
        return main()
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f"iOS release: {error}", file=sys.stderr)
        return 1
