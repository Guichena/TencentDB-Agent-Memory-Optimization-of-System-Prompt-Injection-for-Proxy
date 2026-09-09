[CmdletBinding()]
param(
  [ValidateSet("case", "smoke", "dev", "test")]
  [string]$Scope = "case",
  [string]$CaseId,
  [ValidateSet("V0", "V0-C", "V1a", "V1", "V2", "V3")]
  [string]$Variant = "V0",
  [ValidateRange(1, 10)]
  [int]$Repeats = 1,
  [string]$Model = "gpt-5.6-luna",
  [ValidateSet("minimal", "low", "medium", "high", "xhigh")]
  [string]$ReasoningEffort = "high",
  [ValidateSet("low", "medium", "high")]
  [string]$Verbosity = "medium",
  [string]$CodexHome = $(if ($env:CODEX_HOME) { $env:CODEX_HOME } else { Join-Path $env:USERPROFILE ".codex" }),
  [string]$ProviderBaseUrl = "http://127.0.0.1:8096/codex/tool-prompt-bench/v1",
  [string]$ProxyHealthUrl = "http://127.0.0.1:8096/health",
  [string]$ExpectedCodexUpstream = "https://chatgpt.com/backend-api/codex",
  [ValidateRange(10000, 1800000)]
  [int]$TimeoutMs = 180000,
  [switch]$AllowHeldOutTest,
  [switch]$PrepareOnly
)

$ErrorActionPreference = "Stop"
$benchmarkRoot = Split-Path -Parent $PSCommandPath
$proxyRoot = Resolve-Path (Join-Path $benchmarkRoot "../..")
$resolvedCodexHome = [System.IO.Path]::GetFullPath($CodexHome)
$npmCommand = if (Get-Command npm.cmd -ErrorAction SilentlyContinue) { "npm.cmd" } else { "npm" }

if ($Scope -eq "case" -and [string]::IsNullOrWhiteSpace($CaseId)) {
  throw "-Scope case requires -CaseId."
}
if ($Scope -eq "test" -and -not $AllowHeldOutTest) {
  throw "Test is held out. Add -AllowHeldOutTest only for the preregistered final comparison."
}
if (-not (Test-Path -LiteralPath $resolvedCodexHome -PathType Container)) {
  throw "CODEX_HOME does not exist: $resolvedCodexHome"
}

function Read-JsonLines([string]$Path) {
  return Get-Content -LiteralPath $Path | Where-Object { $_.Trim() } | ForEach-Object { $_ | ConvertFrom-Json }
}

function Write-Utf8NoBom([string]$Path, [string]$Content) {
  [System.IO.File]::WriteAllText($Path, $Content, [System.Text.UTF8Encoding]::new($false))
}

$caseIds = switch ($Scope) {
  "case" { @($CaseId) }
  "smoke" { @((Get-Content -LiteralPath (Join-Path $benchmarkRoot "cases/smoke-case-ids.json") -Raw | ConvertFrom-Json).caseIds) }
  "dev" { @(Read-JsonLines (Join-Path $benchmarkRoot "cases/dev.jsonl") | ForEach-Object { $_.caseId }) }
  "test" { @(Read-JsonLines (Join-Path $benchmarkRoot "cases/test.jsonl") | ForEach-Object { $_.caseId }) }
}

$campaignName = "pilot-{0}-{1}-{2}" -f (Get-Date -Format "yyyyMMdd-HHmmss"), $Scope, $Variant
$campaignRoot = Join-Path $benchmarkRoot "runs/$campaignName"
$commonArgs = @(
  "--model", $Model,
  "--reasoning-effort", $ReasoningEffort,
  "--verbosity", $Verbosity,
  "--variant", $Variant,
  "--codex-home", $resolvedCodexHome,
  "--timeout-ms", [string]$TimeoutMs,
  "--out", $campaignRoot
)
if ([string]::IsNullOrWhiteSpace($ProviderBaseUrl)) {
  throw "Mock-contract pilot runs must use MemoryProxy forwarding. ProviderBaseUrl cannot be empty."
}
$commonArgs += @("--provider-base-url", $ProviderBaseUrl)

Write-Host "Experiment plan only uses the existing CODEX_HOME; auth.json will not be copied."
Write-Host "Scope=$Scope Cases=$($caseIds.Count) Repeats=$Repeats Model=$Model Reasoning=$ReasoningEffort Variant=$Variant"
Write-Host "CODEX_HOME=$resolvedCodexHome"
Write-Host "MemoryProxy=$ProviderBaseUrl"
Write-Warning "This runner uses pre-rendered prompts and an isolated Mock Bridge. Its results are Pilot/contract evidence only and MUST NOT enter the formal Task 1 metrics."

if ($PrepareOnly) {
  Write-Host "`nValidation command:"
  Write-Host "  $npmCommand run eval:tool-prompt:validate"
  Write-Host "`nRequired health check:"
  Write-Host "  Invoke-WebRequest $ProxyHealthUrl"
  Write-Host "  If health reports tdaiAuth=enabled, set TDAI_EVAL_USER_KEY in this PowerShell process. Its value is not written to the run artifacts."
  Write-Host "`nCodex commands:"
  foreach ($repeat in 1..$Repeats) {
    foreach ($id in $caseIds) {
      $display = @("run", "eval:tool-prompt:codex", "--", "--case", $id, "--repeat", [string]$repeat) + $commonArgs
      Write-Host "  $npmCommand $($display -join ' ')"
    }
  }
  exit 0
}

Push-Location $proxyRoot
try {
  try {
    $health = Invoke-WebRequest -Uri $ProxyHealthUrl -UseBasicParsing -TimeoutSec 5
    if ($health.StatusCode -lt 200 -or $health.StatusCode -ge 300) {
      throw "unexpected HTTP status $($health.StatusCode)"
    }
    $healthBody = $health.Content | ConvertFrom-Json
    if ($healthBody.toolPromptDiagnostic -ne "mock-contract-enabled") {
      throw "Proxy does not advertise the required mock-contract bypass. Start it with start-benchmark-proxy.ps1."
    }
    if ($healthBody.codexUpstream.TrimEnd("/") -ne $ExpectedCodexUpstream.TrimEnd("/")) {
      throw "Effective Codex upstream is '$($healthBody.codexUpstream)', expected '$ExpectedCodexUpstream'."
    }
    if ($healthBody.codexUpstreamAuth -ne "client-passthrough") {
      throw "Effective Codex auth mode is '$($healthBody.codexUpstreamAuth)', expected client-passthrough."
    }
    if ($healthBody.tdaiAuth -eq "enabled" -and [string]::IsNullOrWhiteSpace($env:TDAI_EVAL_USER_KEY)) {
      throw "TDAI auth is enabled but TDAI_EVAL_USER_KEY is not set. Set it only in this PowerShell process; the runner passes it as an environment-backed header and never writes its value."
    }
  } catch {
    throw "MemoryProxy is not healthy at $ProxyHealthUrl. Start it before the benchmark. $($_.Exception.Message)"
  }

  & $npmCommand run eval:tool-prompt:validate
  if ($LASTEXITCODE -ne 0) { throw "Dataset validation failed." }

  New-Item -ItemType Directory -Path $campaignRoot -Force | Out-Null
  $campaignManifest = [ordered]@{
    schemaVersion = "1.0"
    evaluationLayer = "mock-contract"
    formalMetricEligible = $false
    createdAt = (Get-Date).ToUniversalTime().ToString("o")
    scope = $Scope
    caseCount = $caseIds.Count
    repeats = $Repeats
    variant = $Variant
    model = $Model
    reasoningEffort = $ReasoningEffort
    verbosity = $Verbosity
    timeoutMs = $TimeoutMs
    codexHomeMode = "shared-no-copy"
    providerBaseUrl = if ($ProviderBaseUrl) { $ProviderBaseUrl } else { $null }
    codexUpstream = $healthBody.codexUpstream
    codexUpstreamAuth = $healthBody.codexUpstreamAuth
    tdaiAuth = $healthBody.tdaiAuth
    tdaiUserKeyHeaderConfigured = -not [string]::IsNullOrWhiteSpace($env:TDAI_EVAL_USER_KEY)
    caseIds = $caseIds
  }
  Write-Utf8NoBom (Join-Path $campaignRoot "campaign-manifest.json") ($campaignManifest | ConvertTo-Json -Depth 8)

  foreach ($repeat in 1..$Repeats) {
    foreach ($id in $caseIds) {
      Write-Host "`n[$id][$Variant][repeat $repeat]"
      $runnerArgs = @("run", "eval:tool-prompt:codex", "--", "--case", $id, "--repeat", [string]$repeat) + $commonArgs
      & $npmCommand @runnerArgs
      if ($LASTEXITCODE -ne 0) { throw "Runner process failed for $id repeat $repeat." }
    }
  }

  $invalidRuns = Get-ChildItem -LiteralPath $campaignRoot -Recurse -Filter "evaluation.json" | Where-Object {
    (Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json).state -eq "INFRASTRUCTURE_ERROR"
  }
  if ($invalidRuns.Count -gt 0) {
    throw "$($invalidRuns.Count) infrastructure-invalid run(s) were rejected before scoring or usage aggregation."
  }

  $traceLines = Get-ChildItem -LiteralPath $campaignRoot -Recurse -Filter "trace.jsonl" |
    Sort-Object FullName |
    ForEach-Object { (Get-Content -LiteralPath $_.FullName -Raw).Trim() } |
    Where-Object { $_ }
  [System.IO.File]::WriteAllText(
    (Join-Path $campaignRoot "traces.jsonl"),
    (($traceLines -join [Environment]::NewLine) + [Environment]::NewLine),
    [System.Text.UTF8Encoding]::new($false)
  )

  $usageRows = Get-ChildItem -LiteralPath $campaignRoot -Recurse -Filter "usage.json" | Sort-Object FullName | ForEach-Object {
    $usage = Get-Content -LiteralPath $_.FullName -Raw | ConvertFrom-Json
    if ($null -eq $usage.model) {
      throw "Missing model usage in $($_.FullName)."
    }
    foreach ($field in @("inputTokens", "cachedInputTokens", "cacheWriteInputTokens", "outputTokens", "reasoningOutputTokens")) {
      if ($null -eq $usage.model.$field) {
        throw "Missing model usage field '$field' in $($_.FullName)."
      }
    }
    [ordered]@{
      runDirectory = Split-Path -Parent $_.FullName
      injectionTokens = $usage.injection.tokens
      injectionCharacters = $usage.injection.characters
      inputTokens = $usage.model.inputTokens
      cachedInputTokens = $usage.model.cachedInputTokens
      cacheWriteInputTokens = $usage.model.cacheWriteInputTokens
      outputTokens = $usage.model.outputTokens
      reasoningOutputTokens = $usage.model.reasoningOutputTokens
    }
  }
  $usageAggregate = [ordered]@{
    runs = $usageRows.Count
    injectionTokenTotal = ($usageRows | Measure-Object -Property injectionTokens -Sum).Sum
    injectionTokenMean = ($usageRows | Measure-Object -Property injectionTokens -Average).Average
    inputTokenTotal = ($usageRows | Measure-Object -Property inputTokens -Sum).Sum
    cachedInputTokenTotal = ($usageRows | Measure-Object -Property cachedInputTokens -Sum).Sum
    cacheWriteInputTokenTotal = ($usageRows | Measure-Object -Property cacheWriteInputTokens -Sum).Sum
    outputTokenTotal = ($usageRows | Measure-Object -Property outputTokens -Sum).Sum
    reasoningOutputTokenTotal = ($usageRows | Measure-Object -Property reasoningOutputTokens -Sum).Sum
  }
  $campaignUsage = [ordered]@{
    evaluationLayer = "mock-contract"
    formalMetricEligible = $false
    encoding = "o200k_base"
    aggregate = $usageAggregate
    runs = $usageRows
  }
  Write-Utf8NoBom (Join-Path $campaignRoot "campaign-usage.json") ($campaignUsage | ConvertTo-Json -Depth 8)

  & $npmCommand run eval:tool-prompt:score -- --traces (Join-Path $campaignRoot "traces.jsonl") --out (Join-Path $campaignRoot "scores.jsonl")
  if ($LASTEXITCODE -ne 0) { throw "Scoring failed." }

  Write-Host "`nMock-contract Pilot campaign complete: $campaignRoot"
} finally {
  Pop-Location
}
