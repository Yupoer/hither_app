"""Check which GitHub events run the full Hither CI workflow."""

from pathlib import Path
import re


workflow = Path(__file__).resolve().parents[1] / ".github/workflows/ci.yml"
source = workflow.read_text(encoding="utf-8")
match = re.search(r"(?ms)^on:\n(.*?)(?=^\S|\Z)", source)
assert match, "CI event triggers are missing"
events = match.group(1)
push = re.search(r"(?m)^  push:\n    branches: \[([^\n]+)\]$", events)
assert push, "CI push branch filter is missing"
branches = re.findall(r'"([^"]+)"', push.group(1))
assert branches == ["master"], f"feature branch pushes must not duplicate PR CI: {branches}"
assert re.search(r"(?m)^  pull_request:$", events), "PR merge-result CI is required"
assert re.search(r"(?m)^  workflow_dispatch:$", events), "manual direct-delivery CI is required"

matrix = {
    ("push", "master"): True,
    ("push", "deliver/example"): False,
    ("push", "feature/example"): False,
    ("push", "v1.2.3"): False,
    ("pull_request", "deliver/example"): True,
    ("pull_request", "feature/example"): True,
    ("workflow_dispatch", "deliver/example"): True,
    ("workflow_dispatch", "master"): True,
}
for (event, ref), expected in matrix.items():
    actual = (ref in branches if event == "push" else
              bool(re.search(rf"(?m)^  {event}:$", events)))
    assert actual is expected, (event, ref, expected, actual)

assert "  ci-required:" in source, "required aggregate status is missing"
manual_base = "startsWith(github.ref, 'refs/heads/deliver/') && 'origin/master'"
assert source.count(manual_base) == 2, "manual deliver scope and coverage must compare against master"
assert "    if: failure() && github.event_name == 'push' && github.ref == 'refs/heads/master'" in source, (
    "master failure reporting must stay limited to master pushes")

upgrade = re.search(
    r"(?ms)^      - name: Scheduled navigation pre-migration upgrade regression\n(.*?)(?=^      - |\Z)",
    source,
)
assert upgrade, "scheduled navigation upgrade requires its own pre-migration replay"
assert "@electric-sql/pglite@0.5.8" in upgrade.group(1), "upgrade replay runtime must be pinned"
assert 'npm install --prefix "$RUNNER_TEMP/hither-scheduled-upgrade"' in upgrade.group(1)
assert "node supabase/tests/run-security-local.mjs" in upgrade.group(1)
assert '"$RUNNER_TEMP/hither-scheduled-upgrade/node_modules/@electric-sql/pglite/dist/index.js"' in upgrade.group(1)
assert "--before-migration=20261102152223_scheduled_navigation_start.sql:../verification-probes/scheduled_navigation_upgrade.seed.sql" in upgrade.group(1)
assert "../verification-probes/scheduled_navigation_upgrade.sql" in upgrade.group(1)
probe = workflow.parents[2] / "supabase/verification-probes/scheduled_navigation_upgrade.sql"
assert probe.is_file(), "pre-migration upgrade assertions are missing"
assert probe.with_name("scheduled_navigation_upgrade.seed.sql").is_file(), "pre-migration seed is missing"
assert not list((probe.parents[1] / "tests").rglob("scheduled_navigation_upgrade*.sql")), (
    "upgrade assertions and seed must stay outside recursive supabase/tests discovery")
assert "find supabase/tests -type f -name '*.test.sql' -print0 | sort -z" in source
assert 'supabase test db --local "${tests[@]}"' in source, "all ordinary SQL regressions must still run"
print("CI trigger matrix checks passed")
