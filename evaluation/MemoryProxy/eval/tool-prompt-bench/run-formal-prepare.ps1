param(
  [Parameter(Mandatory = $true)][string]$Scope,
  [Parameter(Mandatory = $true)][string]$Variant,
  [Parameter(Mandatory = $true)][string]$Campaign,
  [Parameter(Mandatory = $true)][string]$RepositoryRoot,
  [Parameter(Mandatory = $true)][string]$Config,
  [Parameter(Mandatory = $true)][string]$OutputRoot,
  [Parameter(Mandatory = $true)][string]$ProxyBaseUrl,
  [string]$CaseId,
  [string]$CaseSplit,
  [int]$Repeats = 1,
  [string]$Model = "gpt-5.6-luna",
  [string]$ReasoningEffort = "high",
  [string]$CodeRef = "HEAD",
  [string]$PromptFreezeRef = "task1-code-freeze",
  [switch]$HeldOutAuthorized
)

$entry = Join-Path $PSScriptRoot "formal-prepare-cli.ts"
$proxyRoot = Resolve-Path (Join-Path $PSScriptRoot "../..")
$tsx = Join-Path $proxyRoot "node_modules/.bin/tsx.cmd"
if (-not (Test-Path -LiteralPath $tsx -PathType Leaf)) {
  throw "Local tsx.cmd not found at $tsx. Install the existing MemoryProxy dependencies first."
}
$forward = @(
  "--prepare-only",
  "--scope", $Scope,
  "--variant", $Variant,
  "--campaign", $Campaign,
  "--repository-root", $RepositoryRoot,
  "--config", $Config,
  "--output-root", $OutputRoot,
  "--proxy-base-url", $ProxyBaseUrl,
  "--repeats", $Repeats,
  "--model", $Model,
  "--reasoning-effort", $ReasoningEffort,
  "--code-ref", $CodeRef,
  "--prompt-freeze-ref", $PromptFreezeRef
)
if ($CaseId) { $forward += @("--case-id", $CaseId) }
if ($CaseSplit) { $forward += @("--case-split", $CaseSplit) }
if ($HeldOutAuthorized) { $forward += "--held-out-authorized" }

& $tsx $entry @forward
exit $LASTEXITCODE
