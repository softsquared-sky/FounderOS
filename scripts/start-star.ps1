param([string]$NodePath = 'node', [int]$Port = 4188)
$ErrorActionPreference = 'Stop'
$appRoot = Split-Path $PSScriptRoot -Parent
$localRoot = Join-Path $appRoot '.local'
if (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue) { throw "Port $Port is already in use; no process was changed." }
New-Item -ItemType Directory -Path $localRoot -Force | Out-Null
$env:PORT = [string]$Port
$env:FOUNDEROS_PROFILE = 'star'
$env:GLADOS_DEFAULT_MODE = 'real'
$env:DEMO_MODE = '0'
$env:GLADOS_WARM = '0'
$env:GLADOS_WRITES = '0'
$env:GLADOS_CRON = '0'
$child = Start-Process -FilePath $NodePath -ArgumentList @('--max-old-space-size=1536','scripts/serve.mjs','dev') -WorkingDirectory $appRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $localRoot 'server.log') -RedirectStandardError (Join-Path $localRoot 'server.err.log') -PassThru
@{pid=$child.Id;port=$Port;startedAt=[DateTime]::UtcNow.ToString('o');url="http://127.0.0.1:$Port/star"} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $localRoot 'server.json')
Write-Output "Star local server started: PID $($child.Id), http://127.0.0.1:$Port/star. Verify the page before reporting readiness."
