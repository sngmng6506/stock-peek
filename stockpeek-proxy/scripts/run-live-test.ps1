#requires -Version 5.1
<#
.SYNOPSIS
  One-shot operator test: temporarily enable analysis, test once, always deploy disabled config.
.DESCRIPTION
  Uses an already-authorized Wrangler session on Windows. Production Worker may be
  temporarily enabled. The ANALYSIS_TEST_TOKEN is prompted in smoke-analysis.ps1.
  A forced process termination, machine shutdown or failed rollback can leave it
  enabled: restore wrangler.jsonc to ANALYSIS_ENABLED=0 and redeploy manually.
#>
[CmdletBinding()]
param(
  [switch]$ConfirmLiveCosts
)
$ErrorActionPreference = 'Stop'
if (-not $ConfirmLiveCosts) {
  throw 'Explicitly pass -ConfirmLiveCosts after reviewing possible OpenRouter costs.'
}
$project = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$configPath = Join-Path $project 'wrangler.jsonc'
$smokePath = Join-Path $PSScriptRoot 'smoke-analysis.ps1'
$original = [System.IO.File]::ReadAllText($configPath)
$from = '"ANALYSIS_ENABLED": "0"'
$to = '"ANALYSIS_ENABLED": "1"'
if (-not $original.Contains($from) -or $original.Contains($to)) {
  throw 'Expected an explicitly disabled ANALYSIS_ENABLED=0 in wrangler.jsonc.'
}
$utf8 = [System.Text.UTF8Encoding]::new($false)
$enabledDeployed = $false
$restoreSucceeded = $false
Push-Location $project
try {
  Write-Host 'Checking fail-closed status before enabling...'
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $smokePath -Mode Disabled
  if ($LASTEXITCODE -ne 0) { throw 'Preflight disabled-state check failed.' }

  Write-Host 'Temporarily enabling Worker analysis...'
  $temporary = $original.Replace($from, $to)
  [System.IO.File]::WriteAllText($configPath, $temporary, $utf8)
  & npx.cmd wrangler deploy
  if ($LASTEXITCODE -ne 0) { throw 'Failed to deploy temporarily enabled Worker.' }
  $enabledDeployed = $true

  Write-Host 'Checking missing-token rejection (must not spend model credits)...'
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $smokePath -Mode Unauthorized
  if ($LASTEXITCODE -ne 0) { throw 'Unauthenticated request was not rejected as expected.' }

  Write-Host 'Testing ONE authenticated US filing + Sonnet request...'
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $smokePath -Mode Live
  if ($LASTEXITCODE -ne 0) { throw 'Live AI analysis test failed. Review HTTP status/error code.' }
} finally {
  Write-Host 'Restoring ANALYSIS_ENABLED=0 and redeploying disabled Worker...'
  [System.IO.File]::WriteAllText($configPath, $original, $utf8)
  & npx.cmd wrangler deploy
  if ($LASTEXITCODE -eq 0) {
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $smokePath -Mode Disabled
    $restoreSucceeded = $LASTEXITCODE -eq 0
  }
  Pop-Location
  if (-not $restoreSucceeded) {
    Write-Warning 'CRITICAL: The Worker could still be enabled. Manually deploy ANALYSIS_ENABLED=0 NOW and verify /api/analyze returns ERR_ANALYSIS_DISABLED.'
  } else {
    Write-Host 'Verified: Production Worker is disabled again.'
  }
}
if (-not $restoreSucceeded) { exit 2 }
