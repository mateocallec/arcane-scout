#!/usr/bin/env bash
# install.sh — install all dev dependencies for arcane-scout
# Usage: bash scripts/install.sh   (or: npm run install:deps)
set -euo pipefail

# ── Colours ──────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

ok()   { echo -e "  ${GREEN}✓${NC}  $*"; }
warn() { echo -e "  ${YELLOW}⚠${NC}  $*"; }
fail() { echo -e "  ${RED}✗${NC}  $*" >&2; }
info() { echo -e "  ${CYAN}→${NC}  $*"; }
hr()   { echo -e "${CYAN}────────────────────────────────────────────${NC}"; }

# ── Resolve repo root ─────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${ROOT_DIR}"

echo ""
echo -e "${BOLD}Arcane Scout — dependency installer${NC}"
hr

# ── 1. Node.js ────────────────────────────────────────────────────────
echo -e "\n${BOLD}[1/4] Node.js${NC}"
if command -v node &>/dev/null; then
  NODE_VER="$(node --version)"
  NODE_MAJOR="${NODE_VER#v}"; NODE_MAJOR="${NODE_MAJOR%%.*}"
  if [[ "${NODE_MAJOR}" -lt 18 ]]; then
    warn "Node.js ${NODE_VER} detected — version ≥ 18 recommended."
    warn "Upgrade: https://nodejs.org  or  nvm install --lts"
  else
    ok "Node.js ${NODE_VER}"
  fi
else
  fail "Node.js not found."
  echo ""
  echo "  Install options:"
  echo "    • Official:  https://nodejs.org"
  echo "    • nvm:       curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash"
  echo "    • Debian/Kali: sudo apt install nodejs npm"
  echo ""
  exit 1
fi

# ── 2. npm ────────────────────────────────────────────────────────────
echo -e "\n${BOLD}[2/4] npm${NC}"
if command -v npm &>/dev/null; then
  ok "npm $(npm --version)"
else
  fail "npm not found — reinstall Node.js to get npm bundled."
  exit 1
fi

# ── 3. zip (packager) ────────────────────────────────────────────────
echo -e "\n${BOLD}[4/4] zip${NC}"
if command -v zip &>/dev/null; then
  ok "zip available"
else
  warn "zip not found — packaging step will fail."
  warn "Install: sudo apt install zip"
fi

# ── npm install ───────────────────────────────────────────────────────
echo ""
hr
echo -e "\n${BOLD}Installing npm dev dependencies…${NC}\n"
npm install --save-dev 2>&1 | sed 's/^/  /'
echo ""
ok "node_modules installed  ($(node -e "const p=require('./package.json'); const d=Object.keys(p.devDependencies||{}); console.log(d.length+' package'+(d.length!==1?'s':''))"  ))"

# ── Done ──────────────────────────────────────────────────────────────
echo ""
hr
echo -e "\n${GREEN}${BOLD}All dependencies installed.${NC}"
echo ""
echo "  Next steps:"
echo "    npm run build     — lint + assemble dist/"
echo "    npm run package   — build + create a versioned .zip"
echo ""
