#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
if [[ $# -eq 0 || "${1:-}" == --help ]]; then
  echo 'Usage: bash evaluate-full.sh prepare|initialize|check|run|retry --client codex|claude-code [--concurrency 5] [--run NAME]'
  echo 'Dataset: full1140 (1140 cases). Initialize before running; scoring remains manual.'
  echo 'Core port: prepare --core-port 18427. Proxy ports: TDAI_CODEX_PROXY_PORT / TDAI_CLAUDE_PROXY_PORT in evaluation/.env.'
  exit 0
fi
case "$1" in prepare|initialize|check|run|retry) ;; *) echo 'Invalid mode. Use --help.' >&2; exit 2;; esac
MODE="$1"
shift
for argument in "$@"; do
  case "$argument" in --dataset|--dataset=*) echo 'This entry point is fixed to full1140; use evaluate-250.sh for first250.' >&2; exit 2;; esac
done
exec bash "$ROOT/run.sh" "$MODE" --dataset full1140 "$@"
