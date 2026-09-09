param(
  [ValidateSet('preview','check','execute')]
  [string]$Mode = 'preview',
  [string]$Config = (Join-Path $PSScriptRoot 'final5-evaluation.json'),
  [switch]$Resume,
  [ValidateSet('both','baseline','V4')]
  [string]$Variant = 'both',
  [ValidateSet('both','codex','claude-code')]
  [string]$Client = 'both',
  [switch]$Quick,
  [switch]$WorkspaceBundle,
  [string]$BundleRoot = (Join-Path $PSScriptRoot '../workspaces')
)

$ErrorActionPreference = 'Stop'
$submissionRoot = Split-Path $PSScriptRoot -Parent
$proxyRoot = Join-Path $submissionRoot 'evaluation\MemoryProxy'
$runner = Join-Path $proxyRoot 'eval\tool-prompt-bench\run-final5-dual.ts'
$tsx = Join-Path $proxyRoot 'node_modules\tsx\dist\cli.mjs'

if (-not (Test-Path -LiteralPath $Config)) { throw "Evaluation config not found: $Config" }
if (-not (Test-Path -LiteralPath $tsx)) { throw 'Run npm ci in evaluation\MemoryProxy first.' }

$bundleIndex = Join-Path $BundleRoot 'bundle.json'
$autoBundle = (Test-Path -LiteralPath $bundleIndex) -and ((Get-Content -LiteralPath $bundleIndex -Raw | ConvertFrom-Json).layout -eq 'expanded-sources-v1')
if ($WorkspaceBundle -or $autoBundle) {
  if ($Resume -and -not $autoBundle) { throw 'For resume, use the generated evaluation.local.json without -WorkspaceBundle.' }
  $preparedRoot = Join-Path $submissionRoot ('runs/bundled-' + [guid]::NewGuid().ToString())
  $prepareMode = if ($autoBundle) { 'auto' } else { 'prepare' }
  & node (Join-Path $PSScriptRoot 'workspace-bundle.mjs') $prepareMode --config (Resolve-Path $Config).Path --bundle $BundleRoot --output $preparedRoot
  if ($LASTEXITCODE -ne 0) { throw 'Workspace bundle preparation failed' }
  $Config = Join-Path $preparedRoot 'evaluation.local.json'
  Write-Host "Prepared evaluation config: $Config"
}

$arguments = @($tsx, $runner, '--config', (Resolve-Path $Config).Path, "--$Mode")
if ($Resume) { $arguments += '--resume' }
if ($Variant -eq 'baseline') { $arguments += '--baseline-only' }
if ($Variant -eq 'V4') { $arguments += '--v4-only' }
if ($Client -ne 'both') { $arguments += @('--client', $Client) }
if ($Quick) { $arguments += '--quick' }
& node --use-env-proxy @arguments
if ($LASTEXITCODE -ne 0) { throw "Evaluation failed with exit code $LASTEXITCODE" }
