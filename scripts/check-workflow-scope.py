"""Run product checks only when the diff can affect product behavior."""
import os
import subprocess
from pathlib import Path

def product_required(paths):
    automation = {
        ".github/workflows/ci.yml",
        "old_list.tsx",
        "scripts/check-workflow-scope.py",
        "scripts/test_workflow_scope.py", "scripts/install-git-hooks.sh",
        "scripts/ota-auto-ship.sh", "scripts/task-end-ship.sh",
    }
    return any(not (p.endswith(".md") or p in automation) for p in paths)

if __name__ == "__main__":
    if os.environ.get("EVENT_NAME") in {"pull_request", "push"} and os.environ.get("BASE_SHA", "").strip("0"):
        base = os.environ["BASE_SHA"]
        changed = subprocess.check_output(
            ["git", "diff", "--no-renames", "--name-only", "-z", base, "HEAD"]
        ).decode("utf-8").strip("\0").split("\0")
        required = product_required([p for p in changed if p])
    else:
        required = True
    with Path(os.environ["GITHUB_OUTPUT"]).open("a", encoding="utf-8") as out:
        out.write(f"product={str(required).lower()}\n")
