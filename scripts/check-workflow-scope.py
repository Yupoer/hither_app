import json
import os
import subprocess
from pathlib import Path


def product_required(paths):
    return any(not p.endswith(".md") or p.startswith(".cursor/skills/verify-location-sync-formally/") or
               p == ".agents/skills/verify-location-sync-formally/SKILL.md" for p in paths)


def classify(event_name, base):
    identity = None
    required = True
    if event_name in {"pull_request", "push"} and base.strip("0"):
        try:
            changed = subprocess.check_output(
                ["git", "diff", "--no-renames", "--name-only", "-z", base, "HEAD"]
            ).decode("utf-8").split("\0")
            required = product_required([p for p in changed if p])
            identity = dict(zip(("baseSha", "headSha", "treeSha"), [
                subprocess.check_output(["git", "rev-parse", "--verify", ref], text=True).strip()
                for ref in (f"{base}^{{commit}}", "HEAD", "HEAD^{tree}")
            ]), diffMode="endpoints")
        except subprocess.CalledProcessError:
            required = True
    planner = Path(__file__).with_name("ci-shadow-plan.mjs")
    return json.loads(subprocess.check_output(
        ["node", str(planner)], input=json.dumps({"eventName": event_name, "product": required, "identity": identity}), text=True
    ))


if __name__ == "__main__":
    decision = classify(os.environ.get("EVENT_NAME", ""), os.environ.get("BASE_SHA", ""))
    with Path(os.environ["GITHUB_OUTPUT"]).open("a", encoding="utf-8") as out:
        for key, value in (("product", decision["product"]), ("mode", decision["mode"]),
                           ("groups", decision["groups"]), ("expected_jobs", decision["expectedJobs"]), ("reasons", decision["reasons"])):
            out.write(f"{key}={json.dumps(value, separators=(',', ':')) if not isinstance(value, str) else value}\n")
