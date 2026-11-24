import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.request

API_ORIGIN = "https://api.github.com"
WORKFLOW_PATH = ".github/workflows/ci.yml"
ARTIFACT_PREFIX = "ci-validated-tree-"
TRUSTED_EVENTS = {"pull_request", "workflow_dispatch"}
TREE = re.compile(r"[0-9a-f]{40}")
TIMEOUT_SECONDS = 30


def trusted_run(run, repository_id):
    if not isinstance(run, dict):
        return False
    repositories = (run.get("repository"), run.get("head_repository"))
    return (
        str(run.get("path", "")).split("@", 1)[0] == WORKFLOW_PATH
        and run.get("event") in TRUSTED_EVENTS
        and run.get("status") == "completed"
        and run.get("conclusion") == "success"
        and all(isinstance(item, dict) and item.get("id") == repository_id for item in repositories)
    )


def find_validated_run(tree, repository, repository_id, get_json):
    """Return the CI run that passed every product gate on this exact tree, or None.

    Any API failure or unexpected shape answers None, so CI then runs in full.
    """
    if not TREE.fullmatch(tree):
        return None
    try:
        listing = get_json(f"/repos/{repository}/actions/artifacts?name={ARTIFACT_PREFIX}{tree}&per_page=100")
        for artifact in listing["artifacts"]:
            run_reference = artifact["workflow_run"]
            if artifact["name"] != ARTIFACT_PREFIX + tree or artifact["expired"] is not False:
                continue
            if run_reference["head_repository_id"] != repository_id:
                continue
            run = get_json(f"/repos/{repository}/actions/runs/{run_reference['id']}")
            if trusted_run(run, repository_id):
                return run["id"]
    except (KeyError, TypeError, ValueError, OSError):
        return None
    return None


def github_getter(token):
    def get_json(path):
        request = urllib.request.Request(API_ORIGIN + path, headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        })
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            return json.load(response)
    return get_json


if __name__ == "__main__":
    tree = subprocess.check_output(["git", "rev-parse", "--verify", "HEAD^{tree}"], text=True).strip()
    run_id = None
    if os.environ.get("EVENT_NAME") == "push":
        run_id = find_validated_run(
            tree, os.environ["REPOSITORY"], int(os.environ["REPOSITORY_ID"]),
            github_getter(os.environ["GITHUB_TOKEN"]))
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as out:
        out.write(f"validated={'true' if run_id else 'false'}\n")
    print(f"tree {tree}: " + (f"already validated by CI run {run_id}" if run_id else "no validated run"))
    sys.exit(0)
