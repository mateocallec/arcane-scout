#!/usr/bin/env bash
# build.sh — lint, generate icons, and assemble dist/
# Usage: bash scripts/build.sh   (or: npm run build)
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

echo ""
echo -e "${BOLD}Arcane Scout — build${NC}"
hr

# ── Prerequisite check ────────────────────────────────────────────────
step "1/3" "Checking prerequisites"

if [[ ! -d "node_modules" ]]; then
  warn "node_modules not found — running install first…"
  bash scripts/install.sh
fi

if [[ ! -f "node_modules/.bin/eslint" ]]; then
  fail "ESLint not found in node_modules. Run: npm install"
  exit 1
fi
ok "Prerequisites satisfied"

# ── Step 2: Lint ──────────────────────────────────────────────────────
step "2/3" "Linting JavaScript"

LINT_FILES=(
  devtools.js
  background.js
  panel/network.js
  panel/ui.js
  panel/panel.js
  popup/popup.js
  pentest/pentest.js
)

LINT_ERRORS=0
for f in "${LINT_FILES[@]}"; do
  if [[ ! -f "${f}" ]]; then
    warn "Skipping lint for missing file: ${f}"
    continue
  fi
  set +e
  OUTPUT="$(node_modules/.bin/eslint "${f}" 2>&1)"
  EXIT_CODE=$?
  set -e
  if [[ ${EXIT_CODE} -ne 0 ]]; then
    fail "Lint issues in ${f}:"
    echo "${OUTPUT}" | sed 's/^/      /'
    LINT_ERRORS=$((LINT_ERRORS + 1))
  else
    ok "  ${f}"
  fi
done

if [[ ${LINT_ERRORS} -gt 0 ]]; then
  echo ""
  fail "Lint failed with errors in ${LINT_ERRORS} file(s). Fix them before building."
  exit 1
fi

# ── Step 3: Assemble dist/ ────────────────────────────────────────────
step "3/3" "Assembling dist/"

# Clean and recreate
rm -rf "${DIST_DIR}"
mkdir -p "${DIST_DIR}/panel"
mkdir -p "${DIST_DIR}/popup"
mkdir -p "${DIST_DIR}/pentest"
mkdir -p "${DIST_DIR}/icons"

# Root-level extension files
COPY_ROOT=(
  manifest.json
  devtools.html
  devtools.js
  background.js
)
for f in "${COPY_ROOT[@]}"; do
  cp "${f}" "${DIST_DIR}/${f}"
  ok "  ${f}"
done

# Panel directory
COPY_PANEL=(
  panel/panel.html
  panel/panel.css
  panel/network.js
  panel/ui.js
  panel/panel.js
)
for f in "${COPY_PANEL[@]}"; do
  cp "${f}" "${DIST_DIR}/${f}"
  ok "  ${f}"
done

# Popup directory
COPY_POPUP=(
  popup/popup.html
  popup/popup.css
  popup/popup.js
)
for f in "${COPY_POPUP[@]}"; do
  cp "${f}" "${DIST_DIR}/${f}"
  ok "  ${f}"
done

# Pentest directory
COPY_PENTEST=(
  pentest/pentest.html
  pentest/pentest.css
  pentest/pentest.js
)
for f in "${COPY_PENTEST[@]}"; do
  cp "${f}" "${DIST_DIR}/${f}"
  ok "  ${f}"
done

# Icons
for png in icons/icon16.png icons/icon48.png icons/icon128.png; do
  if [[ -f "${png}" ]]; then
    cp "${png}" "${DIST_DIR}/${png}"
    ok "  ${png}"
  else
    warn "  Missing icon: ${png}"
  fi
done

# ── Validate dist/ ────────────────────────────────────────────────────
echo ""
REQUIRED_FILES=(
  "${DIST_DIR}/manifest.json"
  "${DIST_DIR}/devtools.html"
  "${DIST_DIR}/devtools.js"
  "${DIST_DIR}/background.js"
  "${DIST_DIR}/panel/panel.html"
  "${DIST_DIR}/panel/panel.css"
  "${DIST_DIR}/panel/network.js"
  "${DIST_DIR}/panel/ui.js"
  "${DIST_DIR}/panel/panel.js"
  "${DIST_DIR}/popup/popup.html"
  "${DIST_DIR}/popup/popup.css"
  "${DIST_DIR}/popup/popup.js"
  "${DIST_DIR}/pentest/pentest.html"
  "${DIST_DIR}/pentest/pentest.css"
  "${DIST_DIR}/pentest/pentest.js"
  "${DIST_DIR}/icons/icon16.png"
  "${DIST_DIR}/icons/icon48.png"
  "${DIST_DIR}/icons/icon128.png"
)

MISSING=0
for f in "${REQUIRED_FILES[@]}"; do
  if [[ ! -f "${f}" ]]; then
    fail "Missing required file: ${f##"${ROOT_DIR}/"}"
    MISSING=$((MISSING + 1))
  fi
done

if [[ ${MISSING} -gt 0 ]]; then
  fail "Build incomplete — ${MISSING} required file(s) missing."
  exit 1
fi

# Print dist/ summary
DIST_SIZE="$(du -sh "${DIST_DIR}" 2>/dev/null | cut -f1)"
FILE_COUNT="$(find "${DIST_DIR}" -type f | wc -l | tr -d ' ')"

# ── Done ──────────────────────────────────────────────────────────────
echo ""
hr
echo -e "\n${GREEN}${BOLD}Build complete.${NC}"
echo ""
echo "  Output:  dist/  (${FILE_COUNT} files, ${DIST_SIZE})"
echo ""
echo "  Load in Chrome:"
echo "    1. chrome://extensions  →  Enable Developer mode"
echo "    2. Load unpacked  →  select  dist/"
echo ""
echo "  Or package for distribution:"
echo "    npm run package"
echo ""
