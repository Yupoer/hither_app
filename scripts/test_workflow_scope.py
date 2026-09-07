import importlib.util
from pathlib import Path
spec = importlib.util.spec_from_file_location("scope", Path(__file__).with_name("check-workflow-scope.py"))
scope = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scope)
assert not scope.product_required(["AGENTS.md", "docs/process.md"])
assert scope.product_required(["AGENTS.md", "apps/mobile/src/auth.ts"])
assert not scope.product_required([".github/workflows/ci.yml"])
assert scope.product_required(["supabase/migrations/20260907.sql"])
assert not scope.product_required(["scripts/install-git-hooks.sh"])
assert scope.product_required(["docs/sample.ts"])
assert scope.product_required(["scripts/unknown.sh"])
print("workflow scope checks passed")
