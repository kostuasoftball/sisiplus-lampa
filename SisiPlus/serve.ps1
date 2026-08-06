$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 8765
$address = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
    Sort-Object InterfaceMetric |
    Select-Object -First 1 -ExpandProperty IPAddress

if (-not $address) { $address = 'РИШЛИ МНЕ ' }

Write-Host 'SisiPlus development server'
Write-Host "Plugin URL: http://${address}:${port}/dist/sisiplus.js?v=1.0.0"
Write-Host 'Keep this window open while Lampa uses the plugin. Press Ctrl+C to stop.'

Set-Location -LiteralPath $projectRoot
python -m http.server $port --bind 0.0.0.0
