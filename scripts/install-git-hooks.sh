#!/usr/bin/env sh
# Retired: local commits and pushes must not trigger release or duplicate CI.
set -eu
echo 'Hither does not install Git hooks. Run scoped validation; CI gates PR merges.'
echo 'Existing legacy hooks must be removed after inspecting their contents.'
