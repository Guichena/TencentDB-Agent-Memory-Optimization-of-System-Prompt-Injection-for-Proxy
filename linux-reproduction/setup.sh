#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
[[ "$(uname -s)" == Linux ]] || { echo 'Linux is required' >&2; exit 2; }
[[ "$(id -u)" != 0 ]] || { echo 'Run as a non-root user with a user-owned Node installation' >&2; exit 2; }
CLIENT="${1:-}"
case "$CLIENT" in codex|claude-code) ;; *) echo 'Usage: bash linux-reproduction/setup.sh codex|claude-code' >&2; exit 2;; esac
node -e 'const [a,b]=process.versions.node.split(".").map(Number);if(a!==24||b<5)throw Error("Node.js 24.5+ (24.x) required")'
for command in git curl go bsdtar python3 python3-config make g++; do command -v "$command" >/dev/null || { echo "Missing $command (install the prerequisites listed in the Linux guide)" >&2; exit 2; }; done
node linux-reproduction/check-install.mjs
npm --prefix evaluation/MemoryProxy ci
npm --prefix implementations/baseline/MemoryProxy ci
npm --prefix implementations/final/MemoryProxy ci
npx --yes pnpm@10.11.0 --dir implementations/final/MemoryCore install --prod --frozen-lockfile --ignore-scripts
# sqlite-vec ships platform binaries as optional dependencies, not via postinstall.
# Validate actual native loading instead of enabling unrelated Core/OpenClaw hooks.
node linux-reproduction/check-native.mjs
CLI_PREFIX="$ROOT/.runtime/linux-cli"
if [[ "$CLIENT" == codex ]]; then
  CLI_NAME=codex
  CLI_PACKAGE='@openai/codex@0.149.1'
else
  CLI_NAME=claude
  CLI_PACKAGE='@anthropic-ai/claude-code@2.1.260'
fi
export PATH="$PATH:$CLI_PREFIX/bin"
if ! command -v "$CLI_NAME" >/dev/null 2>&1; then
  mkdir -p "$CLI_PREFIX"
  npm install --global --prefix "$CLI_PREFIX" "$CLI_PACKAGE"
fi
echo "Using $CLI_NAME: $(command -v "$CLI_NAME")"
"$CLI_NAME" --version
if [[ ! -f evaluation/.env ]]; then cp linux-reproduction/env.example evaluation/.env; chmod 600 evaluation/.env; fi
node evaluation/MemoryProxy/node_modules/tsx/dist/cli.mjs linux-reproduction/verify.ts
echo 'Installed. Fill evaluation/.env. Existing .env was not overwritten.'
