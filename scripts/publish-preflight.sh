#!/usr/bin/env bash
# publish-preflight.sh
#
# Validate credentials and package contents before a live publish.
# Run this after a failed publish and before retrying.
#
# Usage: bash scripts/publish-preflight.sh [--registry <url>]
#
# Exit codes:
#   0 — all checks passed
#   1 — one or more checks failed

set -euo pipefail

REGISTRY="https://registry.npmjs.org"

# Parse optional --registry argument
if [[ "${1:-}" == "--registry" && -n "${2:-}" ]]; then
  REGISTRY="$2"
fi

PASS=0
FAIL=1
EXIT_CODE=$PASS

log_pass() { echo "  ✔  $*"; }
log_fail() { echo "  ✘  $*" >&2; EXIT_CODE=$FAIL; }
log_info() { echo "  ·  $*"; }

echo ""
echo "sorokit-core publish preflight"
echo "=============================="
echo ""

# 1. Registry authentication
echo "1. Registry authentication"
if npm whoami --registry "$REGISTRY" >/dev/null 2>&1; then
  WHOAMI=$(npm whoami --registry "$REGISTRY" 2>/dev/null)
  log_pass "Authenticated as: $WHOAMI"
else
  log_fail "Not authenticated. Run: npm login --registry $REGISTRY"
fi
echo ""

# 2. package.json version
echo "2. package.json version"
PKG_VERSION=$(node -p "require('./package.json').version" 2>/dev/null || echo "")
PKG_NAME=$(node -p "require('./package.json').name" 2>/dev/null || echo "sorokit-core")
if [ -n "$PKG_VERSION" ]; then
  log_pass "$PKG_NAME version: $PKG_VERSION"
else
  log_fail "Could not read version from package.json"
fi
echo ""

# 3. Check whether this version already exists on the registry
echo "3. Registry version check"
if [ -n "$PKG_VERSION" ]; then
  EXISTING=$(npm info "${PKG_NAME}@${PKG_VERSION}" version --registry "$REGISTRY" 2>/dev/null || echo "")
  if [ -n "$EXISTING" ]; then
    log_fail "Version $PKG_VERSION is already published on the registry. Bump the version before retrying."
  else
    log_pass "Version $PKG_VERSION is not yet on the registry — safe to publish."
  fi
fi
echo ""

# 4. Git tag alignment
echo "4. Git tag alignment"
TAG="v${PKG_VERSION}"
if git tag --list "$TAG" | grep -q "$TAG"; then
  TAG_COMMIT=$(git rev-list -n 1 "$TAG" 2>/dev/null || echo "")
  HEAD_COMMIT=$(git rev-parse HEAD 2>/dev/null || echo "")
  if [ "$TAG_COMMIT" = "$HEAD_COMMIT" ]; then
    log_pass "Tag $TAG points to HEAD ($HEAD_COMMIT)"
  else
    log_fail "Tag $TAG points to $TAG_COMMIT but HEAD is $HEAD_COMMIT — re-tag or checkout the tagged commit."
  fi
else
  log_info "Tag $TAG does not exist yet. Create it after a successful publish."
fi
echo ""

# 5. Build output present
echo "5. Build output"
if [ -d "dist" ] && [ "$(ls -A dist 2>/dev/null)" ]; then
  log_pass "dist/ directory is present and non-empty."
else
  log_fail "dist/ is missing or empty. Run: yarn build"
fi
echo ""

# 6. Publish dry-run
echo "6. Publish dry-run"
DRY_RUN_OUTPUT=$(npm publish --dry-run --registry "$REGISTRY" 2>&1 || true)
if echo "$DRY_RUN_OUTPUT" | grep -q "npm notice"; then
  log_pass "npm publish --dry-run succeeded."
else
  log_fail "npm publish --dry-run reported errors — fix before publishing."
  echo "$DRY_RUN_OUTPUT" | head -20 >&2
fi
echo ""

echo "=============================="
if [ "$EXIT_CODE" -eq "$PASS" ]; then
  echo "All preflight checks passed. Safe to publish."
else
  echo "One or more preflight checks failed. Resolve the issues above before publishing." >&2
fi
echo ""

exit "$EXIT_CODE"
