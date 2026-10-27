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
assert "  open-issue:" in source, "master failure reporting is missing"
print("CI trigger matrix checks passed")
