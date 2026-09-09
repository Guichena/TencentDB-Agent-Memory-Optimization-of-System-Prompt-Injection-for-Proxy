param(
  [Parameter(Mandatory=$true)]
  [string]$OutputRoot
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$bench = Join-Path $root 'evaluation/MemoryProxy/eval/tool-prompt-bench'
$data = Join-Path $bench 'formal-dataset/final5/test100'
$tsx = Join-Path $root 'evaluation/MemoryProxy/node_modules/tsx/dist/cli.mjs'
$output = [IO.Path]::GetFullPath($OutputRoot)
$runs = [IO.Path]::GetFullPath((Join-Path $root 'runs'))
if (-not $output.StartsWith($runs + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'OutputRoot must be a new directory under this repository runs/' }
if (Test-Path -LiteralPath $output) { throw 'Use a new run directory; existing experiment inputs are not overwritten.' }
& python (Join-Path $data 'sync_listing_from_assets.py')
if ($LASTEXITCODE -ne 0) { throw 'Listing sync failed' }
& python (Join-Path $data 'validate_test100.py')
if ($LASTEXITCODE -ne 0) { throw 'test100 validation failed' }
& node $tsx (Join-Path $bench 'prepare-final5-test100.ts') $output
if ($LASTEXITCODE -ne 0) { throw 'Campaign preparation failed' }
& node $tsx (Join-Path $bench 'formal-assets/final5-restore-bundle.ts') (Join-Path $output 'inputs/restore-bundle.json') (Join-Path $output 'inputs/evaluation.json')
if ($LASTEXITCODE -ne 0) { throw 'Restore bundle preparation failed' }
Write-Output 'Prepared inputs only. No assets imported and no model experiment started.'
