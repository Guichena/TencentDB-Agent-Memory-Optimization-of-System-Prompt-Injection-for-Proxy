#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"
if [[ "$(uname -s)" != Linux ]]; then
  echo 'This entry point targets Linux.' >&2
  exit 2
fi
if [[ "${1:-}" == doctor ]]; then
  shift
  exec node doctor.mjs "$@"
fi
if [[ "${1:-}" == audit ]]; then
  shift
  exec node ../evaluation/MemoryProxy/node_modules/tsx/dist/cli.mjs audit-retries.ts "$@"
fi
if [[ "${1:-}" == score-audits ]]; then
  shift
  exec node ../evaluation/MemoryProxy/node_modules/tsx/dist/cli.mjs score-audits.ts "$@"
fi
exec node ../evaluation/MemoryProxy/node_modules/tsx/dist/cli.mjs entry.ts "$@"
