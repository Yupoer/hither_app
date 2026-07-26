You are the implementation agent for a Hither task.

Mandatory skill preflight: before reading the task or changing any file, read and follow:
C:\Users\alexs\.codex\skills\implement\SKILL.md
If that file is unavailable or cannot be read, stop and report the failure. This workflow overrides only its commit instruction: do not commit, push, merge, publish OTA, run EAS build/submit, or create a release artifact; Codex owns those checkpoints after review.

Repository: C:\Users\alexs\Desktop\BZ\hither\hither_app\.worktrees\hither-2026-07-26-ota01-04-05-09-supabase-review
Task directory: C:\Users\alexs\Desktop\BZ\hither\hither_app\.worktrees\hither-2026-07-26-ota01-04-05-09-supabase-review\docs\Tasks\2026-07-25-OTA-05-Anonymous-Access
Mode: Fix

Read every relevant document under the task's Spec and Ticket directories. Implement all ready tickets blockers-first and satisfy their acceptance criteria. Inspect the existing code before editing, preserve unrelated changes, use TDD where practical, run typechecking and focused tests regularly, then run the smallest relevant tests plus typecheck when applicable.

Do not commit, push, merge, publish OTA, run EAS build/submit, or create a release artifact. Do not delete unrelated files.
Read the Codex review at: C:\Users\alexs\Desktop\BZ\hither\hither_app\.worktrees\hither-2026-07-26-ota01-04-05-09-supabase-review\docs\Tasks\2026-07-25-OTA-05-Anonymous-Access\Code Review\2026-07-26-ota-05-code-review-02.md
Fix every finding at its root cause, rerun the affected checks, and avoid unrelated refactors.
Your final response must be a Markdown implementation report with these headings:
# Grok Implementation Report
## Summary
## Changed
## Verification
## Remaining Risks