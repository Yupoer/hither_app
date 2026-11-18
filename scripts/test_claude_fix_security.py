"""Protect the Claude fix workflow's untrusted-input and secret boundaries."""

from pathlib import Path
import re


workflow = Path(__file__).resolve().parents[1] / ".github/workflows/claude-fix.yml"
source = workflow.read_text(encoding="utf-8")

task_input = re.search(
    r"(?ms)^      task_summary:\n(.*?)(?=^\S|^      [a-zA-Z_]+:|\Z)",
    source,
)
assert task_input, "Maintainer-authored task summary input is required"
assert "required: true" in task_input.group(1)
assert "type: string" in task_input.group(1)

claude_job = re.search(r"(?ms)^  claude:\n(.*?)(?=^  verify:)", source)
verify_job = re.search(r"(?ms)^  verify:\n(.*?)(?=^  publish:)", source)
publish_job = re.search(r"(?ms)^  publish:\n(.*)\Z", source)
assert claude_job and verify_job and publish_job, "Claude, verify, and publish jobs must remain separate"

claude = claude_job.group(1)
verify = verify_job.group(1)
publish = publish_job.group(1)
action = re.search(
    r"(?ms)^      - uses: anthropics/claude-code-action@[0-9a-f]{40}\b(.*?)(?=^      - )",
    claude,
)
assert action, "Claude action must stay commit-pinned"
action_source = action.group(1)

assert source.count("${{ secrets.ANTHROPIC_API_KEY }}") == 1
assert "${{ inputs.task_summary }}" in action_source
assert "issues: read" not in claude
assert "gh issue view" not in claude
assert '"Edit,Read,Write,Glob,Grep"' in action_source
assert '--disallowedTools\n            "Bash,WebFetch,WebSearch,mcp__github__*"' in action_source
assert "Bash(" not in action_source
assert "bun run" not in claude
assert ".github/actions/setup-mobile" not in claude

assert "ANTHROPIC_API_KEY" not in verify
assert "git checkout --detach refs/claude-fix/candidate" in verify
assert "./.github/actions/setup-mobile" in verify
for command in (
    "bun run check:quick",
    "bun run test:meta",
    "bun run test:ci",
    "bun run verify:runtime",
    "bunx --no-install expo install --check",
):
    assert command in verify, f"secretless verification lost required command: {command}"

assert "needs: [claude, verify]" in publish
assert "needs.verify.result == 'success'" in publish
print("Claude fix security boundary checks passed")
