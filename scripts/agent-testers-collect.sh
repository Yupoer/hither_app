#!/usr/bin/env bash
# Downloads and decrypts the reports of an Agent testers run into runs/<run id>/.
# Usage: bash scripts/agent-testers-collect.sh <run id> [private key]
set -euo pipefail
run_id=$1
key=${2:-$HOME/.mobile-agent-testers/Yupoer_hither_app.pem}
testers_sha=$(sed -n 's/^  TESTERS_SHA: //p' "$(dirname "$0")/../.github/workflows/agent-testers.yml")
tools=$(mktemp -d)
trap 'rm -rf "$tools"' EXIT
gh api "repos/pierridotite/mobile-agent-testers/tarball/$testers_sha" | tar xz -C "$tools" --strip-components 1
bash "$tools/scripts/collect.sh" "$run_id" "$key" "runs/$run_id"
