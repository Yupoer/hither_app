#!/usr/bin/env bash
# Rebuild only the JavaScript toolchain in a saved Linux cloud checkout.
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo_root/apps/mobile"

# This workspace may have a read-only home directory. Keep caches writable and
# prevent Expo's optional telemetry from creating ~/.expo during local checks.
export npm_config_cache="${npm_config_cache:-/tmp/hither-npm-cache}"
export EXPO_NO_TELEMETRY=1

case "${1:-}" in
  '') npm ci ;;
  --check) ;;
  *) echo "usage: $0 [--check]" >&2; exit 2 ;;
esac

node <<'NODE'
const lock = require('./package-lock.json');
for (const name of ['expo', 'react-native', 'hermes-compiler']) {
  const expected = lock.packages[`node_modules/${name}`]?.version;
  const installed = require(`./node_modules/${name}/package.json`).version;
  if (!expected || installed !== expected) {
    throw new Error(`${name}: installed ${installed}, lockfile ${expected}`);
  }
  console.log(`${name} ${installed} matches lockfile`);
}
NODE

npm run verify:runtime
npm run typecheck
