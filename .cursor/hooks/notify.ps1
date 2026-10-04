# Phone ping when a Cursor agent run stops (Cursor "stop" hook).
# Skipped while the queue runner drives the agent (it pings by itself).
# Problems are written to %TEMP%\d2d-notify.log, never shown to Cursor.
$log = Join-Path $env:TEMP 'd2d-notify.log'
$raw = ''
try { $raw = [Console]::In.ReadToEnd() } catch { }
if (-not $raw) { $raw = (@($input) -join "`n") }
$status = 'done'
try { $s = ($raw | ConvertFrom-Json).status; if ($s) { $status = [string]$s } } catch { }
if ($env:D2D_NTFY -and -not $env:D2D_RUNNER) {
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    Invoke-RestMethod -Method Post -Uri ('https://ntfy.sh/' + $env:D2D_NTFY) -Body ('Cursor agent stopped: ' + $status) -TimeoutSec 10 | Out-Null
  } catch {
    Add-Content -Path $log -Value ((Get-Date -Format s) + ' send failed: ' + $_.Exception.Message)
  }
} elseif (-not $env:D2D_NTFY) {
  Add-Content -Path $log -Value ((Get-Date -Format s) + ' D2D_NTFY not set in this process')
}
Write-Output '{}'