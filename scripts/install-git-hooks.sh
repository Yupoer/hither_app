#!/usr/bin/env sh
# Install repo git hooks (run after clone). See SETUP_NEW_MACHINE.md.
set -eu
ROOT="$(git rev-parse --show-toplevel)"
HOOKS="$ROOT/.git/hooks"
SCRIPTS="$ROOT/scripts"

mkdir -p "$HOOKS"

# pre-push: jest + tsc (existing gate)
cat > "$HOOKS/pre-push" <<'EOF'
#!/bin/sh
cd "$(git rev-parse --show-toplevel)/apps/mobile" || exit 1
npm test -- --silent || exit 1
npm run typecheck || exit 1
EOF
chmod +x "$HOOKS/pre-push" 2>/dev/null || true

# post-commit: OTA-only auto ship (push + EAS Update)
# Uses relative path via git toplevel inside the script.
cp "$SCRIPTS/ota-auto-ship.sh" "$HOOKS/post-commit"
chmod +x "$HOOKS/post-commit" 2>/dev/null || true
# Ensure script itself is executable when invoked from hook path
chmod +x "$SCRIPTS/ota-auto-ship.sh" 2>/dev/null || true

echo "Installed hooks:"
echo "  pre-push     → jest + tsc"
echo "  post-commit  → ota-auto-ship (OTA-safe commits only)"
echo "Disable OTA ship: OTA_AUTO_SHIP=0 git commit ..."
