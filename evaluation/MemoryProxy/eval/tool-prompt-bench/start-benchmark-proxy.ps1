[CmdletBinding()]
param(
  [string]$ConfigPath,
  [string]$ImageName = "tdai-memory-proxy-task1:local",
  [string]$ContainerName = "tdai-memory-proxy-task1",
  [ValidateRange(1024, 65535)]
  [int]$Port = 8096,
  [string]$OfficialUpstream = "https://chatgpt.com/backend-api/codex",
  [string]$LangfuseHost = "http://host.docker.internal:13000",
  [switch]$SkipBuild,
  [switch]$Foreground,
  [switch]$PrepareOnly
)

$ErrorActionPreference = "Stop"
$benchmarkRoot = Split-Path -Parent $PSCommandPath
$proxyRoot = (Resolve-Path (Join-Path $benchmarkRoot "../..")).Path
if ([string]::IsNullOrWhiteSpace($ConfigPath)) {
  $ConfigPath = Join-Path $proxyRoot "config.yaml"
}
if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
  throw "MemoryProxy config not found: $ConfigPath. Pass -ConfigPath explicitly; the file is mounted read-only."
}
$resolvedConfig = (Resolve-Path -LiteralPath $ConfigPath).Path
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "docker is not available on PATH."
}

$mount = "${resolvedConfig}:/data/config.yaml:ro"
$buildArgs = @("build", "-t", $ImageName, ".")
$runArgs = @("run")
if (-not $Foreground) { $runArgs += "-d" }
$runArgs += @(
  "--name", $ContainerName,
  "--add-host", "host.docker.internal:host-gateway",
  "-e", "TDAI_TOOL_PROMPT_DIAGNOSTIC=1",
  "-p", "${Port}:8096",
  "-v", $mount,
  $ImageName,
  "--config", "/data/config.yaml",
  "--host", "0.0.0.0",
  "--port", "8096",
  "--codex-upstream", $OfficialUpstream,
  "--langfuse-host", $LangfuseHost
)

Write-Host "The current config is mounted read-only."
Write-Host "Mock-contract bypass is enabled only for spaceId=tool-prompt-bench."
Write-Host "Codex-only official upstream=$OfficialUpstream (client auth passthrough)"
Write-Host "Langfuse host=$LangfuseHost"
Write-Host "Proxy URL=http://127.0.0.1:$Port"

if ($PrepareOnly) {
  if (-not $SkipBuild) { Write-Host "docker $($buildArgs -join ' ')" }
  Write-Host "docker $($runArgs -join ' ')"
  exit 0
}

$existing = docker ps -a --filter "name=^/${ContainerName}$" --format "{{.Names}}"
if ($existing -eq $ContainerName) {
  throw "Container $ContainerName already exists. Stop or inspect it explicitly before retrying."
}

Push-Location $proxyRoot
try {
  if (-not $SkipBuild) {
    & docker @buildArgs
    if ($LASTEXITCODE -ne 0) { throw "MemoryProxy image build failed." }
  }

  & docker @runArgs
  if ($LASTEXITCODE -ne 0) { throw "MemoryProxy container failed to start." }

  if (-not $Foreground) {
    $healthUrl = "http://127.0.0.1:$Port/health"
    $healthy = $false
    $healthBody = $null
    foreach ($attempt in 1..30) {
      try {
        $response = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 2
        if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) {
          $healthBody = $response.Content | ConvertFrom-Json
          $healthy = $true
          break
        }
      } catch {
        Start-Sleep -Seconds 1
      }
    }
    if (-not $healthy) {
      throw "MemoryProxy did not become healthy. Inspect: docker logs $ContainerName"
    }
    if ($healthBody.toolPromptDiagnostic -ne "mock-contract-enabled") {
      throw "MemoryProxy health did not advertise the required mock-contract diagnostic mode."
    }
    if ($healthBody.codexUpstream.TrimEnd("/") -ne $OfficialUpstream.TrimEnd("/")) {
      throw "Effective Codex upstream is '$($healthBody.codexUpstream)', expected '$OfficialUpstream'."
    }
    if ($healthBody.codexUpstreamAuth -ne "client-passthrough") {
      throw "Effective Codex auth mode is '$($healthBody.codexUpstreamAuth)', expected client-passthrough."
    }
    Write-Host "MemoryProxy is healthy: $healthUrl"
    Write-Host "Effective Codex upstream=$($healthBody.codexUpstream); auth=$($healthBody.codexUpstreamAuth); TDAI auth=$($healthBody.tdaiAuth)"
  }
} finally {
  Pop-Location
}
