param(
  [Parameter(Mandatory = $true)][string]$CampaignId,
  [Parameter(Mandatory = $true)][string]$CampaignRoot,
  [Parameter(Mandatory = $true)][string]$TraceCampaignDirectory,
  [Parameter(Mandatory = $true)][string]$RepositoryRoot,
  [ValidateSet("dev", "hidden_test")][string]$Split = "dev",
  [Parameter(Mandatory = $true)]
  [ValidateSet("dev-discovery", "dev-confirmation", "hidden")]
  [string]$CampaignPhase,
  [Parameter(Mandatory = $true)][string]$OutputPath,
  [switch]$AllowHiddenTest
)

$ErrorActionPreference = "Stop"
$memoryProxyRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$tsx = Join-Path $memoryProxyRoot "node_modules\.bin\tsx.cmd"
if (-not (Test-Path -LiteralPath $tsx)) {
  throw "tsx.cmd was not found under MemoryProxy/node_modules. This script does not install packages."
}

$arguments = @(
  (Join-Path $PSScriptRoot "formal-collect-score-cli.ts"),
  "--campaign-id", $CampaignId,
  "--campaign-root", $CampaignRoot,
  "--trace-campaign-dir", $TraceCampaignDirectory,
  "--repo-root", $RepositoryRoot,
  "--split", $Split,
  "--campaign-phase", $CampaignPhase,
  "--output", $OutputPath
)
if ($AllowHiddenTest) { $arguments += "--allow-hidden-test" }

& $tsx @arguments
if ($LASTEXITCODE -ne 0) {
  throw "Formal result collection failed with exit code $LASTEXITCODE"
}
