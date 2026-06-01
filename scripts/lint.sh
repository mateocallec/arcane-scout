#!/usr/bin/env bash
# lint.sh — run ESLint across all extension JS files
# Usage: bash scripts/lint.sh   (or: npm run lint)
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

ok()   { echo -e "  ${GREEN}✓${NC}  $*"; }
warn() { echo -e "  ${YELLOW}⚠${NC}  $*"; }
fail() { echo -e "  ${RED}✗${NC}  $*" >&2; }
hr()   { echo -e "${CYAN}────────────────────────────────────────────${NC}"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

echo ""
echo -e "${BOLD}Arcane Scout — lint${NC}"
hr

if [[ ! -f "node_modules/.bin/eslint" ]]; then
  fail "ESLint not found. Run: npm install"
  exit 1
fi

FILES=(
  devtools.js
  background.js
  panel/network.js
  panel/ui.js
  panel/panel.js
  pentest/pentest.js
  docs/docs.js
)

ERRORS=0
for f in "${FILES[@]}"; do
  if [[ ! -f "${f}" ]]; then
    warn "Skipping missing file: ${f}"
    continue
  fi
  set +e
  OUTPUT="$(node_modules/.bin/eslint "${f}" 2>&1)"
  EXIT_CODE=$?
  set -e
  if [[ ${EXIT_CODE} -ne 0 ]]; then
    fail "${f}"
    echo "${OUTPUT}" | sed 's/^/      /'
    ERRORS=$((ERRORS + 1))
  else
    ok "${f}"
  fi
done

echo ""
hr

if [[ ${ERRORS} -gt 0 ]]; then
  echo -e "\n${RED}${BOLD}Lint failed — ${ERRORS} file(s) have issues.${NC}\n"
  exit 1
fi

echo -e "\n${GREEN}${BOLD}All files clean.${NC}\n"
