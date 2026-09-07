import importlib.util
import os
from pathlib import Path
import subprocess
import sys
import tempfile


scope_path = Path(__file__).resolve().with_name("check-workflow-scope.py")
spec = importlib.util.spec_from_file_location("scope", scope_path)
scope = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scope)
assert not scope.product_required(["AGENTS.md", "docs/process.md"])
assert scope.product_required(["AGENTS.md", "apps/mobile/src/auth.ts"])
assert not scope.product_required([".github/workflows/ci.yml"])
assert not scope.product_required(["old_list.tsx"])
assert scope.product_required(["supabase/migrations/20260907.sql"])
assert not scope.product_required(["scripts/install-git-hooks.sh"])
assert not scope.product_required(["scripts/ota-auto-ship.sh"])
assert not scope.product_required(["scripts/task-end-ship.sh"])
assert scope.product_required(["docs/sample.ts"])
assert scope.product_required(["scripts/unknown.sh"])


def git(repo, *args):
    hooks = repo / "empty-hooks"
    return subprocess.run(
        [
            "git",
            "-C",
            str(repo),
            "-c",
            f"core.hooksPath={hooks}",
            "-c",
            "user.name=workflow-scope-test",
            "-c",
            "user.email=workflow-scope-test@example.invalid",
            *args,
        ],
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


def run_scope(repo, event_name, base_sha):
    output = repo / f"github-output-{event_name}-{base_sha}.txt"
    environment = os.environ.copy()
    environment.update(
        EVENT_NAME=event_name,
        BASE_SHA=base_sha,
        GITHUB_OUTPUT=str(output),
    )
    subprocess.run(
        [
            sys.executable,
            "-B",
            str(scope_path),
        ],
        check=True,
        cwd=repo,
        env=environment,
        capture_output=True,
        text=True,
    )
    return output.read_text(encoding="utf-8")


with tempfile.TemporaryDirectory(prefix="workflow-scope-") as temp_dir:
    repo = Path(temp_dir)
    (repo / "empty-hooks").mkdir()
    git(repo, "init")
    (repo / "README.md").write_text("base\n", encoding="utf-8")
    product = repo / "apps/mobile/src/auth.ts"
    product.parent.mkdir(parents=True)
    product.write_text("export const auth = 1;\n", encoding="utf-8")
    git(repo, "add", "--all")
    git(repo, "commit", "-m", "base")
    base_sha = git(repo, "rev-parse", "HEAD")

    (repo / "README.md").write_text("docs\n", encoding="utf-8")
    git(repo, "add", "--all")
    git(repo, "commit", "-m", "docs")
    docs_sha = git(repo, "rev-parse", "HEAD")
    assert run_scope(repo, "pull_request", base_sha) == "product=false\n"
    assert run_scope(repo, "push", base_sha) == "product=false\n"

    product.write_text("export const auth = 2;\n", encoding="utf-8")
    git(repo, "add", "--all")
    git(repo, "commit", "-m", "product")
    product_sha = git(repo, "rev-parse", "HEAD")
    assert run_scope(repo, "pull_request", docs_sha) == "product=true\n"
    assert run_scope(repo, "push", docs_sha) == "product=true\n"

    git(repo, "mv", "apps/mobile/src/auth.ts", "docs-auth.md")
    git(repo, "commit", "-m", "rename-product-to-doc")
    rename_sha = git(repo, "rev-parse", "HEAD")
    assert run_scope(repo, "pull_request", product_sha) == "product=true\n"
    assert run_scope(repo, "workflow_dispatch", rename_sha) == "product=true\n"
    assert run_scope(repo, "push", "0" * 40) == "product=true\n"

print("workflow scope checks passed")
