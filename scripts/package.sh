#!/usr/bin/env bash
# package.sh — build the extension and produce a versioned .zip ready for
#              Chrome Web Store upload or sideloading.
# Usage: bash scripts/package.sh   (or: npm run package)
#
# Output: releases/arcane-scout-v<version>.zip
#         The zip root contains manifest.json directly (no wrapper folder),
#         which is the format required by the Chrome Web Store.
set -euo pipefail

# ── Colours ──────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

ok()   { echo -e "  ${GREEN}✓${NC}  $*"; }
warn() { echo -e "  ${YELLOW}⚠${NC}  $*"; }
fail() { echo -e "  ${RED}✗${NC}  $*" >&2; }
info() { echo -e "  ${CYAN}→${NC}  $*"; }
hr()   { echo -e "${CYAN}────────────────────────────────────────────${NC}"; }
step() { echo -e "\n${BOLD}[$1] $2${NC}"; }

# ── Resolve repo root ─────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

DIST_DIR="${ROOT_DIR}/dist"
RELEASES_DIR="${ROOT_DIR}/releases"

echo ""
echo -e "${BOLD}Arcane Scout — packager${NC}"
hr

# ── Prerequisite: zip ────────────────────────────────────────────────
step "1/3" "Checking prerequisites"

if ! command -v zip &>/dev/null; then
  fail "'zip' command not found. Install it with: sudo apt install zip"
  exit 1
fi
ok "zip available"

if ! command -v node &>/dev/null; then
  fail "Node.js not found — cannot read manifest version."
  exit 1
fi
ok "Node.js $(node --version)"

# ── Build ─────────────────────────────────────────────────────────────
step "2/3" "Building dist/"
bash scripts/build.sh

# ── Read version from manifest ────────────────────────────────────────
MANIFEST_VERSION="$(node -e "process.stdout.write(require('./dist/manifest.json').version)")"
ZIP_NAME="arcane-scout-v${MANIFEST_VERSION}.zip"
ZIP_PATH="${RELEASES_DIR}/${ZIP_NAME}"

# ── Create zip ────────────────────────────────────────────────────────
step "3/3" "Creating release archive"

mkdir -p "${RELEASES_DIR}"

# Remove previous build of the same version if it exists
if [[ -f "${ZIP_PATH}" ]]; then
  warn "Overwriting existing: releases/${ZIP_NAME}"
  rm "${ZIP_PATH}"
fi

# Zip from inside dist/ so manifest.json is at the archive root
(cd "${DIST_DIR}" && zip -r --quiet "${ZIP_PATH}" .)

ZIP_SIZE="$(du -sh "${ZIP_PATH}" | cut -f1)"
FILE_COUNT="$(unzip -l "${ZIP_PATH}" | tail -1 | awk '{print $2}')"
CHECKSUM="$(sha256sum "${ZIP_PATH}" | cut -d' ' -f1)"

ok "releases/${ZIP_NAME}  (${ZIP_SIZE}, ${FILE_COUNT} files)"

# ── Done ──────────────────────────────────────────────────────────────
echo ""
hr
echo -e "\n${GREEN}${BOLD}Package complete.${NC}"
echo ""
echo "  File:      releases/${ZIP_NAME}"
echo "  Size:      ${ZIP_SIZE}"
echo "  SHA-256:   ${CHECKSUM}"
echo ""
echo "  To install (sideload):"
echo "    1. chrome://extensions  →  Enable Developer mode"
echo "    2. Drag & drop  releases/${ZIP_NAME}  onto the page"
echo ""
echo "  Or upload to the Chrome Web Store Developer Dashboard."
echo ""
