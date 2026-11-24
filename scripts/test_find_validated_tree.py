import importlib.util
from pathlib import Path

script = Path(__file__).with_name("find-validated-tree.py").resolve()
spec = importlib.util.spec_from_file_location("finder", script)
finder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(finder)

TREE = "a" * 40
REPO = "owner/repo"
REPO_ID = 7


def artifact(run_id=11, name=None, expired=False, head_repository_id=REPO_ID):
    return {"name": name or finder.ARTIFACT_PREFIX + TREE, "expired": expired,
            "workflow_run": {"id": run_id, "head_repository_id": head_repository_id}}


def run(**changes):
    value = {"id": 11, "path": ".github/workflows/ci.yml", "event": "pull_request", "status": "completed",
             "conclusion": "success", "repository": {"id": REPO_ID}, "head_repository": {"id": REPO_ID}}
    value.update(changes)
    return value


def lookup(artifacts, runs, tree=TREE):
    def get_json(path):
        if "/actions/artifacts" in path:
            assert f"name={finder.ARTIFACT_PREFIX}{tree}" in path
            return {"artifacts": artifacts}
        return runs[int(path.rsplit("/", 1)[1])]
    return finder.find_validated_run(tree, REPO, REPO_ID, get_json)


assert lookup([artifact()], {11: run()}) == 11
assert lookup([artifact()], {11: run(event="workflow_dispatch", path=".github/workflows/ci.yml@refs/heads/deliver/x")}) == 11
assert lookup([artifact(run_id=5), artifact()], {5: run(id=5, conclusion="failure"), 11: run()}) == 11
assert lookup([], {}) is None
for rejected in (
    run(conclusion="failure"), run(conclusion=None, status="in_progress"), run(event="push"),
    run(event="schedule"), run(path=".github/workflows/other.yml"),
    run(repository={"id": 8}), run(head_repository={"id": 8}), run(head_repository=None), run(repository="x"),
):
    assert lookup([artifact()], {11: rejected}) is None, rejected
for rejected in (
    artifact(expired=True), artifact(name=finder.ARTIFACT_PREFIX + "b" * 40),
    artifact(head_repository_id=8), {"name": "x"}, "x",
):
    assert lookup([rejected], {11: run()}) is None, rejected
assert lookup([artifact()], {}) is None
assert lookup([artifact()], {11: run()}, tree="not-a-tree") is None
assert finder.find_validated_run(TREE, REPO, REPO_ID, lambda path: (_ for _ in ()).throw(OSError("denied"))) is None
assert finder.find_validated_run(TREE, REPO, REPO_ID, lambda path: {"artifacts": None}) is None
print("validated tree lookup checks passed")
