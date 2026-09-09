#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ "$(uname -s)" != Darwin ]]; then
  echo 'Use scripts/setup.ps1 on native Windows; WSL/Linux is not supported by this bootstrap.' >&2
  exit 1
fi
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! xcrun --find clang++ >/dev/null 2>&1; then
  xcode-select --install || true
  echo 'Finish the macOS Command Line Tools installer, then rerun this command.' >&2
  exit 2
fi
NEEDED=()
if ! command -v node >/dev/null || ! node -e 'const [a,b]=process.versions.node.split(".").map(Number);process.exit(a>22||(a===22&&b>=13)?0:1)' ; then NEEDED+=(node); fi
if ! command -v cmake >/dev/null; then NEEDED+=(cmake); fi
if ! command -v ffmpeg >/dev/null || ! command -v ffprobe >/dev/null; then NEEDED+=(ffmpeg); fi
if ((${#NEEDED[@]})); then
  if ! command -v brew >/dev/null; then
    echo "Missing ${NEEDED[*]}. Install Homebrew using its official installer or install these tools, then rerun." >&2
    exit 2
  fi
  for package in "${NEEDED[@]}"; do
    if brew list --versions "$package" >/dev/null 2>&1; then brew upgrade "$package"; else brew install "$package"; fi
  done
fi
exec node "$ROOT/scripts/setup.mjs" "$@"
