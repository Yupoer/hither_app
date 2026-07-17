#!/usr/bin/env bash
# Task-end ship pipeline for Grok/Claude Stop hooks (and manual runs):
#   1) auto-commit dirty work (OTA-safe paths only — never native/binary)
#   2) patch-bump expo.version (keeps runtimeVersion for OTA compatibility)
#   3) if feature branch / worktree → merge into master (worktree-safe)
#   4) push
#   5) eas update → production + preview
#
# Usage:
#   bash scripts/task-end-ship.sh
#   bash scripts/task-end-ship.sh --force          # ship even if eligibility is weak
#   bash scripts/task-end-ship.sh --dry-run        # print plan only
#
# Env:
#   TASK_END_SHIP=0           disable entirely
#   TASK_END_SHIP_COMMIT=0    skip auto-commit (still merge/push/OTA if commits exist)
#   TASK_END_SHIP_BUMP=0      skip version bump
#   TASK_END_SHIP_OTA=0       skip EAS Update
#   TASK_END_SHIP_GIT_NAME    fallback author name (WSL / missing identity)
#   TASK_END_SHIP_GIT_EMAIL   fallback author email
#   OTA_CHANNELS="production preview"
#   OTA_MAIN_BRANCH=master
#   OTA_AUTO_SHIP=0           always set while this script runs (avoid post-commit loop)

set -euo pipefail

log() { printf '[task-end-ship] %s\n' "$*"; }
warn() { printf '[task-end-ship] WARN: %s\n' "$*" >&2; }

# Drain hook stdin so the runner doesn't block on a full pipe.
if [ ! -t 0 ]; then
  cat >/dev/null 2>&1 || true
fi

if [ "${TASK_END_SHIP:-1}" = "0" ]; then
  log "disabled (TASK_END_SHIP=0)"
  exit 0
fi

FORCE=0
DRY_RUN=0
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    --dry-run) DRY_RUN=1 ;;
  esac
done

# Never re-enter via git post-commit → ota-auto-ship
export OTA_AUTO_SHIP=0

# --- Resolve git repo (workspace may be hither/ or hither_app/) ---------------
resolve_root() {
  local start="${GROK_WORKSPACE_ROOT:-${CLAUDE_PROJECT_DIR:-${PWD}}}"
  local d cand
  for cand in "$start" "$start/hither_app" "$PWD" "$PWD/hither_app"; do
    [ -d "$cand" ] || continue
    d="$(git -C "$cand" rev-parse --show-toplevel 2>/dev/null || true)"
    if [ -n "$d" ]; then
      printf '%s' "$d"
      return 0
    fi
  done
  return 1
}

ROOT="$(resolve_root)" || {
  log "not a git workspace — skip"
  exit 0
}
cd "$ROOT"
log "repo: $ROOT"

MAIN_BRANCH="${OTA_MAIN_BRANCH:-master}"
CHANNELS="${OTA_CHANNELS:-production preview}"
MOBILE="$ROOT/apps/mobile"
APP_JSON="$MOBILE/app.json"

# --- Helpers -----------------------------------------------------------------
is_worktree() {
  local git_dir common
  git_dir="$(git rev-parse --git-dir 2>/dev/null)" || return 1
  common="$(git rev-parse --git-common-dir 2>/dev/null)" || return 1
  if [ -d "$git_dir" ] && [ -d "$common" ]; then
    git_dir="$(cd "$git_dir" && pwd)"
    common="$(cd "$common" && pwd)"
  fi
  [ "$git_dir" != "$common" ]
}

# Normalize paths from Windows/WSL/Git Bash (\, CR, ./ prefix).
normalize_repo_path() {
  local p
  p="$(printf '%s' "${1-}" | tr -d '\r' | tr '\\' '/')"
  p="${p#./}"
  # If tools report paths under a parent monorepo folder name
  case "$p" in
    hither_app/*) p="${p#hither_app/}" ;;
  esac
  printf '%s' "$p"
}

is_binary_path() {
  case "$1" in
    apps/mobile/ios/*|apps/mobile/android/*) return 0 ;;
    apps/mobile/modules/*|apps/mobile/targets/*) return 0 ;;
    apps/mobile/package.json|apps/mobile/package-lock.json) return 0 ;;
    apps/mobile/eas.json|apps/mobile/app.config.*) return 0 ;;
    apps/mobile/Podfile*|apps/mobile/*.podspec) return 0 ;;
    apps/mobile/plugins/*) return 0 ;;
    *) return 1 ;;
  esac
}

is_ota_path() {
  case "$1" in
    apps/mobile/src/*) return 0 ;;
    apps/mobile/assets/*) return 0 ;;
    apps/mobile/index.ts|apps/mobile/App.tsx|apps/mobile/App.ts) return 0 ;;
    apps/mobile/babel.config.js|apps/mobile/metro.config.js|apps/mobile/tsconfig.json) return 0 ;;
    *) return 1 ;;
  esac
}

is_secret_path() {
  case "$1" in
    *.env|*.env.*|.env|.env.*) return 0 ;;
    *.p8|*.pem|*.key) return 0 ;;
    AuthKey_*) return 0 ;;
    *) return 1 ;;
  esac
}

should_never_commit() {
  case "$1" in
    node_modules/*|*/node_modules/*) return 0 ;;
    apps/mobile/dist/*|apps/mobile/ios/build/*) return 0 ;;
    *.log|.DS_Store|Thumbs.db) return 0 ;;
    .git/*) return 0 ;;
    *) is_secret_path "$1" ;;
  esac
}

collect_changed_paths() {
  {
    git diff --name-only 2>/dev/null || true
    git diff --cached --name-only 2>/dev/null || true
    git ls-files --others --exclude-standard 2>/dev/null || true
  } | sort -u | sed '/^$/d'
}

# Sets HAS_OTA HAS_BINARY HAS_OTHER HAS_ANY from a newline-separated path list.
# Must NOT run in a pipeline (subshell would discard globals).
classify_paths_text() {
  HAS_OTA=0
  HAS_BINARY=0
  HAS_OTHER=0
  HAS_ANY=0
  local f text
  text="${1-}"
  [ -z "$text" ] && return 0
  while IFS= read -r f || [ -n "$f" ]; do
    [ -z "$f" ] && continue
    f="$(normalize_repo_path "$f")"
    [ -z "$f" ] && continue
    should_never_commit "$f" && continue
    HAS_ANY=1
    if is_binary_path "$f"; then
      HAS_BINARY=1
    elif is_ota_path "$f"; then
      HAS_OTA=1
    else
      HAS_OTHER=1
    fi
  done <<EOF
$text
EOF
}

# Collect OTA-safe paths from a newline-separated list into OTA_PATHS_TEXT.
filter_ota_paths_text() {
  OTA_PATHS_TEXT=""
  local f text
  text="${1-}"
  [ -z "$text" ] && return 0
  while IFS= read -r f || [ -n "$f" ]; do
    [ -z "$f" ] && continue
    f="$(normalize_repo_path "$f")"
    [ -z "$f" ] && continue
    should_never_commit "$f" && continue
    is_ota_path "$f" || continue
    OTA_PATHS_TEXT="${OTA_PATHS_TEXT}${f}
"
  done <<EOF
$text
EOF
}

unstage_paths_text() {
  local f text
  text="${1-}"
  [ -z "$text" ] && return 0
  while IFS= read -r f || [ -n "$f" ]; do
    [ -z "$f" ] && continue
    git restore --staged -- "$f" 2>/dev/null \
      || git reset -q HEAD -- "$f" 2>/dev/null \
      || true
  done <<EOF
$text
EOF
}

# True if index already has staged non-OTA paths (we must not auto-commit them).
index_has_non_ota_staged() {
  local f
  while IFS= read -r f || [ -n "$f" ]; do
    [ -z "$f" ] && continue
    f="$(normalize_repo_path "$f")"
    [ -z "$f" ] && continue
    # Version-bump commits app.json deliberately later; treat as allowed if alone.
    case "$f" in
      apps/mobile/app.json) continue ;;
    esac
    if ! is_ota_path "$f"; then
      return 0
    fi
  done <<EOF
$(git diff --cached --name-only 2>/dev/null || true)
EOF
  return 1
}

# Ensure author identity for commit (WSL often lacks user.name/email).
# Sets local repo config + GIT_* env; never writes global config.
ensure_git_identity() {
  local name email win_cfg cand user_guess

  name="$(git config user.name 2>/dev/null || true)"
  email="$(git config user.email 2>/dev/null || true)"
  if [ -n "$name" ] && [ -n "$email" ]; then
    export GIT_AUTHOR_NAME="${GIT_AUTHOR_NAME:-$name}"
    export GIT_AUTHOR_EMAIL="${GIT_AUTHOR_EMAIL:-$email}"
    export GIT_COMMITTER_NAME="${GIT_COMMITTER_NAME:-$name}"
    export GIT_COMMITTER_EMAIL="${GIT_COMMITTER_EMAIL:-$email}"
    return 0
  fi

  name="${GIT_AUTHOR_NAME:-${GIT_COMMITTER_NAME:-${TASK_END_SHIP_GIT_NAME:-$name}}}"
  email="${GIT_AUTHOR_EMAIL:-${GIT_COMMITTER_EMAIL:-${TASK_END_SHIP_GIT_EMAIL:-$email}}}"

  if [ -z "$name" ] || [ -z "$email" ]; then
    user_guess="$(whoami 2>/dev/null || true)"
    for cand in \
      "${USERPROFILE:+${USERPROFILE}/.gitconfig}" \
      "/mnt/c/Users/${user_guess}/.gitconfig" \
      "/mnt/c/Users/${USER:-}/.gitconfig" \
      "$HOME/.gitconfig"
    do
      [ -n "${cand:-}" ] || continue
      # Git Bash: USERPROFILE may use backslashes
      win_cfg="$(printf '%s' "$cand" | tr '\\' '/')"
      [ -f "$win_cfg" ] || continue
      [ -z "$name" ] && name="$(git config --file "$win_cfg" --get user.name 2>/dev/null || true)"
      [ -z "$email" ] && email="$(git config --file "$win_cfg" --get user.email 2>/dev/null || true)"
      if [ -n "$name" ] && [ -n "$email" ]; then
        log "git identity loaded from $win_cfg"
        break
      fi
    done
  fi

  if [ -z "$name" ] || [ -z "$email" ]; then
    warn "git identity missing (user.name/email) — skip auto-commit"
    warn "set git config, or TASK_END_SHIP_GIT_NAME / TASK_END_SHIP_GIT_EMAIL"
    return 1
  fi

  # Local only — do not touch global (WSL vs Windows split is intentional)
  git config user.name "$name" 2>/dev/null || true
  git config user.email "$email" 2>/dev/null || true
  export GIT_AUTHOR_NAME="$name"
  export GIT_AUTHOR_EMAIL="$email"
  export GIT_COMMITTER_NAME="$name"
  export GIT_COMMITTER_EMAIL="$email"
  log "git identity ready: $name <$email>"
  return 0
}

DIRTY_TEXT="$(collect_changed_paths)"
classify_paths_text "$DIRTY_TEXT"
DIRTY_HAS_OTA=$HAS_OTA
DIRTY_HAS_BINARY=$HAS_BINARY
DIRTY_HAS_ANY=$HAS_ANY

filter_ota_paths_text "$DIRTY_TEXT"
DIRTY_OTA_TEXT="$OTA_PATHS_TEXT"
DIRTY_OTA_COUNT=0
if [ -n "$DIRTY_OTA_TEXT" ]; then
  DIRTY_OTA_COUNT="$(printf '%s' "$DIRTY_OTA_TEXT" | sed '/^$/d' | wc -l | tr -d ' ')"
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo HEAD)"
IN_WT=0
if is_worktree; then
  IN_WT=1
  log "worktree detected (branch=$BRANCH)"
else
  log "main worktree (branch=$BRANCH)"
fi

# --- Step 1: auto-commit (OTA-safe paths only) --------------------------------
COMMITTED=0
STAGED_BY_US_TEXT=""
if [ "${TASK_END_SHIP_COMMIT:-1}" = "1" ] && [ "$DIRTY_HAS_ANY" = "1" ]; then
  if [ "$DRY_RUN" = "1" ]; then
    if [ "$DIRTY_OTA_COUNT" -gt 0 ]; then
      log "dry-run: would commit ${DIRTY_OTA_COUNT} OTA-safe path(s)"
      printf '%s' "$DIRTY_OTA_TEXT" | sed '/^$/d' | while IFS= read -r f; do
        log "dry-run:   + $f"
      done
    else
      log "dry-run: no OTA-safe paths to commit"
    fi
    if [ "$DIRTY_HAS_BINARY" = "1" ]; then
      log "dry-run: native/binary paths present — will leave unstaged"
    fi
  else
    if [ "$DIRTY_OTA_COUNT" = "0" ] || [ -z "$DIRTY_OTA_TEXT" ]; then
      log "no OTA-safe paths to commit (native/docs left unstaged)"
    elif ! ensure_git_identity; then
      log "auto-commit skipped (no git identity)"
    elif index_has_non_ota_staged; then
      warn "index already has non-OTA staged paths — skip auto-commit (manual cleanup)"
      warn "tip: git restore --staged <native-paths>  then re-run, or reset index"
    else
      STAGED_BY_US_TEXT=""
      while IFS= read -r f || [ -n "$f" ]; do
        [ -z "$f" ] && continue
        f="$(normalize_repo_path "$f")"
        [ -z "$f" ] && continue
        if should_never_commit "$f"; then
          warn "skip staging secret/build path: $f"
          continue
        fi
        if is_binary_path "$f"; then
          warn "skip staging native/binary: $f"
          continue
        fi
        if ! is_ota_path "$f"; then
          log "leave unstaged (non-OTA): $f"
          continue
        fi
        if git add -- "$f" 2>/dev/null; then
          STAGED_BY_US_TEXT="${STAGED_BY_US_TEXT}${f}
"
        else
          warn "git add failed: $f"
        fi
      done <<EOF
$DIRTY_TEXT
EOF

      if [ -n "$STAGED_BY_US_TEXT" ] && ! git diff --cached --quiet 2>/dev/null; then
        # Guard: never commit if index somehow picked up non-OTA
        if index_has_non_ota_staged; then
          warn "refusing commit: non-OTA paths in index — unstaging our adds"
          unstage_paths_text "$STAGED_BY_US_TEXT"
          STAGED_BY_US_TEXT=""
        else
          MSG="chore: task-end auto commit"
          SHORT_STAT="$(git diff --cached --stat | tail -n 1 | tr -s ' ' || true)"
          [ -n "$SHORT_STAT" ] && MSG="chore: task-end auto commit —${SHORT_STAT}"
          if ! git commit -m "$MSG" --no-verify; then
            warn "commit failed — resetting index for paths we staged"
            unstage_paths_text "$STAGED_BY_US_TEXT"
            STAGED_BY_US_TEXT=""
          else
            COMMITTED=1
            STAGED_BY_US_TEXT=""
            log "committed: $MSG"
          fi
        fi
      else
        log "nothing OTA-safe to commit"
      fi
    fi
  fi
elif [ "$DIRTY_HAS_ANY" != "1" ]; then
  log "working tree clean — no auto-commit"
fi

# Eligibility:
#   OTA: dirty OTA (still on disk / dry-run) OR committed HEAD/range
#   BINARY block: only committed content (HEAD/range) — leftover unstaged
#   native in the working tree must not block shipping pure-JS OTA.
HEAD_TEXT="$(git diff-tree --no-commit-id --name-only -r HEAD 2>/dev/null || true)"
classify_paths_text "$HEAD_TEXT"
HEAD_HAS_OTA=$HAS_OTA
HEAD_HAS_BINARY=$HAS_BINARY

RANGE_HAS_OTA=0
RANGE_HAS_BINARY=0
UPSTREAM="$(git rev-parse --abbrev-ref '@{u}' 2>/dev/null || true)"
if [ -n "$UPSTREAM" ]; then
  RANGE_TEXT="$(git diff --name-only "${UPSTREAM}..HEAD" 2>/dev/null || true)"
  classify_paths_text "$RANGE_TEXT"
  RANGE_HAS_OTA=$HAS_OTA
  RANGE_HAS_BINARY=$HAS_BINARY
fi

HAS_OTA=0
HAS_BINARY=0
if [ "$DIRTY_HAS_OTA" = "1" ] || [ "$HEAD_HAS_OTA" = "1" ] || [ "$RANGE_HAS_OTA" = "1" ]; then
  HAS_OTA=1
fi
# Only committed binary/native blocks OTA (not unstaged leftover native)
if [ "$HEAD_HAS_BINARY" = "1" ] || [ "$RANGE_HAS_BINARY" = "1" ]; then
  HAS_BINARY=1
fi

if [ "$FORCE" != "1" ]; then
  if [ "$HAS_BINARY" = "1" ] && [ "$HAS_OTA" != "1" ]; then
    log "binary/native paths only — skip OTA (need EAS Build)"
    if [ "$COMMITTED" = "1" ] && [ "$DRY_RUN" != "1" ]; then
      git push -u origin "$BRANCH" || warn "push failed"
    fi
    exit 0
  fi
  if [ "$HAS_BINARY" = "1" ] && [ "$HAS_OTA" = "1" ]; then
    log "mixed OTA + binary in commits — skip OTA (need EAS Build for native)"
    if [ "$COMMITTED" = "1" ] && [ "$DRY_RUN" != "1" ]; then
      git push -u origin "$BRANCH" || warn "push failed"
    fi
    exit 0
  fi
  if [ "$HAS_OTA" != "1" ]; then
    log "no OTA-safe mobile JS/assets — skip ship"
    if [ "$COMMITTED" = "1" ] && [ "$DRY_RUN" != "1" ]; then
      git push -u origin "$BRANCH" || warn "push of non-OTA commit failed"
    fi
    exit 0
  fi
fi

log "OTA-eligible — continuing ship"

# --- Step 2: version bump (display version only) -----------------------------
# Keep expo.runtimeVersion / Expo.plist EXUpdatesRuntimeVersion unchanged so
# already-shipped binaries still receive this OTA.
NEW_VERSION=""
if [ "${TASK_END_SHIP_BUMP:-1}" = "1" ] && [ -f "$APP_JSON" ]; then
  if [ "$DRY_RUN" = "1" ]; then
    CUR_V="$(node -e 'const j=require(process.argv[1]); process.stdout.write(j.expo.version)' "$APP_JSON" 2>/dev/null || echo '?')"
    log "dry-run: would patch-bump expo.version (currently $CUR_V)"
  else
    NEW_VERSION="$(
      node -e '
const fs = require("fs");
const p = process.argv[1];
const j = JSON.parse(fs.readFileSync(p, "utf8"));
const cur = String((j.expo && j.expo.version) || "0.0.0");
const parts = cur.split(".").map((x) => parseInt(x, 10) || 0);
while (parts.length < 3) parts.push(0);
parts[2] += 1;
const next = parts.join(".");
j.expo.version = next;
// intentionally do NOT touch j.expo.runtimeVersion
fs.writeFileSync(p, JSON.stringify(j, null, 2) + "\n");
process.stdout.write(next);
' "$APP_JSON"
    )"
    log "bumped expo.version → $NEW_VERSION (runtimeVersion unchanged for OTA)"
    git add -- "apps/mobile/app.json"
    if ! git diff --cached --quiet 2>/dev/null; then
      git commit -m "chore: bump display version to $NEW_VERSION" --no-verify
      log "committed version bump"
    fi
  fi
fi

# Refresh branch name (still on feature/master)
BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo HEAD)"

# --- Step 3+4: merge master (if worktree/feature) + push ----------------------
merge_into_main() {
  local branch="$1"
  local main_wt tmp msg

  git fetch origin "$MAIN_BRANCH" 2>/dev/null || true
  git push -u origin "$branch"

  msg="merge: $branch (task-end-ship)"

  main_wt="$(
    git worktree list --porcelain 2>/dev/null | awk -v ref="refs/heads/$MAIN_BRANCH" '
      /^worktree / { wt = substr($0, 10) }
      /^branch / && $2 == ref { print wt; exit }
    '
  )"

  if [ -n "${main_wt:-}" ] && [ -d "$main_wt" ]; then
    log "merge via existing $MAIN_BRANCH worktree: $main_wt"
    if [ "$DRY_RUN" = "1" ]; then
      log "dry-run: would merge $branch → $MAIN_BRANCH in $main_wt"
      return 0
    fi
    git -C "$main_wt" pull --ff-only origin "$MAIN_BRANCH" 2>/dev/null || true
    git -C "$main_wt" merge --no-ff "$branch" -m "$msg"
    git -C "$main_wt" push origin "$MAIN_BRANCH"
    return 0
  fi

  if [ "$IN_WT" != "1" ]; then
    log "merge via local checkout $MAIN_BRANCH"
    if [ "$DRY_RUN" = "1" ]; then
      log "dry-run: would checkout $MAIN_BRANCH and merge $branch"
      return 0
    fi
    git checkout "$MAIN_BRANCH"
    git pull --ff-only origin "$MAIN_BRANCH" 2>/dev/null || true
    git merge --no-ff "$branch" -m "$msg"
    git push origin "$MAIN_BRANCH"
    if [ "$branch" != "$MAIN_BRANCH" ] && [ "$branch" != "main" ]; then
      git checkout "$branch" 2>/dev/null || true
    fi
    return 0
  fi

  tmp="${TMPDIR:-/tmp}/task-end-ship-merge-$$"
  log "merge via temporary worktree: $tmp"
  if [ "$DRY_RUN" = "1" ]; then
    log "dry-run: would temp-worktree merge $branch → $MAIN_BRANCH"
    return 0
  fi
  mkdir -p "$(dirname "$tmp")"
  if git rev-parse --verify "origin/$MAIN_BRANCH" >/dev/null 2>&1; then
    git worktree add --detach "$tmp" "origin/$MAIN_BRANCH"
  else
    git worktree add --detach "$tmp" "$MAIN_BRANCH"
  fi
  git -C "$tmp" merge --no-ff "$branch" -m "$msg"
  git -C "$tmp" push origin "HEAD:refs/heads/$MAIN_BRANCH"
  git worktree remove --force "$tmp" 2>/dev/null || rm -rf "$tmp"
}

if [ "$BRANCH" != "$MAIN_BRANCH" ] && [ "$BRANCH" != "main" ]; then
  if [ "$IN_WT" = "1" ]; then
    log "worktree feature branch → merge into $MAIN_BRANCH + push"
  else
    log "feature branch → merge into $MAIN_BRANCH + push"
  fi
  merge_into_main "$BRANCH"
else
  log "on $BRANCH → push"
  if [ "$DRY_RUN" = "1" ]; then
    log "dry-run: would push origin $BRANCH"
  else
    git push origin "$BRANCH"
  fi
fi

# --- Step 5: EAS Update ------------------------------------------------------
if [ "${TASK_END_SHIP_OTA:-1}" = "0" ]; then
  log "OTA skipped (TASK_END_SHIP_OTA=0)"
  exit 0
fi

if [ ! -d "$MOBILE" ]; then
  warn "apps/mobile missing — skip OTA"
  exit 0
fi

if ! command -v npx >/dev/null 2>&1; then
  warn "npx missing — push done, OTA skipped"
  exit 0
fi

MSG="$(git log -1 --pretty=%s 2>/dev/null || echo task-end-ship)"
if [ -n "$NEW_VERSION" ]; then
  MSG="v$NEW_VERSION — $MSG"
fi

if [ "$DRY_RUN" = "1" ]; then
  log "dry-run: would eas update channels=[$CHANNELS] message=$MSG"
  exit 0
fi

cd "$MOBILE"
for ch in $CHANNELS; do
  log "eas update --channel $ch"
  CI=1 npx eas update --channel "$ch" --message "$MSG" --non-interactive || {
    warn "eas update failed on channel $ch"
    exit 1
  }
done

log "done (version=${NEW_VERSION:-unchanged})"
exit 0
