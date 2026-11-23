#requires -Version 5.1
<#
.SYNOPSIS
  Stock Peek restricted Cloudflare Worker analysis smoke test (PowerShell 5.1+).
.DESCRIPTION
  Disabled: expects a 503/ERR_ANALYSIS_DISABLED response, no secrets.
  Unauthorized: requires enabled Worker, expects 401, no paid model call.
  Live: prompts for the operator-only bearer token and sends ONE 30-day MSFT request.
  Never prints, writes, or transmits the token other than as an Authorization header.
.EXAMPLE
  .\scripts\smoke-analysis.ps1 -Mode Disabled
  .\scripts\smoke-analysis.ps1 -Mode Unauthorized
  .\scripts\smoke-analysis.ps1 -Mode Live
#>
[CmdletBinding()]
param(
  [ValidateSet('Disabled', 'Unauthorized', 'Live')]
  [string]$Mode = 'Disabled',
  [string]$BaseUrl = 'https://stockpeek-proxy.sngmng.workers.dev'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName System.Net.Http

$client = New-Object System.Net.Http.HttpClient
$client.Timeout = [TimeSpan]::FromSeconds(45)
$token = $null
$auth = $null
$request = $null
$response = $null

try {
  $base = $BaseUrl.TrimEnd('/')
  if (-not $base.StartsWith('https://', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'BaseUrl must use HTTPS.'
  }
  $url = "$base/api/analyze"
  $payload = @{
    schemaVersion = 2
    locale = 'ko'
    stocks = @(@{ market = 'US'; symbol = 'MSFT'; key = 'US:MSFT' })
    options = @{
      includeHoldings = $false
      includeHistory = $false
      includeThesis = $false
      lookbackDays = 30
    }
  }
  $json = if ($Mode -eq 'Disabled') { '{}' } else { ConvertTo-Json -InputObject $payload -Depth 8 -Compress }

  if ($Mode -eq 'Live') {
    Write-Host 'Live mode consumes one D1 daily test quota unit and may incur OpenRouter costs.'
    Write-Host 'Use the ANALYSIS_TEST_TOKEN value locally. Never paste it into chat or commit it.'
    $secret = Read-Host 'ANALYSIS_TEST_TOKEN' -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
    try {
      $token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    } finally {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    }
    if ([string]::IsNullOrEmpty($token) -or $token.Length -lt 32) {
      throw 'Operator token must be at least 32 characters.'
    }
  }

  $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Post, $url)
  $request.Content = [System.Net.Http.StringContent]::new(
    $json,
    [Text.Encoding]::UTF8,
    'application/json'
  )
  if ($Mode -eq 'Live') {
    $auth = [System.Net.Http.Headers.AuthenticationHeaderValue]::new(
      'Bearer',
      $token
    )
    $request.Headers.Authorization = $auth
  }
  $response = $client.SendAsync($request).GetAwaiter().GetResult()
  $status = [int]$response.StatusCode
  $text = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
  Write-Host "HTTP Status: $status"

  $jsonBody = $null
  try { $jsonBody = ConvertFrom-Json -InputObject $text }
  catch { throw "Non-JSON response returned (HTTP $status). Check Worker deployment and logs." }

  if ($Mode -eq 'Disabled') {
    if ($status -ne 503 -or $jsonBody.error -ne 'ERR_ANALYSIS_DISABLED') {
      throw "Expected 503 ERR_ANALYSIS_DISABLED, got HTTP $status / $($jsonBody.error)"
    }
    Write-Host 'PASS: Analysis is disabled before any external API call.'
  } elseif ($Mode -eq 'Unauthorized') {
    if ($status -ne 401 -or $jsonBody.error -ne 'ERR_UNAUTHORIZED') {
      throw "Expected 401 ERR_UNAUTHORIZED, got HTTP $status / $($jsonBody.error)"
    }
    Write-Host 'PASS: Enabled Worker blocks unauthenticated requests.'
  } else {
    if ($status -ne 200 -or $jsonBody.ok -ne $true) {
      throw "Live analysis failed: HTTP $status / $($jsonBody.error)"
    }
    if ($jsonBody.result.status -ne 'generated_unbilled' -or
        $jsonBody.result.dataLevel -ne 'filing_metadata_only') {
      throw 'Unexpected result status/dataLevel. Aborting report inspection.'
    }
    Write-Host 'PASS: Official filing metadata and OpenRouter report returned.'
    Write-Host "Result status: $($jsonBody.result.status)"
    Write-Host "Evidence count: $(@($jsonBody.result.evidence).Count)"
    Write-Host "Coverage success count: $(@($jsonBody.result.coverage | Where-Object { $_.status -eq 'ok' }).Count)"
    Write-Host "Coverage failure count: $(@($jsonBody.result.failures).Count)"
    Write-Host 'No financial report body or token printed.'
  }
} catch {
  Write-Error $_.Exception.Message
  exit 1
} finally {
  if ($request) { $request.Dispose() }
  if ($response) { $response.Dispose() }
  $auth = $null
  $token = $null
  $client.Dispose()
}
