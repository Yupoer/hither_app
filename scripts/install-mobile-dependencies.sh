#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../apps/mobile"
bun install --frozen-lockfile
node node_modules/@shopify/react-native-skia/scripts/install-libs.js
node node_modules/unrs-resolver/postinstall.js
bun x --no-install patch-package --error-on-fail
