param(
  [Parameter(Mandatory = $true)] [string] $RunDirectory,
  [Parameter(Mandatory = $true)] [string] $Plan,
  [Parameter(Mandatory = $true)] [string] $InspectObservations,
  [Parameter(Mandatory = $true)] [ValidateSet("dev", "hidden_test")] [string] $Split,
  [Parameter(Mandatory = $true)] [string] $Output,
  [switch] $AllowHiddenTest
)

$ErrorActionPreference = "Stop"
$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$arguments = @(
  "--import", "tsx/esm",
  (Join-Path $scriptRoot "formal-preflight-receipt-cli.ts"),
  "--run-dir", $RunDirectory,
  "--plan", $Plan,
  "--inspect-observations", $InspectObservations,
  "--split", $Split,
  "--output", $Output
)
if ($AllowHiddenTest) { $arguments += "--allow-hidden-test" }

& node @arguments
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
