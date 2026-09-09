param(
  [ValidateSet('prepare','initialize','check','execute')]
  [string]$Mode = 'prepare',
  [string]$OutputRoot = (Join-Path $PSScriptRoot '../runs/test1k'),
  [int]$CorePort = 8427,
  [ValidateSet('both','codex','claude-code')]
  [string]$Client = 'both',
  [ValidateSet('both','baseline','V4')]
  [string]$Variant = 'both',
  [string]$BundleRoot = (Join-Path $PSScriptRoot '../workspaces'),
  [string]$CaseId = '',
  [switch]$Smoke
)
$ErrorActionPreference = 'Stop'
if ($Smoke) {
  if ($PSBoundParameters.ContainsKey('Mode') -and $Mode -ne 'execute') { throw '-Smoke requires execute mode; omit -Mode.' }
  if ($Client -eq 'both') { throw 'Choose one smoke client: -Client codex or -Client claude-code.' }
  if (-not $PSBoundParameters.ContainsKey('Variant')) { $Variant = 'V4' }
  if ($Variant -eq 'both') { throw 'Smoke runs one variant; choose V4 or baseline.' }
  if (-not $CaseId) { $CaseId = 'DVG-T04-T01-C001' }
  $Mode = 'execute'
  Write-Host "Single-case smoke: client=$Client variant=$Variant case=$CaseId"
}
$root = Split-Path $PSScriptRoot -Parent
$tsx = Join-Path $root 'evaluation/MemoryProxy/node_modules/tsx/dist/cli.mjs'
if (-not (Test-Path $tsx)) { throw 'Install dependencies: npm --prefix evaluation/MemoryProxy ci' }
& node $tsx (Join-Path $root 'evaluation/MemoryProxy/eval/tool-prompt-bench/test1k-entry.ts') $Mode ([IO.Path]::GetFullPath($OutputRoot)) $CorePort $Client $Variant ([IO.Path]::GetFullPath($BundleRoot)) $CaseId
if ($LASTEXITCODE -ne 0) { throw "test1k $Mode failed. See the error or setup-logs in the run directory." }
