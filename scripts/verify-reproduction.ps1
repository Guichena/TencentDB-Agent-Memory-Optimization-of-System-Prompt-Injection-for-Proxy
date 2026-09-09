param()
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$proxy = Join-Path $root 'evaluation/MemoryProxy'
$vitest = Join-Path $proxy 'node_modules/vitest/vitest.mjs'
if (-not (Test-Path -LiteralPath $vitest)) { throw 'Install dependencies first: npm --prefix evaluation/MemoryProxy ci' }
Push-Location $root
try {
  & node --test scripts/check-submission.test.mjs scripts/prepare-workspaces.test.mjs scripts/workspace-bundle.test.mjs scripts/audit-final5-input.test.mjs scripts/final5-static-input.test.mjs scripts/summarize-final5-complete.test.mjs
  if ($LASTEXITCODE -ne 0) { throw 'Offline script tests failed' }
  & node $vitest run --config (Join-Path $proxy 'vitest.reproduction.config.ts')
  if ($LASTEXITCODE -ne 0) { throw 'Final5 reproduction tests failed' }
} finally { Pop-Location }
