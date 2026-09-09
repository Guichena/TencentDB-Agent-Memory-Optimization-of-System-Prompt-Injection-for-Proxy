param(
  [Parameter(Mandatory = $true)][string]$RunDirectory,
  [Parameter(Mandatory = $true)][string]$PreflightReceipt,
  [Parameter(Mandatory = $true)][string]$KnowledgeHealthUrl,
  [Parameter(Mandatory = $true)][string]$KnowledgeInstanceId,
  [Parameter(Mandatory = $true)][string]$RepositoryRoot,
  [int]$TimeoutMs = 180000
)

$ErrorActionPreference = "Stop"
$memoryProxyRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$tsx = Join-Path $memoryProxyRoot "node_modules\.bin\tsx.cmd"
if (-not (Test-Path -LiteralPath $tsx)) {
  throw "tsx.cmd was not found under MemoryProxy/node_modules. Use the existing project dependencies; this script does not install packages."
}

& $tsx `
  (Join-Path $PSScriptRoot "formal-execution-cli.ts") `
  --run-dir $RunDirectory `
  --preflight-receipt $PreflightReceipt `
  --knowledge-health-url $KnowledgeHealthUrl `
  --knowledge-instance-id $KnowledgeInstanceId `
  --repo-root $RepositoryRoot `
  --timeout-ms $TimeoutMs

if ($LASTEXITCODE -ne 0) {
  throw "Formal execution failed with exit code $LASTEXITCODE"
}
