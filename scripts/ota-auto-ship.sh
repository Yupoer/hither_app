#!/usr/bin/env sh
# OTA-only auto ship: push (merge feature branch → master when needed) + EAS Update.
# Trigger only when the latest commit touches OTA-safe mobile JS/assets and
# touches nothing that requires a new native binary.
#
# Usage:
#   scripts/ota-auto-ship.sh              # inspect HEAD commit
#   scripts/ota-auto-ship.sh --range A..B # inspect commit range (e.g. pre-push)
#   scripts/ota-auto-ship.sh --force      # skip eligibility check
#
# Install as post-commit:
#   ln -sf ../../scripts/ota-auto-ship.sh .git/hooks/post-commit
#   # or on Windows Git Bash: cp scripts/ota-auto-ship.sh .git/hooks/post-commit
#
# Env:
#   OTA_AUTO_SHIP=0          disable entirely
#   OTA_CHANNELS="production preview"  channels to publish (default both)
#   OTA_MAIN_BRANCH=master   merge target when on a feature branch

set -eu

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || exit 0
cd "$ROOT" || exit 0

if [ "${OTA_AUTO_SHIP:-1}" = "0" ]; then
  echo "[ota-auto-ship] disabled (OTA_AUTO_SHIP=0)"
  exit 0
fi

FORCE=0
RANGE=""
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    --range=*) RANGE="${arg#--range=}" ;;
    --range)
      shift || true
      RANGE="${1:-}"
      ;;
  esac
done

MAIN_BRANCH="${OTA_MAIN_BRANCH:-master}"
CHANNELS="${OTA_CHANNELS:-production preview}"

# --- Collect changed paths ---------------------------------------------------
if [ -n "$RANGE" ]; then
  FILES="$(git diff --name-only "$RANGE" 2>/dev/null || true)"
else
  # post-commit: files introduced by HEAD
  FILES="$(git diff-tree --no-commit-id --name-only -r HEAD 2>/dev/null || true)"
fi

if [ -z "$FILES" ] && [ "$FORCE" != "1" ]; then
  echo "[ota-auto-ship] no files in scope — skip"
  exit 0
fi

# Paths that require a new native binary / non-OTA release
is_binary_path() {
  case "$1" in
    apps/mobile/ios/*|apps/mobile/android/*) return 0 ;;
    apps/mobile/modules/*|apps/mobile/targets/*) return 0 ;;
    apps/mobile/package.json|apps/mobile/package-lock.json) return 0 ;;
    apps/mobile/app.json|apps/mobile/eas.json|apps/mobile/app.config.*) return 0 ;;
    apps/mobile/Podfile*|apps/mobile/*.podspec) return 0 ;;
    apps/mobile/plugins/*) return 0 ;;
    *) return 1 ;;
  esac
}

# Paths eligible for OTA publish
is_ota_path() {
  case "$1" in
    apps/mobile/src/*) return 0 ;;
    apps/mobile/assets/*) return 0 ;;
    apps/mobile/index.ts|apps/mobile/App.tsx|apps/mobile/App.ts) return 0 ;;
    apps/mobile/babel.config.js|apps/mobile/metro.config.js|apps/mobile/tsconfig.json) return 0 ;;
    *) return 1 ;;
  esac
}

HAS_OTA=0
HAS_BINARY=0
HAS_OTHER=0

# Portable line loop (no process substitution required)
echo "$FILES" | while IFS= read -r f || [ -n "$f" ]; do
  [ -z "$f" ] && continue
  :
done

for f in $FILES; do
  if is_binary_path "$f"; then
    HAS_BINARY=1
  elif is_ota_path "$f"; then
    HAS_OTA=1
  else
    # docs, supabase, root md, hooks scripts, etc.
    HAS_OTHER=1
  fi
done

if [ "$FORCE" != "1" ]; then
  if [ "$HAS_BINARY" = "1" ]; then
    echo "[ota-auto-ship] binary/native paths in commit — skip OTA (need EAS Build)"
    exit 0
  fi
  if [ "$HAS_OTA" != "1" ]; then
    echo "[ota-auto-ship] no OTA-safe mobile JS/assets — skip"
    exit 0
  fi
  # Allow docs/supabase alongside OTA files; still ship JS. Block pure non-mobile.
fi

MSG="$(git log -1 --pretty=%s 2>/dev/null || echo ota-auto-ship)"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"

echo "[ota-auto-ship] OTA-eligible commit on $BRANCH: $MSG"

# --- Push / merge ------------------------------------------------------------
# Avoid infinite loop if something re-triggers commit during merge.
export OTA_AUTO_SHIP=0

if [ "$BRANCH" != "$MAIN_BRANCH" ] && [ "$BRANCH" != "main" ]; then
  echo "[ota-auto-ship] feature branch → merge into $MAIN_BRANCH and push"
  # Stash is not needed: post-commit working tree is clean of this commit.
  git fetch origin "$MAIN_BRANCH" 2>/dev/null || true
  git checkout "$MAIN_BRANCH"
  git pull --ff-only origin "$MAIN_BRANCH" 2>/dev/null || true
  git merge --no-ff "$BRANCH" -m "merge: $BRANCH (ota-auto-ship)"
  git push origin "$MAIN_BRANCH"
  # Optional: push feature branch tip too
  git push origin "$BRANCH" 2>/dev/null || true
else
  echo "[ota-auto-ship] on $BRANCH → push"
  git push origin "$BRANCH"
fi

# --- EAS Update --------------------------------------------------------------
MOBILE="$ROOT/apps/mobile"
cd "$MOBILE" || exit 1

if ! command -v npx >/dev/null 2>&1; then
  echo "[ota-auto-ship] npx missing — push done, OTA skipped"
  exit 0
fi

for ch in $CHANNELS; do
  echo "[ota-auto-ship] eas update --channel $ch"
  # CI=1 quiet non-interactive export warnings
  CI=1 npx eas update --channel "$ch" --message "$MSG" --non-interactive || {
    echo "[ota-auto-ship] eas update failed on channel $ch" >&2
    exit 1
  }
done

echo "[ota-auto-ship] done"
exit 0
