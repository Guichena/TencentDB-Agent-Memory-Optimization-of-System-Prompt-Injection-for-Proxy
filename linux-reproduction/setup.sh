#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
[[ "$(uname -s)" == Linux ]] || { echo 'Linux is required' >&2; exit 2; }
[[ "$(id -u)" != 0 ]] || { echo 'Run as a non-root user with a user-owned Node installation' >&2; exit 2; }
CLIENT="${1:-}"
case "$CLIENT" in codex|claude-code) ;; *) echo 'Usage: bash linux-reproduction/setup.sh codex|claude-code' >&2; exit 2;; esac
node -e 'const [a,b]=process.versions.node.split(".").map(Number);if(a!==24||b<5)throw Error("Node.js 24.5+ (24.x) required")'
for command in git bsdtar python3 make g++; do command -v "$command" >/dev/null || { echo "Missing $command" >&2; exit 2; }; done
npm --prefix evaluation/MemoryProxy ci
npm --prefix implementations/baseline/MemoryProxy ci
npm --prefix implementations/final/MemoryProxy ci
npx --yes pnpm@10.11.0 --dir implementations/final/MemoryCore install --prod --frozen-lockfile --ignore-scripts
if [[ "$CLIENT" == codex ]]; then
  npm install -g '@openai/codex@0.149.1'
  codex --version
else
  npm install -g '@anthropic-ai/claude-code@2.1.260'
  claude --version
fi
if [[ ! -f evaluation/.env ]]; then cp linux-reproduction/env.example evaluation/.env; chmod 600 evaluation/.env; fi
node evaluation/MemoryProxy/node_modules/tsx/dist/cli.mjs linux-reproduction/verify.ts
echo 'Installed. Fill evaluation/.env. Existing .env was not overwritten.'
